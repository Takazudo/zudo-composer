// @ts-check
// Compare every shipped file, including package metadata, against the recorded
// package-output commit. Evidence lives outside the package files allowlist.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [mode, argument] = process.argv.slice(2);
assert.ok((mode === "--write" || mode === "--check") && argument, "Usage: check-hosted-payload.mjs --write|--check <inventory.json>");
const inventoryPath = resolve(argument);
const temporary = await mkdtemp(join(tmpdir(), "hosted-payload-"));
/** Preserve every metadata field/value and array order; pnpm's workspace
 * dependency enumeration can vary object-key order between identical packs.
 * @param {unknown} value @returns {unknown} */
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, ordered(child)]));
  return value;
}
/** @param {string | Buffer} bytes */
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
try {
  execFileSync("corepack", ["pnpm", "pack", "--pack-destination", temporary], { cwd: root, stdio: "pipe", maxBuffer: 16 * 1024 * 1024 });
  const tarballs = (await readdir(temporary)).filter(name => name.endsWith(".tgz"));
  assert.equal(tarballs.length, 1, "Expected exactly one tool package tarball");
  execFileSync("tar", ["-xzf", join(temporary, tarballs[0]), "-C", temporary], { stdio: "pipe" });
  /** @type {{path: string, bytes: number, mode: number, sha256: string}[]} */
  const files = [];
  let rawPackageJsonSha256 = "";
  /** @param {string} directory @param {string} prefix */
  async function visit(directory, prefix) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name), relative = prefix ? `${prefix}/${name}` : name;
      const stat = await lstat(path);
      if (stat.isDirectory()) await visit(path, relative);
      else {
        assert.ok(stat.isFile(), `Unexpected non-file in packed payload: ${relative}`);
        let bytes = await readFile(path);
        if (relative === "package.json") {
          rawPackageJsonSha256 = hash(bytes);
          bytes = Buffer.from(JSON.stringify(ordered(JSON.parse(bytes.toString("utf8")))));
        }
        files.push({ path: relative, bytes: bytes.length, mode: stat.mode & 0o777, sha256: hash(bytes) });
      }
    }
  }
  await visit(join(temporary, "package"), "");
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  assert.ok(files.some(file => file.path === "README.md") && files.some(file => file.path === "LICENSE"), "Full packed metadata must be included");
  const payloadSha256 = hash(JSON.stringify(files));
  const normalization = "Only package.json object-key order/whitespace; all metadata keys, values, dependency specs, exports and arrays retained. Every other file uses exact raw bytes and full permission mode.";
  if (mode === "--write") {
    // Do not attribute an uncommitted delivered file to HEAD. Excluded evidence
    // may change afterward without introducing the self-referencing SHA trap.
    const paths = files.map(file => file.path);
    execFileSync("git", ["ls-files", "--error-unmatch", "--", ...paths], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", ...paths], { cwd: root, stdio: "pipe" });
    const packageOutputSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await mkdir(dirname(inventoryPath), { recursive: true });
    await writeFile(inventoryPath, JSON.stringify({ packageOutputSha, payloadSha256, rawPackageJsonSha256, normalization, files }, null, 2) + "\n");
    console.log(`Recorded complete packed payload at ${packageOutputSha}: ${files.length} files, ${payloadSha256}`);
  } else {
    const expected = JSON.parse(await readFile(inventoryPath, "utf8"));
    assert.match(expected.packageOutputSha, /^[a-f0-9]{40}$/, "Recorded package-output SHA is required");
    assert.equal(normalization, expected.normalization, "Normalization must remain explicit and unchanged");
    assert.deepEqual(files, expected.files, "The complete delivered payload changed; repeat the exact-SHA consumer proof at a new package-output commit");
    assert.equal(payloadSha256, expected.payloadSha256);
    console.log(`Current complete packed payload equals recorded ${expected.packageOutputSha}: ${files.length} files, ${payloadSha256}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
