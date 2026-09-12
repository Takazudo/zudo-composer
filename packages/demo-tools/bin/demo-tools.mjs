#!/usr/bin/env node
// The TypeScript sources are run through tsx's loader: every demo package's
// `site-project.ts` is TypeScript with Preact JSX in its pack, and this tool
// imports the repository's own `src/` for validation and the Assets store.
import { register } from "tsx/esm/api";

register();
const { runDemoTools } = await import("../src/cli.ts");
process.exitCode = await runDemoTools(process.argv.slice(2));
