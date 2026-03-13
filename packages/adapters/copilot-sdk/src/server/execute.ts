import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asString,
  asNumber,
  asBoolean,
  asStringArray,
  parseObject,
  buildPaperclipEnv,
  renderTemplate,
  ensureAbsoluteDirectory,
} from "@paperclipai/adapter-utils/server-utils";
import { CopilotClient, approveAll } from "@github/copilot-sdk";
import type { SessionConfig, ResumeSessionConfig, CopilotClientOptions } from "@github/copilot-sdk";
import fs from "node:fs/promises";
import path from "node:path";
import { buildPaperclipTools } from "./tools.js";
import { DEFAULT_COPILOT_SDK_MODEL } from "../index.js";

const DEFAULT_PROMPT_TEMPLATE = `You are agent {{agent.id}} ({{agent.name}}) operating under company {{agent.companyId}}.

Task:
{{context.taskTitle}}

{{context.taskDescription}}

Run instructions:
{{context.runInstructions}}

---
IMPORTANT: If the task title or description above is blank, call paperclip_get_issue immediately (no arguments needed) to load the full task details before doing anything else.`;

function resolveProvider(model: string): string {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gemini")) return "google";
  return "openai";
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { agent, runtime, config, context, onLog, onMeta, authToken, runId } = ctx;

  const rawConfig = parseObject(config);
  const model = asString(rawConfig.model, DEFAULT_COPILOT_SDK_MODEL);
  const reasoningEffort = asString(rawConfig.reasoningEffort, "");
  const configCwd = asString(rawConfig.cwd, "");
  const githubToken = asString(rawConfig.githubToken, "") || undefined;
  const promptTemplate = asString(rawConfig.promptTemplate, DEFAULT_PROMPT_TEMPLATE);
  const instructionsFilePath = asString(rawConfig.instructionsFilePath, "");
  const systemMessageExtra = asString(rawConfig.systemMessage, "");
  const timeoutSec = asNumber(rawConfig.timeoutSec, 0);
  const infiniteSessionsEnabled = asBoolean(rawConfig.infiniteSessions, true);
  const subscriptionMonthlyCostUsd = asNumber(rawConfig.subscriptionMonthlyCostUsd, 0);
  const subscriptionIncludedRequests = asNumber(rawConfig.subscriptionIncludedRequests, 0);
  const cliPath = asString(rawConfig.command, "") || undefined;
  const extraCliArgs = asStringArray(rawConfig.extraCliArgs);
  const envConfig = parseObject(rawConfig.env);

  // Resolve working directory
  const contextCwd = asString((context as Record<string, unknown>).paperclipWorkspace, "");
  const cwd = contextCwd || configCwd || process.cwd();
  const contextIssueId = asString((context as Record<string, unknown>).issueId, "") || undefined;

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
  } catch {
    // non-fatal, proceed with cwd as-is
  }

  // Build env
  const paperclipEnv = buildPaperclipEnv(agent);
  const baseEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...paperclipEnv,
    PAPERCLIP_RUN_ID: runId ?? "",
  };
  // Inject local agent JWT as PAPERCLIP_API_KEY so subprocess calls are authenticated
  if (authToken && !baseEnv.PAPERCLIP_API_KEY) {
    baseEnv.PAPERCLIP_API_KEY = authToken;
  }
  // Apply config env overrides
  for (const [key, val] of Object.entries(envConfig)) {
    if (typeof val === "string") {
      baseEnv[key] = val;
    } else if (typeof val === "object" && val !== null && (val as Record<string,unknown>).type === "plain") {
      baseEnv[key] = String((val as Record<string,unknown>).value ?? "");
    }
    // secret_ref values are pre-resolved by the server before reaching here
  }

  // Build system message
  const systemMessageParts: string[] = [];
  if (instructionsFilePath) {
    const instrContent = await readFileIfExists(instructionsFilePath);
    if (instrContent) systemMessageParts.push(instrContent.trim());
  }
  if (systemMessageExtra) {
    systemMessageParts.push(systemMessageExtra.trim());
  }
  // Append Paperclip env info so the agent knows its context
  systemMessageParts.push(
    `## Paperclip Context\nYou are running as agent ${agent.id} (${agent.name}) for company ${agent.companyId}.\nPAPERCLIP_API_URL: ${paperclipEnv.PAPERCLIP_API_URL}\nPAPERCLIP_RUN_ID: ${runId ?? ""}${contextIssueId ? `\nPAPERCLIP_ISSUE_ID: ${contextIssueId}` : ""}\n\nUse the paperclip_get_issue tool (no arguments) to fetch the full task details for issue ${contextIssueId ?? "(see run context)"} if the task content is not in your initial prompt.`
  );
  const systemMessageContent = systemMessageParts.join("\n\n");

  // Render prompt
  const prompt = renderTemplate(promptTemplate, {
    agent,
    run: { id: runId },
    context,
  });

  // Instantiate client
  const clientOptions: CopilotClientOptions = {
    env: baseEnv,
    useLoggedInUser: !githubToken,
  };
  if (cliPath) clientOptions.cliPath = cliPath;
  if (extraCliArgs.length > 0) clientOptions.cliArgs = extraCliArgs;
  if (githubToken) clientOptions.githubToken = githubToken;

  const client = new CopilotClient(clientOptions);

  let session: Awaited<ReturnType<typeof client.createSession>> | null = null;
  let clearSession = false;
  let finalSummary: string | null = null;
  let timedOut = false;
  let sessionUsage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null = null;
  let sessionPremiumRequestsCost = 0;

  if (onMeta) {
    await onMeta({
      adapterType: "copilot_sdk",
      command: cliPath ?? "copilot (bundled)",
      cwd,
      env: paperclipEnv,
      prompt,
      context: { model, reasoningEffort, infiniteSessionsEnabled },
    });
  }

  try {
    await client.start();

    // Attempt session resume
    const storedSessionId = asString(runtime.sessionParams?.sessionId, "");
    const storedCwd = asString(runtime.sessionParams?.cwd, "");

    const sessionConfig: SessionConfig = {
      model,
      systemMessage: { mode: "append", content: systemMessageContent },
      onPermissionRequest: approveAll,
      tools: buildPaperclipTools(paperclipEnv, runId ?? "", contextIssueId, authToken ?? undefined),
      infiniteSessions: { enabled: infiniteSessionsEnabled },
      workingDirectory: cwd,
      streaming: true,
      ...(reasoningEffort
        ? { reasoningEffort: reasoningEffort as SessionConfig["reasoningEffort"] }
        : {}),
    };

    if (storedSessionId && storedCwd === cwd) {
      try {
        const resumeConfig: ResumeSessionConfig = {
          model: sessionConfig.model,
          systemMessage: sessionConfig.systemMessage,
          onPermissionRequest: approveAll,
          tools: sessionConfig.tools,
          infiniteSessions: sessionConfig.infiniteSessions,
          workingDirectory: sessionConfig.workingDirectory,
          streaming: sessionConfig.streaming,
          ...(reasoningEffort ? { reasoningEffort: sessionConfig.reasoningEffort } : {}),
        };
        session = await client.resumeSession(storedSessionId, resumeConfig);
        await onLog("stdout", JSON.stringify({ type: "session.resume", data: { sessionId: session.sessionId } }) + "\n");
      } catch {
        // Resume failed — fall through to create a new session
        session = null;
        clearSession = true;
      }
    }

    if (!session) {
      session = await client.createSession(sessionConfig);
      await onLog("stdout", JSON.stringify({ type: "session.start", data: { sessionId: session.sessionId } }) + "\n");
    }

    // Wire event handlers to onLog
    session.on("assistant.message_delta", (event) => {
      void onLog("stdout", JSON.stringify(event) + "\n");
    });
    session.on("assistant.message", (event) => {
      finalSummary = event.data.content;
      void onLog("stdout", JSON.stringify(event) + "\n");
    });
    session.on("assistant.reasoning_delta", (event) => {
      void onLog("stdout", JSON.stringify(event) + "\n");
    });
    session.on("assistant.reasoning", (event) => {
      void onLog("stdout", JSON.stringify(event) + "\n");
    });
    session.on("tool.execution_start", (event) => {
      void onLog("stdout", JSON.stringify(event) + "\n");
    });
    session.on("tool.execution_complete", (event) => {
      void onLog("stdout", JSON.stringify(event) + "\n");
    });
    session.on("user.message", (event) => {
      void onLog("stdout", JSON.stringify(event) + "\n");
    });
    session.on("session.error", (event) => {
      void onLog("stderr", JSON.stringify(event) + "\n");
    });
    session.on("session.compaction_start", (event) => {
      void onLog("stderr", JSON.stringify(event) + "\n");
    });
    session.on("session.compaction_complete", (event) => {
      void onLog("stderr", JSON.stringify(event) + "\n");
    });
    // assistant.usage fires per API call (ephemeral — not persisted to session log).
    // Accumulate across all calls since session.shutdown fires after disconnect() clears handlers.
    session.on("assistant.usage", (event) => {
      void onLog("stdout", JSON.stringify(event) + "\n");
      const d = event.data;
      if (!sessionUsage) {
        sessionUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
      }
      sessionUsage.inputTokens += d.inputTokens ?? 0;
      sessionUsage.outputTokens += d.outputTokens ?? 0;
      sessionUsage.cachedInputTokens += d.cacheReadTokens ?? 0;
      // cost is the premium-request multiplier weight for this call (e.g. 1.0, 2.0)
      sessionPremiumRequestsCost += d.cost ?? 0;
    });

    // Send prompt and wait.
    // NOTE: sendAndWait's default timeout is 60 seconds when undefined is passed.
    // When timeoutSec is 0 (unconfigured), use 1 hour so long-running agents are not killed.
    const timeoutMs = timeoutSec > 0 ? timeoutSec * 1000 : 60 * 60 * 1000;
    let result: Awaited<ReturnType<typeof session.sendAndWait>>;
    try {
      result = await session.sendAndWait({ prompt }, timeoutMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("timeout")) {
        timedOut = true;
      } else {
        throw err;
      }
    }

    const sessionId = session.sessionId;

    // Estimate run cost from subscription plan config.
    // costPerUnit = monthlyCost / includedRequests; costUsd = premiumRequestsConsumed * costPerUnit
    const costUsd =
      subscriptionMonthlyCostUsd > 0 && subscriptionIncludedRequests > 0 && sessionPremiumRequestsCost > 0
        ? (sessionPremiumRequestsCost / subscriptionIncludedRequests) * subscriptionMonthlyCostUsd
        : undefined;

    return {
      exitCode: timedOut ? null : 0,
      signal: null,
      timedOut,
      sessionParams: { sessionId, cwd },
      sessionDisplayId: sessionId,
      summary: finalSummary,
      usage: sessionUsage ?? undefined,
      billingType: "subscription",
      costUsd,
      provider: resolveProvider(model),
      model,
      clearSession: clearSession || undefined,
    };
  } finally {
    if (session) {
      try {
        await session.disconnect();
      } catch {
        // ignore disconnect errors
      }
    }
    try {
      await client.stop();
    } catch {
      // ignore stop errors
    }
  }
}
