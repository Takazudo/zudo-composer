// Finish command execution while runnerImport's module graph is still open:
// generate dynamically evaluates the host's source after loading the CLI.
import { runDemoTools } from "./cli";

process.exitCode = await runDemoTools(process.argv.slice(2));
