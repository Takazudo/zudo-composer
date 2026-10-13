// Browser package/CSS/declaration proof without launching or downloading Chromium.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBrowserFixture } from "./browser-proof.mjs";
import { rendererRoot } from "./render-proof.mjs";
export async function proveBrowserBundle(artifactDirectory) {
  const evidence = await buildBrowserFixture();
  const manifest = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
  evidence.installedToolSpec = manifest.dependencies["zudo-composer"];
  evidence.installedToolSha = evidence.installedToolSpec.split("#")[1];
  evidence.browserExecution = "NOT RUN: this command only builds/inspects browser assets and checks declarations";
  const files = ["browser-checkpoint.js", "browser-checkpoint.css", "browser-checkpoint-metafile.json", "browser-checkpoint.html"];
  if (artifactDirectory) {
    await mkdir(artifactDirectory, { recursive: true });
    for (const file of files) await cp(join(rendererRoot, "dist", file), join(artifactDirectory, file));
    evidence.metafileSha256 = createHash("sha256").update(await readFile(join(artifactDirectory, "browser-checkpoint-metafile.json"))).digest("hex");
    await writeFile(join(artifactDirectory, "browser-bundle-evidence.json"), JSON.stringify(evidence, null, 2));
  }
  console.log(JSON.stringify(evidence));
  return evidence;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await proveBrowserBundle(process.argv[2] ? resolve(process.argv[2]) : undefined);
