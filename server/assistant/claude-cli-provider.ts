import type { CliProtocol } from "./cli-provider";

export const claudeCliProtocol: CliProtocol = {
  provider: "claude-cli",
  label: "pending",
  probe: async () => ({ ok: false, code: "unsupported-version", message: "pending", version: null }),
  prepare: async () => { throw new Error("pending"); },
  createParser: () => { throw new Error("pending"); },
};
