// Finish command execution while runnerImport's module graph is still open:
// the seed helpers dynamically evaluate host configuration and component packs.
import { runDemoTools } from "./cli";

process.exitCode = await runDemoTools(process.argv.slice(2));
