import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function parseCopilotSdkStdoutLine(
  line: string,
  ts: string,
): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const parsed = asRecord(safeJsonParse(trimmed));
  if (!parsed) {
    return [{ kind: "stdout", text: trimmed, ts }];
  }

  const type = asString(parsed.type);
  const data = asRecord(parsed.data) ?? {};

  switch (type) {
    case "assistant.message": {
      const content = asString(data.content);
      if (!content) return [];
      return [{ kind: "assistant", text: content, ts }];
    }

    case "assistant.message_delta": {
      const deltaContent = asString(data.deltaContent);
      if (!deltaContent) return [];
      return [{ kind: "assistant", text: deltaContent, ts, delta: true } as TranscriptEntry];
    }

    case "assistant.reasoning": {
      const content = asString(data.content);
      if (!content) return [];
      return [{ kind: "thinking", text: content, ts }];
    }

    case "assistant.reasoning_delta": {
      const deltaContent = asString(data.deltaContent);
      if (!deltaContent) return [];
      return [{ kind: "thinking", text: deltaContent, ts, delta: true } as TranscriptEntry];
    }

    case "tool.execution_start": {
      const toolName = asString(data.toolName);
      const toolCallId = asString(data.toolCallId);
      const args = data.arguments;
      return [
        {
          kind: "tool_call",
          name: toolName || toolCallId,
          input: args !== undefined ? args : null,
          ts,
        } as TranscriptEntry,
      ];
    }

    case "tool.execution_complete": {
      const toolCallId = asString(data.toolCallId);
      const success = asBoolean(data.success, true);
      const result = asRecord(data.result);
      const content = result ? asString(result.content) : "";
      return [
        {
          kind: "tool_result",
          toolUseId: toolCallId,
          content: content || stringifyUnknown(data.result),
          isError: !success,
          ts,
        },
      ];
    }

    case "user.message": {
      const content = asString(data.content);
      if (!content) return [];
      return [{ kind: "user", text: content, ts }];
    }

    case "session.start":
    case "session.resume": {
      const sessionId = asString(data.sessionId || parsed.sessionId);
      const text = type === "session.resume"
        ? `Session resumed${sessionId ? `: ${sessionId}` : ""}`
        : `Session started${sessionId ? `: ${sessionId}` : ""}`;
      return [{ kind: "system", text, ts }];
    }

    case "session.idle": {
      return [{ kind: "system", text: "Session idle", ts }];
    }

    case "session.error": {
      const message = asString(data.message);
      return message ? [{ kind: "stderr", text: message, ts }] : [];
    }

    case "session.compaction_start": {
      return [{ kind: "system", text: "Context compaction started", ts }];
    }

    case "session.compaction_complete": {
      const success = asBoolean(data.success, true);
      return [
        {
          kind: "system",
          text: success ? "Context compaction complete" : "Context compaction failed",
          ts,
        },
      ];
    }

    default: {
      // Suppress internal SDK noise events
      if (
        type.startsWith("session.") ||
        type === "assistant.turn_start" ||
        type === "assistant.turn_end" ||
        type === "assistant.usage" ||
        type === "hook.start" ||
        type === "hook.end" ||
        type === "pending_messages.modified"
      ) {
        return [];
      }
      return [{ kind: "stdout", text: trimmed, ts }];
    }
  }
}
