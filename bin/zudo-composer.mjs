#!/usr/bin/env node
// Thin entry. Everything the CLI does lives in `server/cli/run.mjs`, which is
// unit-tested; this file only exists to be the `bin` target.
import { runComposerCli } from "../server/cli/run.mjs";

await runComposerCli(process.argv.slice(2));
