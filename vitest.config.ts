import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/db", "packages/adapters/opencode-local", "packages/adapters/copilot-sdk", "server", "ui", "cli"],
  },
});
