import { createHash } from "node:crypto";
import { lstat, readFile, readdir, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const MEDIA_RECORD_ID = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;
const MEDIA_EXTENSION: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

// A valid 1x1 PNG keeps the browser assertion meaningful without committing a
// binary fixture to the repository or to media-store.
const UPLOAD_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const mediaStoreRoot = resolve(projectRoot, "media-store");
if (relative(projectRoot, mediaStoreRoot) !== "media-store") {
  throw new Error("The browser test media-store path escaped the project root.");
}
const recordsRoot = resolve(mediaStoreRoot, "records");
const bytesRoot = resolve(mediaStoreRoot, "public", "uploaded-media");

type MediaRecordReference = { id: string; extension: string };

function ownedFile(parent: string, name: string): string {
  if (name.length === 0 || name === "." || name === ".." || /[\\/\0]/u.test(name)) {
    throw new Error(`Refusing to resolve an unsafe media filename: ${JSON.stringify(name)}`);
  }
  const target = resolve(parent, name);
  if (relative(parent, target) !== name) {
    throw new Error(`Refusing to resolve a media path outside its owned directory: ${name}`);
  }
  return target;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is { id: unknown; document: { fileName: unknown; mediaType: unknown } } {
  if (typeof value !== "object" || value === null || !("id" in value) || !("document" in value)) return false;
  const document = value.document;
  return typeof document === "object" && document !== null && "fileName" in document && "mediaType" in document;
}

async function findRecords(fileName: string): Promise<MediaRecordReference[]> {
  let entries;
  try {
    entries = await readdir(recordsRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const matches: MediaRecordReference[] = [];
  for (const entry of entries) {
    const match = /^media-([a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?)\.json$/u.exec(entry.name);
    if (!match || !entry.isFile() || !MEDIA_RECORD_ID.test(match[1]!)) continue;
    const recordPath = ownedFile(recordsRoot, entry.name);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(recordPath, "utf8"));
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    if (!isRecord(raw) || raw.id !== match[1] || raw.document.fileName !== fileName) continue;
    const extension = MEDIA_EXTENSION[String(raw.document.mediaType)];
    if (extension === undefined) continue;
    matches.push({ id: match[1], extension });
  }
  return matches;
}

async function removeFileIfOwned(parent: string, name: string): Promise<void> {
  const path = ownedFile(parent, name);
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Refusing to remove a non-regular media path: ${path}`);
    await unlink(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function cleanupRecords(fileName: string, uploaded?: MediaRecordReference): Promise<void> {
  const records = uploaded === undefined ? await findRecords(fileName) : [uploaded];
  for (const record of records) {
    await removeFileIfOwned(bytesRoot, `media-${record.id}.${record.extension}`);
    await removeFileIfOwned(recordsRoot, `media-${record.id}.json`);
  }
}

test("uploads real media bytes through the dev provider and renders the stored image", async ({ page }) => {
  test.setTimeout(120_000);
  const fileName = `playwright-dev-${process.pid}-${test.info().workerIndex}-${test.info().repeatEachIndex}.png`;
  let uploaded: MediaRecordReference | undefined;

  try {
    await page.goto("/media");
    await expect(page.getByRole("heading", { name: "Media library", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Upload media", exact: true })).toBeVisible();

    const uploadResponsePromise = page.waitForResponse((response) => {
      return response.url().endsWith("/__zudo_composer_media_file_provider")
        && response.request().method() === "POST"
        && response.request().headers()["x-zudo-composer-media-operation"] === "upload";
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "image/png",
      buffer: UPLOAD_BYTES,
    });
    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.ok()).toBe(true);
    const payload = await uploadResponse.json() as {
      ok: boolean;
      result?: { id: string; document: { fileName: string; mediaType: string; byteLength: number; checksum: string } };
    };
    expect(payload.ok).toBe(true);
    expect(payload.result).toBeDefined();
    const result = payload.result!;
    expect(MEDIA_RECORD_ID.test(result.id)).toBe(true);
    const extension = MEDIA_EXTENSION[result.document.mediaType];
    expect(extension).toBe("png");
    expect(result.document.fileName).toBe(fileName);
    expect(result.document.byteLength).toBe(UPLOAD_BYTES.byteLength);
    expect(result.document.checksum).toBe(createHash("sha256").update(UPLOAD_BYTES).digest("hex"));
    uploaded = { id: result.id, extension };

    const uploadStatus = page.getByRole("list", { name: "Upload status" });
    await expect(uploadStatus).toContainText(fileName);
    await expect(uploadStatus.getByText("Stored", { exact: true })).toBeVisible();
    const card = page.locator(".sg-media-card").filter({ hasText: fileName });
    await expect(card).toHaveCount(1);
    const galleryImage = card.locator("img");
    const publicPath = `/uploaded-media/media-${result.id}.${extension}`;
    await galleryImage.scrollIntoViewIfNeeded();
    await expect(galleryImage).toBeVisible();
    await expect(galleryImage).toHaveAttribute("src", publicPath);
    await expect.poll(() => galleryImage.evaluate((image) => {
      const rendered = image as HTMLImageElement;
      return rendered.complete && rendered.naturalWidth > 0;
    })).toBe(true);

    const storedPath = ownedFile(bytesRoot, `media-${result.id}.${extension}`);
    await expect(readFile(storedPath)).resolves.toEqual(UPLOAD_BYTES);
    const storedRecord = JSON.parse(await readFile(ownedFile(recordsRoot, `media-${result.id}.json`), "utf8")) as {
      id: string;
      document: { id: string; fileName: string; mediaType: string; byteLength: number; checksum: string };
    };
    expect(storedRecord).toMatchObject({
      id: result.id,
      document: {
        id: result.id,
        fileName,
        mediaType: "image/png",
        byteLength: UPLOAD_BYTES.byteLength,
        checksum: result.document.checksum,
      },
    });

    // The filesystem provider names public bytes by its safe record id. The
    // gallery now uses that exact public URL, so the naturalWidth check above
    // proves this is an actual image decode/render, not just a visible card.
    const publicResponse = await page.request.get(publicPath);
    expect(publicResponse.ok()).toBe(true);
    expect(publicResponse.headers()["content-type"]).toMatch(/^image\/png/);
    await expect(publicResponse.body()).resolves.toEqual(UPLOAD_BYTES);
  } finally {
    await cleanupRecords(fileName, uploaded);
  }
});
