import { describe, expect, it } from "vitest";
import { buildCopilotSdkConfig } from "../build-config.js";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";

const base: CreateConfigValues = {
  adapterType: "copilot_sdk",
  model: "gpt-5.3-codex",
  cwd: "",
  instructionsFilePath: "",
  promptTemplate: "",
  thinkingEffort: "",
  command: "",
  args: "",
  extraArgs: "",
  envVars: "",
  envBindings: {},
  url: "",
  bootstrapPrompt: "",
  chrome: false,
  dangerouslySkipPermissions: false,
  search: false,
  dangerouslyBypassSandbox: false,
  maxTurnsPerRun: 0,
  heartbeatEnabled: false,
  intervalSec: 0,
};

describe("buildCopilotSdkConfig", () => {
  it("always sets timeoutSec, graceSec, and infiniteSessions defaults", () => {
    const result = buildCopilotSdkConfig(base);
    expect(result.timeoutSec).toBe(0);
    expect(result.graceSec).toBe(15);
    expect(result.infiniteSessions).toBe(true);
  });

  it("sets model from values (or default when empty)", () => {
    const result = buildCopilotSdkConfig({ ...base, model: "" });
    expect(typeof result.model).toBe("string");
    expect((result.model as string).length).toBeGreaterThan(0);
  });

  it("uses provided model over default", () => {
    const result = buildCopilotSdkConfig({ ...base, model: "claude-sonnet-4.6" });
    expect(result.model).toBe("claude-sonnet-4.6");
  });

  it("passes cwd when set", () => {
    const result = buildCopilotSdkConfig({ ...base, cwd: "/workspace/app" });
    expect(result.cwd).toBe("/workspace/app");
  });

  it("omits cwd when empty", () => {
    const result = buildCopilotSdkConfig({ ...base, cwd: "" });
    expect(result).not.toHaveProperty("cwd");
  });

  it("passes instructionsFilePath when set", () => {
    const result = buildCopilotSdkConfig({ ...base, instructionsFilePath: "/path/AGENTS.md" });
    expect(result.instructionsFilePath).toBe("/path/AGENTS.md");
  });

  it("maps thinkingEffort to reasoningEffort", () => {
    for (const effort of ["low", "medium", "high", "xhigh"]) {
      const result = buildCopilotSdkConfig({ ...base, thinkingEffort: effort });
      expect(result.reasoningEffort).toBe(effort);
    }
  });

  it("omits reasoningEffort for invalid effort values", () => {
    const result = buildCopilotSdkConfig({ ...base, thinkingEffort: "turbo" });
    expect(result).not.toHaveProperty("reasoningEffort");
  });

  it("parses comma-separated extraArgs", () => {
    const result = buildCopilotSdkConfig({ ...base, extraArgs: "--verbose, --no-color" });
    expect(result.extraCliArgs).toEqual(["--verbose", "--no-color"]);
  });

  it("omits extraCliArgs when empty", () => {
    const result = buildCopilotSdkConfig({ ...base, extraArgs: "" });
    expect(result).not.toHaveProperty("extraCliArgs");
  });

  it("parses KEY=VALUE envVars", () => {
    const result = buildCopilotSdkConfig({ ...base, envVars: "FOO=bar\nBAZ=qux" });
    const env = result.env as Record<string, unknown>;
    expect(env.FOO).toEqual({ type: "plain", value: "bar" });
    expect(env.BAZ).toEqual({ type: "plain", value: "qux" });
  });

  it("ignores comment lines and empty lines in envVars", () => {
    const result = buildCopilotSdkConfig({
      ...base,
      envVars: "# comment\n\nFOO=bar",
    });
    const env = result.env as Record<string, { type: string }>;
    expect(Object.keys(env)).toHaveLength(1);
    expect(env.FOO.type).toBe("plain");
  });

  it("passes secret_ref bindings from envBindings", () => {
    const result = buildCopilotSdkConfig({
      ...base,
      envBindings: {
        MY_SECRET: { type: "secret_ref", secretId: "sec_abc123" },
      },
    });
    const env = result.env as Record<string, unknown>;
    expect(env.MY_SECRET).toEqual({ type: "secret_ref", secretId: "sec_abc123" });
  });

  it("envBindings take precedence over envVars for the same key", () => {
    const result = buildCopilotSdkConfig({
      ...base,
      envBindings: { FOO: { type: "plain", value: "from_binding" } },
      envVars: "FOO=from_envvars",
    });
    const env = result.env as Record<string, { type: string; value: string }>;
    expect(env.FOO.value).toBe("from_binding");
  });

  it("omits env when no env vars are set", () => {
    const result = buildCopilotSdkConfig({ ...base, envVars: "", envBindings: {} });
    expect(result).not.toHaveProperty("env");
  });
});
