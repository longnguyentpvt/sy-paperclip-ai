# Copilot SDK Adapter — Implementation Plan

> Adds a `copilot_sdk` adapter to Paperclip using `@github/copilot-sdk` for programmatic control of GitHub Copilot CLI via its Node.js SDK.

## ⚠️ Known Risks

- `@github/copilot-sdk` is in **technical preview** — API surface is not stable and may change between releases.
- SDK event names/signatures should be verified against the actual installed TypeScript types, not the CLI `--output-format json` schema.

## Prerequisites

- [ ] GitHub Copilot CLI installed on host (or Docker image)
- [ ] `@github/copilot-sdk` published and installable (`npm install @github/copilot-sdk`)
- [ ] GitHub auth token available (via `gh auth` or explicit `githubToken`)

---

## Phase 1 — Adapter Package Scaffold

### 1.1 Create package structure

- [ ] Create `packages/adapters/copilot-sdk/package.json`
  - name: `@paperclipai/adapter-copilot-sdk`
  - version: `0.3.0` (match existing adapters)
  - type: `"module"`
  - deps: `@github/copilot-sdk`, `@paperclipai/adapter-utils: "workspace:*"`, `zod`, `picocolors`
  - four exports: `.` → `./src/index.ts`, `./server` → `./src/server/index.ts`, `./ui` → `./src/ui/index.ts`, `./cli` → `./src/cli/index.ts`
  - `publishConfig.exports` with `dist/` paths (types + import) for all four entry points
  - `files: ["dist", "skills"]`, `scripts.build: "tsc"`, `scripts.clean: "rm -rf dist"`, `scripts.typecheck: "tsc --noEmit"`
- [ ] Create `packages/adapters/copilot-sdk/tsconfig.json` (extend `../../../tsconfig.base.json`, outDir `dist`, rootDir `src`, types `["node"]`)
- [ ] Verify `pnpm-workspace.yaml` glob `packages/adapters/*` auto-discovers the new package

### 1.2 Root metadata (`src/index.ts`)

- [ ] Export `type = "copilot_sdk"`
- [ ] Export `label = "Copilot SDK (local)"`
- [ ] Export `models` array:
  - `claude-sonnet-4.6`, `claude-sonnet-4.5`, `claude-haiku-4.5`
  - `claude-opus-4.6`, `claude-opus-4.6-fast`, `claude-opus-4.5`
  - `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`
  - `gpt-5.1-codex-max`, `gpt-5.1-codex`, `gpt-5.1`, `gpt-5.1-codex-mini`
  - `gpt-5-mini`, `gpt-4.1`
  - `gemini-3-pro-preview`
- [ ] Export `agentConfigurationDoc` describing all config fields with "use when" / "don't use when" guidance

---

## Phase 2 — Server Module

### 2.1 Execute (`packages/adapters/copilot-sdk/src/server/execute.ts`)

Core execution using `CopilotClient` + `CopilotSession` instead of `runChildProcess`.

- [ ] Read config values using `asString`, `asNumber`, `asBoolean`, `parseObject` from adapter-utils
  - `command` (string, default `"copilot"`) — passed as `cliPath`
  - `model` (string, required)
  - `reasoningEffort` (string, optional) — `"low" | "medium" | "high" | "xhigh"`
  - `cwd` (string, optional) — working directory
  - `githubToken` (string, optional) — explicit token override
  - `promptTemplate` (string, optional) — default Paperclip prompt template
  - `instructionsFilePath` (string, optional) — system prompt file
  - `systemMessage` (string, optional) — appended to system prompt
  - `timeoutSec` (number, optional) — run timeout
  - `infiniteSessions` (boolean, default `true`) — enable auto-compaction
  - `streaming` (boolean, default `true`)
  - `env` (object, optional) — env var overrides
  - `extraCliArgs` (string[], optional) — extra args passed to `cliArgs`
- [ ] Build Paperclip env vars (`PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_RUN_ID`, `PAPERCLIP_API_URL`, task/wake/approval context vars)
- [ ] Resolve workspace cwd from context (`context.paperclipWorkspace`) with fallback to `config.cwd`
- [ ] Instantiate `CopilotClient` with:
  - `cliPath` from config
  - `cliArgs` from `extraCliArgs`
  - `githubToken` from config or `authToken`
  - `useLoggedInUser: true` as fallback when no explicit token
- [ ] Start client: `await client.start()`
- [ ] Session resume logic:
  - Read `runtime.sessionParams.sessionId` + `runtime.sessionParams.cwd`
  - If session exists and cwd matches → `client.resumeSession(sessionId)`
  - Otherwise → `client.createSession(config)`
  - On resume failure (unknown session) → retry with `createSession` + set `clearSession: true`
- [ ] Build session config:
  - `model` from config
  - `reasoningEffort` from config
  - `streaming: true`
  - `systemMessage` — build from `instructionsFilePath` content + `systemMessage` config + Paperclip env note
  - `tools` — inject Paperclip tools via `defineTool()` (see §2.3)
  - `infiniteSessions` — `{ enabled: true }` by default
  - `hooks.onPreToolUse` — log tool calls to `onLog("stdout", ...)`
  - `hooks.onPostToolUse` — log tool results to `onLog("stdout", ...)`
  - `hooks.onErrorOccurred` — log errors, decide retry/abort
- [ ] Wire event handlers to `onLog` for run viewer:
  - `session.on("assistant.message_delta", ...)` → `onLog("stdout", JSON.stringify(event))`
  - `session.on("assistant.message", ...)` → `onLog("stdout", ...)`
  - `session.on("assistant.reasoning_delta", ...)` → `onLog("stdout", ...)`
  - `session.on("assistant.reasoning", ...)` → `onLog("stdout", ...)`
  - `session.on("tool.execution_start", ...)` → `onLog("stdout", ...)`
  - `session.on("tool.execution_complete", ...)` → `onLog("stdout", ...)`
  - `session.on("user.message", ...)` → `onLog("stdout", ...)`
  - `session.on("session.idle", ...)` → signal completion
  - `session.on("session.compaction_start", ...)` → `onLog("stderr", ...)`
  - `session.on("session.compaction_complete", ...)` → `onLog("stderr", ...)`
- [ ] Call `onMeta` before sending prompt (adapter type, command, env, prompt, context)
- [ ] Render prompt via `renderTemplate(promptTemplate, { agent, run, context, ... })`
- [ ] Send prompt: `session.sendAndWait({ prompt }, timeoutMs)`
- [ ] Handle timeout: if `sendAndWait` returns `undefined` and timeout expired → `{ timedOut: true }`
- [ ] Build `AdapterExecutionResult`:
  - `exitCode: 0` on success
  - `timedOut` from timeout logic
  - `sessionParams: { sessionId: session.sessionId, cwd }`
  - `sessionDisplayId: session.sessionId`
  - `summary` from final `assistant.message` content
  - `billingType: "subscription"`
  - `provider` derived from model name
  - `model` from config
  - `clearSession` if resume failed
- [ ] Cleanup: `session.disconnect()` then `client.stop()` in `finally` block
- [ ] Handle `client.stop()` errors gracefully (log, don't throw)

### 2.2 Session codec (`packages/adapters/copilot-sdk/src/server/index.ts`)

- [ ] Export `execute` from `execute.ts`
- [ ] Export `testEnvironment` from `test.ts`
- [ ] Implement `sessionCodec`:
  - `deserialize(raw)` — extract `sessionId` (string) and `cwd` (string) from stored JSON
  - `serialize(params)` — store `{ sessionId, cwd }` with validation
  - `getDisplayId(params)` — return `sessionId` string

### 2.3 Paperclip tool injection (`packages/adapters/copilot-sdk/src/server/tools.ts`)

Build `defineTool()` array that gives Copilot native access to Paperclip API.

- [ ] `paperclip_get_task` — fetch current task details
- [ ] `paperclip_update_task` — update task status / summary
- [ ] `paperclip_post_comment` — post comment on the current task
- [ ] `paperclip_request_approval` — request board approval
- [ ] `paperclip_list_issues` — list issues for the agent's company/project
- [ ] `paperclip_create_issue` — create a new issue
- [ ] `paperclip_delegate_task` — delegate task to another agent
- [ ] Each tool:
  - Uses `zod` schema for parameters
  - Makes HTTP call to `PAPERCLIP_API_URL` with `PAPERCLIP_API_KEY` auth
  - Returns JSON-serializable result
  - Handles errors gracefully (returns error message, doesn't throw)

### 2.4 Environment test (`packages/adapters/copilot-sdk/src/server/test.ts`)

- [ ] Check `copilot` command exists in PATH (or `config.command`)
- [ ] Check `copilot --version` returns valid version
- [ ] Try `client.ping()` for connectivity validation
- [ ] Check GitHub auth status (token validity)
- [ ] Check `cwd` exists and is absolute
- [ ] Return `AdapterEnvironmentTestResult` with structured checks

---

## Phase 3 — UI Module

### 3.1 Package-level UI exports (`packages/adapters/copilot-sdk/src/ui/index.ts`)

Export functions that live in the adapter package (no React dependency here):

- [ ] `parseCopilotSdkStdoutLine` from `./parse-stdout.js`
- [ ] `buildCopilotSdkConfig` from `./build-config.js`

### 3.2 Stdout parser (`packages/adapters/copilot-sdk/src/ui/parse-stdout.ts`)

Parse the JSON events we emit via `onLog` back into `TranscriptEntry[]`.

- [ ] `assistant.message` → `{ kind: "assistant", text: event.data.content }`
- [ ] `assistant.message_delta` → `{ kind: "assistant", text: event.data.deltaContent, delta: true }`
- [ ] `assistant.reasoning` → `{ kind: "thinking", text: event.data.content }`
- [ ] `assistant.reasoning_delta` → `{ kind: "thinking", text: event.data.deltaContent, delta: true }`
- [ ] `tool.execution_start` → `{ kind: "tool_call", name: event.data.toolName, input: event.data.toolArgs }`
- [ ] `tool.execution_complete` → `{ kind: "tool_result", content: event.data.result, isError: event.data.isError }`
- [ ] `user.message` → `{ kind: "user", text: event.data.content }`
- [ ] `result` → `{ kind: "result", ... }` with usage stats
- [ ] `session.idle` → `{ kind: "system", text: "Session idle" }`
- [ ] Fallback: `{ kind: "stdout", text: line }` for unparseable lines

### 3.3 Config builder (`packages/adapters/copilot-sdk/src/ui/build-config.ts`)

- [ ] `buildCopilotSdkConfig(v: CreateConfigValues): Record<string, unknown>`
  - Map `v.cwd` → `ac.cwd`
  - Map `v.model` → `ac.model`
  - Map `v.promptTemplate` → `ac.promptTemplate`
  - Map `v.thinkingEffort` → `ac.reasoningEffort`
  - Map `v.instructionsFilePath` → `ac.instructionsFilePath`
  - Map `v.command` → `ac.command`
  - Map `v.envVars` / `v.envBindings` → `ac.env`
  - Map `v.extraArgs` → `ac.extraCliArgs`
  - Set `ac.timeoutSec = 0`, `ac.graceSec = 15`
  - Set `ac.infiniteSessions = true`

### 3.4 Config fields component (`ui/src/adapters/copilot-sdk/config-fields.tsx`)

React component — lives in the **UI app**, not the adapter package (follows cursor pattern).

- [ ] Create React component implementing `AdapterConfigFieldsProps`
- [ ] Fields for create and edit modes:
  - Model dropdown (populated from models list)
  - Working directory (`cwd`) with `DraftInput` + `ChoosePathButton`
  - Instructions file path
  - Prompt template (`DraftTextarea`)
  - Reasoning effort dropdown (`low` / `medium` / `high` / `xhigh`)
  - GitHub token (optional, masked input)
  - CLI command override
  - Extra CLI args
  - Environment variables (`DraftTextarea` for key=value or secret ref bindings)
  - Infinite sessions toggle
- [ ] Use shared primitives: `Field`, `ToggleField`, `DraftInput`, `DraftTextarea`, `HintIcon`, `CollapsibleSection`

### 3.5 UI adapter module (`ui/src/adapters/copilot-sdk/index.ts`)

Wire the three pieces together (follows cursor adapter pattern):

- [ ] Import `parseCopilotSdkStdoutLine` from `@paperclipai/adapter-copilot-sdk/ui`
- [ ] Import `buildCopilotSdkConfig` from `@paperclipai/adapter-copilot-sdk/ui`
- [ ] Import `CopilotSdkConfigFields` from local `./config-fields`
- [ ] Export `copilotSdkUIAdapter: UIAdapterModule` with:
  - `type: "copilot_sdk"`
  - `label: "Copilot SDK (local)"`
  - `parseStdoutLine` from parse-stdout
  - `ConfigFields` from config-fields
  - `buildAdapterConfig` from build-config

---

## Phase 4 — CLI Module

### 4.1 Terminal formatter (`packages/adapters/copilot-sdk/src/cli/format-event.ts`)

- [ ] Parse JSON event lines for `paperclipai run --watch`
- [ ] Color coding with `picocolors`:
  - Blue for system events
  - Green for assistant messages
  - Yellow for tool calls
  - Red for errors
  - Gray for debug/unrecognized (when `debug=true`)

### 4.2 CLI exports (`packages/adapters/copilot-sdk/src/cli/index.ts`)

- [ ] Export `printCopilotSdkStreamEvent` function

---

## Phase 5 — Registration & Wiring

### 5.1 Shared constants

- [ ] Add `"copilot_sdk"` to `AGENT_ADAPTER_TYPES` in `packages/shared/src/constants.ts`

### 5.2 Server registry

- [ ] Import in `server/src/adapters/registry.ts`:
  ```ts
  import { execute as copilotSdkExecute, testEnvironment as copilotSdkTestEnvironment, sessionCodec as copilotSdkSessionCodec } from "@paperclipai/adapter-copilot-sdk/server";
  import { agentConfigurationDoc as copilotSdkAgentConfigurationDoc, models as copilotSdkModels } from "@paperclipai/adapter-copilot-sdk";
  ```
- [ ] Create `copilotSdkAdapter: ServerAdapterModule` with `execute`, `testEnvironment`, `sessionCodec`, `models`, `supportsLocalAgentJwt: true`, `agentConfigurationDoc`
- [ ] Add to `adaptersByType` map array

### 5.3 UI registry

- [ ] Import `copilotSdkUIAdapter` in `ui/src/adapters/registry.ts`
- [ ] Add to `adaptersByType` map

### 5.4 UI labels & enabled list

- [ ] Add `copilot_sdk: "Copilot SDK (local)"` to `adapterLabels` record in `ui/src/components/agent-config-primitives.tsx` (line 60)
- [ ] Add `"copilot_sdk"` to `ENABLED_ADAPTER_TYPES` set in `ui/src/components/AgentConfigForm.tsx` (line 901)

### 5.5 CLI registry

- [ ] Import `printCopilotSdkStreamEvent` from `@paperclipai/adapter-copilot-sdk/cli` in `cli/src/adapters/registry.ts`
- [ ] Create `copilotSdkCLIAdapter: CLIAdapterModule` with `type: "copilot_sdk"` and `formatStdoutEvent: printCopilotSdkStreamEvent`
- [ ] Add to `adaptersByType` map array

### 5.6 Server dependency

- [ ] Add `@paperclipai/adapter-copilot-sdk: "workspace:*"` to `server/package.json` dependencies
- [ ] Add `@paperclipai/adapter-copilot-sdk: "workspace:*"` to `cli/package.json` dependencies
- [ ] Add `@paperclipai/adapter-copilot-sdk: "workspace:*"` to `ui/package.json` dependencies

---

## Phase 6 — Testing

### 6.1 Unit tests

- [ ] `packages/adapters/copilot-sdk/src/server/__tests__/parse-stdout.test.ts` — event→TranscriptEntry mapping
- [ ] `packages/adapters/copilot-sdk/src/server/__tests__/session-codec.test.ts` — serialize/deserialize round-trip
- [ ] `packages/adapters/copilot-sdk/src/ui/__tests__/build-config.test.ts` — CreateConfigValues→adapterConfig

### 6.2 Integration tests

- [ ] `server/src/__tests__/copilot-sdk-adapter.test.ts` — mock `CopilotClient`, verify execute flow
- [ ] Test session resume → success path
- [ ] Test session resume → unknown session → retry with fresh session
- [ ] Test timeout behavior
- [ ] Test tool injection calls

---

## Phase 7 — Verification

- [ ] `pnpm install` — installs `@github/copilot-sdk` and links workspace packages
- [ ] `pnpm -r typecheck` — all packages compile
- [ ] `pnpm test:run` — all tests pass
- [ ] `pnpm build` — full build succeeds
- [ ] Manual test: create a Copilot SDK agent in the UI, run a heartbeat, verify transcript
- [ ] Manual test: verify session resume works across heartbeats
- [ ] Manual test: verify Paperclip tool calls work from within Copilot session

---

## Key Differences from Other Adapters

| Aspect | CLI adapters (claude, cursor, codex) | Copilot SDK adapter |
|---|---|---|
| Process management | `runChildProcess()` — spawn & wait | `CopilotClient` — long-running managed process |
| Output parsing | Hand-rolled JSONL parser | Typed SDK event handlers |
| Tool injection | Symlink skill files + `--add-dir` | `defineTool()` — native callable tools |
| System prompt | `--append-system-prompt-file` or stdin prefix | `systemMessage: { content }` — first-class config |
| Session resume | `--resume <id>` flag | `client.resumeSession(id)` — API call |
| Auth | Host `gh auth` / env vars | `githubToken` option on client |
| Context management | Manual (agent manages its own context) | `infiniteSessions` — auto-compaction built in |
| Error detection | Regex on stderr/stdout | `onErrorOccurred` hook + typed errors |

## Config Reference

```jsonc
{
  "adapterType": "copilot_sdk",
  "adapterConfig": {
    // Core
    "model": "gpt-5.3-codex",         // required
    "cwd": "/path/to/project",        // working directory
    "promptTemplate": "You are agent {{agent.id}}...",
    "reasoningEffort": "high",         // low|medium|high|xhigh
    
    // Auth
    "githubToken": "",                 // explicit GitHub token (optional)
    
    // System prompt
    "instructionsFilePath": "/path/to/instructions.md",
    "systemMessage": "Additional system prompt content",
    
    // Sessions
    "infiniteSessions": true,          // auto context compaction
    
    // CLI
    "command": "copilot",              // CLI path override
    "extraCliArgs": [],                // extra CLI arguments
    
    // Environment
    "env": {
      "CUSTOM_VAR": "value"
    },
    
    // Operational
    "timeoutSec": 0,                   // 0 = no timeout
    "graceSec": 15
  }
}
```
