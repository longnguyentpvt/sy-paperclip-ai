import type { UIAdapterModule } from "../types";
import { parseCopilotSdkStdoutLine } from "@paperclipai/adapter-copilot-sdk/ui";
import { buildCopilotSdkConfig } from "@paperclipai/adapter-copilot-sdk/ui";
import { CopilotSdkConfigFields } from "./config-fields";

export const copilotSdkUIAdapter: UIAdapterModule = {
  type: "copilot_sdk",
  label: "Copilot SDK (local)",
  parseStdoutLine: parseCopilotSdkStdoutLine,
  ConfigFields: CopilotSdkConfigFields,
  buildAdapterConfig: buildCopilotSdkConfig,
};
