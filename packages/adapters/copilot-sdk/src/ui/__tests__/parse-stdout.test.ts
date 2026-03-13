import { describe, expect, it } from "vitest";
import { parseCopilotSdkStdoutLine } from "../parse-stdout.js";

const TS = "2026-01-01T00:00:00.000Z";

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

describe("parseCopilotSdkStdoutLine", () => {
  it("returns [] for empty lines", () => {
    expect(parseCopilotSdkStdoutLine("", TS)).toEqual([]);
    expect(parseCopilotSdkStdoutLine("   ", TS)).toEqual([]);
  });

  it("returns stdout entry for non-JSON lines", () => {
    const result = parseCopilotSdkStdoutLine("plain text", TS);
    expect(result).toEqual([{ kind: "stdout", text: "plain text", ts: TS }]);
  });

  it("parses assistant.message", () => {
    const result = parseCopilotSdkStdoutLine(
      line({ type: "assistant.message", data: { content: "hello world" } }),
      TS,
    );
    expect(result).toEqual([{ kind: "assistant", text: "hello world", ts: TS }]);
  });

  it("returns [] for assistant.message with empty content", () => {
    const result = parseCopilotSdkStdoutLine(
      line({ type: "assistant.message", data: { content: "" } }),
      TS,
    );
    expect(result).toEqual([]);
  });

  it("parses assistant.message_delta as delta assistant entry", () => {
    const result = parseCopilotSdkStdoutLine(
      line({ type: "assistant.message_delta", data: { deltaContent: "chunk" } }),
      TS,
    );
    expect(result).toEqual([{ kind: "assistant", text: "chunk", ts: TS, delta: true }]);
  });

  it("parses assistant.reasoning", () => {
    const result = parseCopilotSdkStdoutLine(
      line({ type: "assistant.reasoning", data: { content: "thinking..." } }),
      TS,
    );
    expect(result).toEqual([{ kind: "thinking", text: "thinking...", ts: TS }]);
  });

  it("parses assistant.reasoning_delta as delta thinking entry", () => {
    const result = parseCopilotSdkStdoutLine(
      line({ type: "assistant.reasoning_delta", data: { deltaContent: "step" } }),
      TS,
    );
    expect(result).toEqual([{ kind: "thinking", text: "step", ts: TS, delta: true }]);
  });

  it("parses tool.execution_start", () => {
    const result = parseCopilotSdkStdoutLine(
      line({
        type: "tool.execution_start",
        data: { toolCallId: "call_1", toolName: "paperclip_get_run", arguments: { foo: "bar" } },
      }),
      TS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "tool_call",
      name: "paperclip_get_run",
      ts: TS,
    });
  });

  it("parses tool.execution_complete success", () => {
    const result = parseCopilotSdkStdoutLine(
      line({
        type: "tool.execution_complete",
        data: { toolCallId: "call_1", success: true, result: { content: "ok" } },
      }),
      TS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "tool_result",
      toolUseId: "call_1",
      content: "ok",
      isError: false,
      ts: TS,
    });
  });

  it("parses tool.execution_complete failure", () => {
    const result = parseCopilotSdkStdoutLine(
      line({
        type: "tool.execution_complete",
        data: { toolCallId: "call_2", success: false, result: { content: "err" } },
      }),
      TS,
    );
    expect(result[0]).toMatchObject({ kind: "tool_result", isError: true });
  });

  it("parses user.message", () => {
    const result = parseCopilotSdkStdoutLine(
      line({ type: "user.message", data: { content: "do the thing" } }),
      TS,
    );
    expect(result).toEqual([{ kind: "user", text: "do the thing", ts: TS }]);
  });

  it("parses session.compaction_complete success", () => {
    const result = parseCopilotSdkStdoutLine(
      line({ type: "session.compaction_complete", data: { success: true } }),
      TS,
    );
    expect(result).toEqual([{ kind: "system", text: "Context compaction complete", ts: TS }]);
  });

  it("parses session.compaction_complete failure", () => {
    const result = parseCopilotSdkStdoutLine(
      line({ type: "session.compaction_complete", data: { success: false } }),
      TS,
    );
    expect(result[0]).toMatchObject({ kind: "system", text: "Context compaction failed" });
  });

  it("parses session.idle as system entry", () => {
    const result = parseCopilotSdkStdoutLine(line({ type: "session.idle", data: {} }), TS);
    expect(result).toEqual([{ kind: "system", text: "Session idle", ts: TS }]);
  });

  it("suppresses noisy internal events", () => {
    for (const type of [
      "assistant.turn_start",
      "assistant.turn_end",
      "assistant.usage",
      "hook.start",
      "hook.end",
      "pending_messages.modified",
    ]) {
      const result = parseCopilotSdkStdoutLine(line({ type, data: {} }), TS);
      expect(result, `${type} should be suppressed`).toEqual([]);
    }
  });

  it("falls back to stdout entry for unknown JSON events", () => {
    const raw = line({ type: "unknown.custom_event", data: {} });
    const result = parseCopilotSdkStdoutLine(raw, TS);
    expect(result).toEqual([{ kind: "stdout", text: raw, ts: TS }]);
  });
});
