import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  parseObject,
  ensureAbsoluteDirectory,
} from "@paperclipai/adapter-utils/server-utils";
import { CopilotClient } from "@github/copilot-sdk";
import type { CopilotClientOptions } from "@github/copilot-sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((c) => c.level === "error")) return "fail";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "pass";
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const cwd = asString(config.cwd, process.cwd());
  const githubToken = asString(config.githubToken, "");
  const cliPath = asString(config.command, "");

  // Check 1: Working directory
  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
    checks.push({
      code: "copilot_sdk_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "copilot_sdk_cwd_invalid",
      level: "warn",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
      hint: "Set cwd to an absolute path that exists or can be created.",
    });
  }

  // Check 2: Copilot CLI version (only if explicit cliPath set, otherwise SDK uses bundled CLI)
  if (cliPath) {
    try {
      const { stdout } = await execFileAsync(cliPath, ["--version"], { timeout: 5000 });
      const version = stdout.trim().split("\n")[0];
      checks.push({
        code: "copilot_cli_version",
        level: "info",
        message: `Copilot CLI found: ${version}`,
      });
    } catch (err) {
      checks.push({
        code: "copilot_cli_not_found",
        level: "warn",
        message: `Copilot CLI not found at: ${cliPath}`,
        detail: err instanceof Error ? err.message : String(err),
        hint: 'Leave "command" empty to use the bundled CLI from @github/copilot-sdk.',
      });
    }
  }

  // Check 3: SDK connectivity via client.ping()
  try {
    const clientOptions: CopilotClientOptions = {
      useLoggedInUser: !githubToken,
      autoRestart: false,
    };
    if (cliPath) clientOptions.cliPath = cliPath;
    if (githubToken) clientOptions.githubToken = githubToken;

    const client = new CopilotClient(clientOptions);
    await client.start();
    try {
      await client.ping("preflight");
      checks.push({
        code: "copilot_sdk_ping",
        level: "info",
        message: "Copilot SDK connectivity check passed",
      });
    } finally {
      await client.stop().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAuthError = /auth|token|login|unauthorized|unauthenticated/i.test(msg);
    checks.push({
      code: "copilot_sdk_connectivity",
      level: "error",
      message: isAuthError
        ? "GitHub authentication required"
        : `Copilot SDK connectivity check failed: ${msg.slice(0, 240)}`,
      hint: isAuthError
        ? 'Run "gh auth login" or set the githubToken field in the adapter config.'
        : "Ensure the Copilot CLI is installed and your GitHub account has Copilot access.",
    });
  }

  return {
    adapterType: "copilot_sdk",
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
