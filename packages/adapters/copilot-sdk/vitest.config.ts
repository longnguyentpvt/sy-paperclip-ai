import { defineConfig } from "vitest/config";
import { readdirSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

// @github/copilot-sdk (imported by server/index.ts) imports `vscode-jsonrpc/node`
// without the .js extension, which fails under strict ESM. Apply the same fix
// used in the server package vitest config.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const pnpmStore = resolve(ROOT, "node_modules/.pnpm");
const vsJsonRpcDir = readdirSync(pnpmStore).find((d) =>
  d.startsWith("vscode-jsonrpc@")
);
const vsNodeAlias = vsJsonRpcDir
  ? resolve(pnpmStore, vsJsonRpcDir, "node_modules/vscode-jsonrpc/node.js")
  : undefined;

export default defineConfig({
  resolve: vsNodeAlias
    ? { alias: { "vscode-jsonrpc/node": vsNodeAlias } }
    : {},
  test: {
    environment: "node",
    server: {
      deps: {
        inline: [/@github\/copilot-sdk/, /vscode-jsonrpc/],
      },
    },
  },
});
