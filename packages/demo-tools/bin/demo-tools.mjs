#!/usr/bin/env node
// Evaluate the CLI and the host's TypeScript/TSX graph with the same Preact
// runtime as the tool's module evaluator, independently of host tsconfig.
import { runnerImport } from "vite";

await runnerImport(new URL("../src/cli-entry.ts", import.meta.url).href, {
  configFile: false,
  root: process.cwd(),
  resolve: { dedupe: ["preact"] },
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
});
