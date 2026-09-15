import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Committed source bytes keep checksums stable across machines and reruns.
export const demoFileNames = [
  "demo-sunrise.png", "demo-lagoon.png", "demo-orchard.png", "demo-twilight.png",
  "demo-guide.pdf", "demo-archive.zip",
  // Sample Studio imagery, rendered by scripts/demo/optimise-images.mjs.
  "studio-workbench.webp", "studio-wall.webp", "studio-review.webp", "journal-question.webp", "journal-map.webp",
] as const;
const composerBin = fileURLToPath(new URL("../bin/zudo-composer.mjs", import.meta.url));
const manifest = fileURLToPath(new URL("./demo-assets/manifest.json", import.meta.url));

/** Repository fixture adapter; the tool resolves this host's configured store. */
export function seedDemoAsset(workspaceRoot = process.cwd()): Promise<{ added: number; skipped: number }> {
  return new Promise((settle, reject) => {
    const child = execFile(process.execPath, [composerBin, "assets", "import", "--root", resolve(workspaceRoot)],
      { cwd: workspaceRoot, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        try {
          let response: { ok: boolean; result?: { added: number; skipped: number }; error?: { code: string; message: string } };
          try { response = JSON.parse(stdout) as typeof response; }
          catch (cause) { throw new Error(`Demo Assets import did not return one JSON response: ${stderr || error?.message || stdout}`, { cause }); }
          if (!response.ok && response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code });
          if (error) throw new Error(`Demo Assets import failed: ${stderr || error.message}`, { cause: error });
          const result = response.result;
          if (response.ok !== true || !result || !Number.isSafeInteger(result.added) || !Number.isSafeInteger(result.skipped)
            || result.added < 0 || result.skipped < 0 || result.added + result.skipped !== demoFileNames.length) {
            throw new Error("Demo Assets import returned an invalid result.");
          }
          settle(result);
        } catch (failure) { reject(failure); }
      });
    child.stdin?.on("error", () => { /* execFile reports the child's failure. */ });
    child.stdin?.end(`${JSON.stringify({ manifest })}\n`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedDemoAsset().then(({ added, skipped }) => {
    console.log(`Demo assets: added ${added}, already present ${skipped}.`);
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
