/**
 * Class-name gate: every class a spec reaches for must still exist, and no
 * source file may write a utility this project's Tailwind theme cannot generate.
 *
 * Both failures are silent by construction, which is why they need a gate:
 *
 * 1. A spec naming a retired class does not error — `locator(".sg-old")` simply
 *    matches nothing, so the assertion around it either fails on whichever
 *    browser lane happens to run that round, or passes vacuously forever.
 *    Epic #156 rewrote five routes and left stale selectors behind four
 *    separate times, each surfacing one lane at a time.
 * 2. `src/base.css` sets no base `--spacing`, so Tailwind v4 generates NOTHING
 *    for a numeric spacing utility such as `min-w-48`. The class reaches the
 *    markup and the constraint it names does not exist.
 *
 * The known-name universe is deliberately broad: class selectors declared in
 * any stylesheet this app ships or installs, plus every class-shaped token
 * written literally in non-test source. A name that survives a route rewrite in
 * any of those forms is real; one that survives in none of them is not.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

function find(dir, ...args) {
  const output = execFileSync("find", [dir, ...args], { cwd: root, encoding: "utf8" }).trim();
  return output === "" ? [] : output.split("\n");
}

const isTest = (path) => /(?:^|\/)(?:__tests__|tests)\//.test(path) || /\.(?:test|pw)\.tsx?$/.test(path);

/**
 * Drop comment text, which reaches no browser. Prose about a retired class —
 * "`min-w-48` generates nothing", "the retired `.sg-mapping-binding__flow`" —
 * is exactly what a module explaining one of these rules has to write down.
 */
function code(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  return line.replace(/\/\*.*?\*\//g, "").replace(/(?<!:)\/\/.*$/, "");
}

const styleSheets = [
  "src/base.css",
  ...find("src", "-name", "*.css"),
  ...find("node_modules/@zudo-sg/ui/styles", "-name", "*.css"),
];
const scriptFiles = find("src", "-type", "f", "(", "-name", "*.ts", "-o", "-name", "*.tsx", ")");
const sourceFiles = scriptFiles.filter((path) => !isTest(path));
const testFiles = [...find("tests", "-type", "f", "-name", "*.ts"), ...scriptFiles.filter(isTest)];

/** A BEM-ish class name: `cms-tree`, `cms-tree__row`, `cms-tree-cat--open`. */
const CLASS = "[a-z][a-zA-Z0-9]*(?:[-_]{1,2}[a-zA-Z0-9]+)+";
const CLASS_SHAPE = new RegExp(`^${CLASS}$`);

/* --------------------------------------------------------------------------
 * The universe of real class names
 * -------------------------------------------------------------------------- */

const known = new Set();
for (const path of styleSheets) {
  for (const line of read(path).split("\n")) {
    const brace = line.indexOf("{");
    if (brace === -1) continue;
    const selector = line.slice(0, brace);
    if (/^\s*@/.test(selector)) continue;
    for (const match of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) known.add(match[1]);
  }
}
for (const path of sourceFiles) {
  // Every whitespace-separated token of every string literal, with a leading
  // `.` stripped. A class written as `cx("cms-tree", open && "cms-tree--open")`
  // is reached the same way a `class="…"` attribute is, without parsing JSX,
  // and so are the CodeMirror selectors `markdown-editor.tsx` styles by name.
  for (const match of read(path).matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
    for (const token of match[1].split(/\s+/)) {
      const name = token.replace(/^[&.]+/, "");
      if (CLASS_SHAPE.test(name)) known.add(name);
    }
  }
}

// CodeMirror ships no stylesheet — it injects its theme from JS — so the
// editor's own class names come from the package instead, and `.cm-editor`
// is otherwise indistinguishable from a name the Content route retired.
for (const match of read("node_modules/@codemirror/view/dist/index.js").matchAll(/\bcm-[a-zA-Z0-9-]+/g)) {
  known.add(match[0]);
}

/** True when `name` is a live class, or the leading segments of one. */
function isKnown(name) {
  if (known.has(name)) return true;
  for (const candidate of known) {
    if (candidate.startsWith(name) && /^[-_]/.test(candidate.slice(name.length))) return true;
  }
  return false;
}

/* --------------------------------------------------------------------------
 * 1. Specs may not name a class that no longer exists
 * -------------------------------------------------------------------------- */

// Anchored on a non-word character so `page.locator(".cms-tree")` matches while
// the `.config` of `playwright.site-project.config.ts` does not, then extended
// over the whole compound so `.cms-tree-leaf-wrap.is-last` checks both halves.
const SELECTOR = new RegExp(`(?<![\\w$)\\]])((?:\\.${CLASS})+)`, "g");
const FILE_LITERAL = /["'`][^"'`\n]*\.(?:json|tmp|ts|tsx|js|mjs|css|html|md|png|svg|txt)["'`]/g;
// A spec may name a class precisely because it asserts the class is gone.
const ABSENCE = /\bnot\.(?:toMatch|toContain|toBeInTheDocument|toBeVisible)|toBeNull\(\)|toHaveCount\(0\)/;

const stale = [];
for (const path of testFiles) {
  const body = read(path);
  // Bare tokens in the same file: a spec may create the class it looks for,
  // as `<OverlayPortal hostClass="test-portal">` does.
  const local = new Set(
    [...body.matchAll(/["'`]([^"'`\n]*)["'`]/g)].flatMap((match) =>
      match[1].split(/\s+/).filter((token) => CLASS_SHAPE.test(token)),
    ),
  );
  body.split("\n").forEach((raw, index) => {
    const line = code(raw);
    if (ABSENCE.test(line)) return;
    for (const match of line.replace(FILE_LITERAL, '""').matchAll(SELECTOR)) {
      for (const name of match[1].split(".").filter(Boolean)) {
        if (isKnown(name) || local.has(name)) continue;
        stale.push(`${path}:${index + 1} names .${name}, which no stylesheet declares and no source file emits`);
      }
    }
  });
}
assert.deepEqual(stale, [], `stale class names in specs:\n  ${stale.join("\n  ")}`);

/* --------------------------------------------------------------------------
 * 2. Source may not write a spacing utility the theme cannot generate
 * -------------------------------------------------------------------------- */

// Guard the premise, not the symptom: if a base `--spacing` is ever defined,
// numeric utilities start generating and this rule must be retired rather than
// left forbidding something that now works.
assert.equal(
  styleSheets.some((path) => /--spacing:\s*\S/.test(read(path))),
  false,
  "a base `--spacing` token now exists, so numeric spacing utilities generate CSS — delete this check instead of working around it",
);

const SPACING =
  "(?:min-|max-)?[wh]|size|p[xytrbles]?|m[xytrbles]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|start|end|basis|indent|translate-[xy]";
// `-0` is excluded: Tailwind resolves a zero length without the scale, and
// `min-h-0` is the local-source proof `scripts/check-provider-boundary.mjs`
// asserts is emitted.
const NUMERIC_SPACING = new RegExp(`^(?:${SPACING})-(?:[1-9][0-9]*(?:\\.[0-9]+)?|0\\.[0-9]+)$`);

const ungenerated = [];
for (const path of sourceFiles) {
  read(path).split("\n").forEach((raw, index) => {
    for (const match of code(raw).matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
      for (const token of match[1].split(/\s+/)) {
        if (NUMERIC_SPACING.test(token.replace(/^(?:[a-z-]+:)+/, ""))) {
          ungenerated.push(`${path}:${index + 1} writes \`${token}\`, which generates no CSS without a base --spacing token`);
        }
      }
    }
  });
}
assert.deepEqual(ungenerated, [], `utilities that generate nothing:\n  ${ungenerated.join("\n  ")}`);

console.log(
  `Class-name gate passed: ${testFiles.length} spec files name only live classes (${known.size} known), ${sourceFiles.length} source files write no ungenerated spacing utility.`,
);
