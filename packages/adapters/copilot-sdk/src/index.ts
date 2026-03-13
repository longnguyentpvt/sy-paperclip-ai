export const type = "copilot_sdk";
export const label = "Copilot SDK (local)";

export const DEFAULT_COPILOT_SDK_MODEL = "gpt-5.3-codex";

const COPILOT_FALLBACK_MODEL_IDS = [
  // GPT models
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex",
  "gpt-5.1",
  "gpt-5.1-codex-mini",
  "gpt-5-mini",
  "gpt-4.1",
  // Claude models
  "claude-sonnet-4.6",
  "claude-sonnet-4.5",
  "claude-haiku-4.5",
  "claude-opus-4.6",
  "claude-opus-4.6-fast",
  "claude-opus-4.5",
  // Gemini models
  "gemini-3-pro-preview",
];

export const models = COPILOT_FALLBACK_MODEL_IDS.map((id) => ({ id, label: id }));

export const agentConfigurationDoc = `# copilot_sdk agent configuration

Adapter: copilot_sdk

Use when:
- You want Paperclip to run GitHub Copilot CLI locally via the @github/copilot-sdk Node.js SDK
- You want structured session management with native tool injection via defineTool()
- You want automatic context compaction across long sessions (infiniteSessions)
- You want typed session resume via client.resumeSession(id)

Don't use when:
- You need webhook-style external invocation (use openclaw_gateway or http)
- You only need one-shot shell commands (use process)
- GitHub Copilot CLI is not installed on the machine

Core fields:
- model (string, required): Copilot model id (for example gpt-5.3-codex, claude-sonnet-4.5)
- cwd (string, optional): default absolute working directory for the agent process (created if missing)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the system prompt
- promptTemplate (string, optional): run prompt template
- reasoningEffort (string, optional): reasoning effort level — "low" | "medium" | "high" | "xhigh"
- githubToken (string, optional): explicit GitHub token override (uses logged-in user auth by default)
- command (string, optional): path to the copilot CLI executable (defaults to bundled CLI from @github/copilot package)
- extraCliArgs (string[], optional): additional CLI args passed before SDK-managed args
- env (object, optional): KEY=VALUE or secret-ref environment variables
- infiniteSessions (boolean, optional): enable auto-compaction for long sessions (default: true)

Operational fields:
- timeoutSec (number, optional): run timeout in seconds (0 = no timeout)
- graceSec (number, optional): cleanup grace period in seconds

Notes:
- Sessions are resumed when stored sessionId matches current run
- Tool injection uses defineTool() — Paperclip tools are natively callable from Copilot
- Auth uses logged-in GitHub user by default; set githubToken to override
`;
