// @ts-check
// Shared by the opt-in real-CLI checks (the composition Assistant and Content-AI):
// executable selection with the dry-run fakes, CI refusal, log scrubbing and
// numbered result files. Nothing here starts a CLI or contacts a model.
import { existsSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repo = fileURLToPath(new URL("../..", import.meta.url));
export const FAKE_CLIS = { "claude-cli": join(repo, "scripts/fixtures/assistant/fake-claude-cli.mjs"), "codex-cli": join(repo, "scripts/fixtures/assistant/fake-codex-cli.mjs") };
export const REAL_LABEL = "normal-login real CLI inference";
export const DRY_LABEL = "fake executable dry run — not real CLI evidence";

/** @returns {string | null} why this process must not run a real-CLI check */
export function ciRefusal() {
  return process.env.CI && process.env.CI !== "false" ? "Refusing to run with CI set: this check uses a person's normal CLI sign-in and is never a CI lane." : null;
}

/**
 * The executable to run and whether it is a repository fake (a dry run).
 * A path is made absolute (only a bare command name or an absolute path is accepted downstream).
 * @param {{ provider: "claude-cli" | "codex-cli", requested?: string, allowFake: boolean }} options
 * @returns {Promise<{ executable: string, dryRun: boolean } | { refusal: string }>}
 */
export async function selectCliExecutable({ provider, requested, allowFake }) {
  const name = requested ?? (provider === "claude-cli" ? "claude" : "codex");
  const executable = name.includes("/") ? resolve(name) : name;
  const real = existsSync(executable) ? await realpath(executable) : null;
  const isFake = real !== null && Object.values(FAKE_CLIS).includes(real);
  if (isFake && !allowFake) return { refusal: "That executable is a test fake; pass --allow-fake-executable for a dry run." };
  if (allowFake && !isFake) return { refusal: "--allow-fake-executable accepts only scripts/fixtures/assistant/fake-claude-cli.mjs or fake-codex-cli.mjs." };
  if (isFake && real !== FAKE_CLIS[provider]) return { refusal: `The fake executable does not match --provider ${provider}.` };
  return { executable, dryRun: isFake };
}

/** Removes ANSI codes, scratch and repository paths and the home directory from text that is printed or recorded. @param {string[]} paths */
export function createScrubber(paths) {
  const replacements = [...paths.map(path => [path.replace(/\/$/, ""), path === repo ? "<repo>" : "<tmp>"]), [homedir(), "~"]].filter(([path]) => path && path !== "/");
  return (/** @type {string} */ text) => replacements.reduce((value, [path, label]) => value.split(path).join(label), text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu"), ""));
}

/** Dry runs never write under verification/. @param {string} outDir */
export function writesUnderVerification(outDir) {
  return relative(join(repo, "verification"), outDir).split(/[\\/]/)[0] !== "..";
}

/**
 * Writes one result; earlier results (failures included) are kept, so a rerun at the same version and commit gets a numbered name.
 * @param {string} outDir @param {string} stem @param {unknown} result
 */
export async function writeNumberedResult(outDir, stem, result) {
  await mkdir(outDir, { recursive: true });
  let file = join(outDir, `${stem}.json`);
  for (let index = 2; existsSync(file); index++) file = join(outDir, `${stem}-${index}.json`);
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
  return file;
}
