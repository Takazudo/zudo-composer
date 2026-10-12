import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { externalPreview } from "../src/config/preview.mjs";

const hostRoot = fileURLToPath(new URL("../", import.meta.url));
const evidence =
  process.env.SAMPLE_EVIDENCE_DIR ?? join(hostRoot, ".sample-build/evidence");
await mkdir(evidence, { recursive: true });
const storyFile = join(hostRoot, "stories/cards/card/card.stories.tsx");
const styleFile = join(hostRoot, "src/styles/preview-entry.css");
const [originalStory, originalStyle] = await Promise.all([
  readFile(storyFile, "utf8"),
  readFile(styleFile, "utf8"),
]);
const child = spawn(process.execPath, ["scripts/dev.mjs"], {
  cwd: hostRoot,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (bytes) => (output += bytes));
child.stderr.on("data", (bytes) => (output += bytes));
let browser;
let changed = false;
const origin = "http://127.0.0.1:4397";
async function waitReady(generation) {
  await expect
    .poll(
      async () => {
        if (child.exitCode !== null)
          throw Error(`dev runner exited ${child.exitCode}`);
        if ((output.match(/→ ready on/g) ?? []).length < generation)
          return false;
        try {
          const response = await fetch(`${origin}/__zfb/ready`);
          return response.ok && (await response.json()).ready;
        } catch {
          return false;
        }
      },
      { timeout: 180000, intervals: [1000] },
    )
    .toBe(true);
}
try {
  await waitReady(1);
  browser = await chromium.launch(
    process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {},
  );
  const page = await browser.newPage();
  const previewUrl = `${origin}${externalPreview.url}?slug=card&variant=Defaults`;
  await page.goto(previewUrl);
  await expect(
    page.getByRole("heading", { name: "Card heading", exact: true }),
  ).toBeVisible();
  const initialThumbnail = await readFile(
    join(hostRoot, "public/sample-thumbnails/card.png"),
  );
  changed = true;
  await writeFile(
    storyFile,
    originalStory
      .replace(
        'category: "Cards",',
        'category: "Cards",\n  description: "Watched metadata proof",',
      )
      .replace(
        "<Card {...cardComposer.defaults}>",
        '<Card {...cardComposer.defaults} title="Watched card proof">',
      ),
  );
  await writeFile(
    styleFile,
    originalStyle + "\nh3 { color: rgb(17, 34, 51) !important; }\n",
  );
  await waitReady(2);
  await page.goto(previewUrl);
  await expect(
    page.getByRole("heading", { name: "Watched card proof", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator("h3").evaluate((node) => getComputedStyle(node).color),
    )
    .toBe("rgb(17, 34, 51)");
  assert.notDeepEqual(
    await readFile(join(hostRoot, "public/sample-thumbnails/card.png")),
    initialThumbnail,
    "Watched thumbnail must change with the actual component",
  );
  const detail = await fetch(`${origin}/components/card`);
  assert.equal(detail.status, 200);
  assert(
    (await detail.text()).includes("Watched metadata proof"),
    "Watched descriptors must update the shell",
  );
  const html = await (await fetch(previewUrl)).text();
  assert(html.includes("/_sample-preview/preview.js"));
  assert(!html.includes("/assets/"), "dev must preserve preview isolation");
  console.log(
    "Watched story, metadata, CSS and settled thumbnail updates passed after serial rebuild/restart.",
  );
  await Promise.all([
    writeFile(storyFile, originalStory),
    writeFile(styleFile, originalStyle),
  ]);
  changed = false;
  await waitReady(3);
  await page.goto(previewUrl);
  await expect(
    page.getByRole("heading", { name: "Card heading", exact: true }),
  ).toBeVisible();
  console.log("Restored authored sources rebuilt correctly.");
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  if (child.exitCode === null && child.signalCode === null)
    await new Promise((resolve) => child.once("exit", resolve));
  if (changed)
    await Promise.all([
      writeFile(storyFile, originalStory),
      writeFile(styleFile, originalStyle),
    ]);
  await writeFile(join(evidence, "sample-spike-watched-dev.log"), output);
}
