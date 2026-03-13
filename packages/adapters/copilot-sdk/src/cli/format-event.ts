import pc from "picocolors";

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

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function printCopilotSdkStreamEvent(line: string, _debug: boolean): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  const parsed = asRecord(safeJsonParse(trimmed));
  if (!parsed) {
    console.log(pc.gray(trimmed));
    return;
  }

  const type = asString(parsed.type);
  const data = asRecord(parsed.data) ?? {};

  switch (type) {
    case "assistant.message": {
      const content = asString(data.content).trim();
      if (content) console.log(pc.green(`assistant: ${content}`));
      break;
    }

    case "assistant.message_delta": {
      const delta = asString(data.deltaContent).trim();
      if (delta) process.stdout.write(pc.green(delta));
      break;
    }

    case "assistant.reasoning": {
      const content = asString(data.content).trim();
      if (content) console.log(pc.gray(`thinking: ${truncate(content)}`));
      break;
    }

    case "assistant.reasoning_delta": {
      const delta = asString(data.deltaContent).trim();
      if (delta) process.stdout.write(pc.gray(delta));
      break;
    }

    case "tool.execution_start": {
      const toolName = asString(data.toolName || data.toolCallId);
      console.log(pc.yellow(`tool: ${toolName}`));
      break;
    }

    case "tool.execution_complete": {
      const toolCallId = asString(data.toolCallId);
      const success = asBoolean(data.success, true);
      if (!success) {
        console.log(pc.red(`tool failed: ${toolCallId}`));
      }
      break;
    }

    case "user.message": {
      const content = asString(data.content).trim();
      if (content) console.log(pc.gray(`user: ${truncate(content)}`));
      break;
    }

    case "session.start": {
      const sessionId = asString(data.sessionId || parsed.sessionId);
      console.log(pc.blue(`session started${sessionId ? `: ${sessionId}` : ""}`));
      break;
    }

    case "session.resume": {
      const sessionId = asString(data.sessionId || parsed.sessionId);
      console.log(pc.blue(`session resumed${sessionId ? `: ${sessionId}` : ""}`));
      break;
    }

    case "session.idle": {
      console.log(pc.blue("session idle"));
      break;
    }

    case "session.error": {
      const message = asString(data.message);
      if (message) console.log(pc.red(`error: ${message}`));
      break;
    }

    case "session.compaction_start": {
      console.log(pc.blue("context compaction started…"));
      break;
    }

    case "session.compaction_complete": {
      const success = asBoolean(data.success, true);
      console.log(
        success ? pc.blue("context compaction complete") : pc.red("context compaction failed"),
      );
      break;
    }

    default: {
      // Suppress noisy internal events
      if (
        type === "assistant.turn_start" ||
        type === "assistant.turn_end" ||
        type === "assistant.usage" ||
        type === "hook.start" ||
        type === "hook.end" ||
        type === "pending_messages.modified" ||
        type.startsWith("session.")
      ) {
        return;
      }
      // Show unrecognized events in debug gray
      console.log(pc.gray(`[${type}] ${JSON.stringify(data).slice(0, 200)}`));
      break;
    }
  }
}
