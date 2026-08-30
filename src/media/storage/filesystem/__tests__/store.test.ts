import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createMediaRecord } from "../../../library";
import { MEDIA_FILE_NAME_MAX_LENGTH } from "../../../model";
import { createFilesystemMediaStore } from "../store";

const sandboxes: string[] = [];
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nfixture");

async function sandbox(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), "zudo-media-store-"));
  sandboxes.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function options(root: string, extra: Record<string, unknown> = {}) {
  return {
    mediaStoreRoot: root,
    idFactory: () => "safe-id",
    randomToken: () => "fixed-safe-token",
    now: () => "2026-08-31T00:00:00.000Z",
    ...extra,
  };
}

function paths(root: string, extension = "png") {
  return {
    record: join(root, "records", "media-safe-id.json"),
    bytes: join(root, "public", "uploaded-media", `media-safe-id.${extension}`),
  };
}

describe("FilesystemMediaStore", () => {
  it("commits bytes first and leaves a list-skipped orphan if metadata commit fails", async () => {
    const root = await sandbox();
    const store = await createFilesystemMediaStore(options(root, {
      operations: {
        rename: async (from: string, to: string) => {
          if (to.endsWith(".json")) throw Object.assign(new Error("injected metadata failure"), { code: "EIO" });
          await fs.rename(from, to);
        },
      },
    }));

    await expect(store.upload({ fileName: "pixel.png", declaredMediaType: "image/png", bytes: PNG_BYTES }))
      .rejects.toMatchObject({ operation: "put", code: "write-failed" });
    await expect(fs.readFile(paths(root).bytes)).resolves.toEqual(Buffer.from(PNG_BYTES));
    await expect(fs.stat(paths(root).record)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.list()).resolves.toEqual([]);
  });

  it("mints the id and derives PDF metadata and extension from a signature that disagrees with the declaration", async () => {
    const root = await sandbox();
    const store = await createFilesystemMediaStore(options(root));
    const record = await store.upload({ fileName: "report.bin", declaredMediaType: "image/png", bytes: PDF_BYTES });

    expect(record).toMatchObject({
      id: "safe-id",
      document: { id: "safe-id", fileName: "report.bin", mediaType: "application/pdf", byteLength: PDF_BYTES.byteLength },
    });
    await expect(fs.readFile(paths(root, "pdf").bytes)).resolves.toEqual(Buffer.from(PDF_BYTES));
    await expect(fs.stat(join(root, "public", "uploaded-media", "media-safe-id.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("bounds display filenames and rejects controls without using them as paths", async () => {
    const root = await sandbox();
    const store = await createFilesystemMediaStore(options(root));
    await expect(store.upload({ fileName: `${"a".repeat(MEDIA_FILE_NAME_MAX_LENGTH)}\n`, declaredMediaType: "image/png", bytes: PNG_BYTES }))
      .rejects.toMatchObject({ code: "validation" });
    await expect(store.upload({ fileName: "../pixel.png", declaredMediaType: "image/png", bytes: PNG_BYTES }))
      .rejects.toMatchObject({ code: "validation" });
    await expect(fs.readdir(join(root, "records"))).resolves.toEqual([]);
  });

  it.each(["../escape", "encoded%2fslash", "with/slash", ".hidden", "CAPS"])("rejects unsafe id %s", async (id) => {
    const store = await createFilesystemMediaStore(options(await sandbox()));
    await expect(store.get(id)).rejects.toMatchObject({ operation: "get", code: "validation" });
    await expect(store.delete(id)).rejects.toMatchObject({ operation: "delete", code: "validation" });
  });

  it("refuses a symlinked store root", async () => {
    const parent = await sandbox();
    const target = join(parent, "target");
    const linked = join(parent, "linked");
    await fs.mkdir(target);
    await fs.symlink(target, linked, "dir");
    await expect(createFilesystemMediaStore(options(linked))).rejects.toMatchObject({ code: "blocked" });
  });

  it("refuses symlinked final byte and record paths", async () => {
    const byteRoot = await sandbox();
    const byteStore = await createFilesystemMediaStore(options(byteRoot));
    const byteTarget = join(byteRoot, "outside-byte");
    await fs.writeFile(byteTarget, "untouched");
    await fs.symlink(byteTarget, paths(byteRoot).bytes);
    await expect(byteStore.upload({ fileName: "pixel.png", declaredMediaType: "image/png", bytes: PNG_BYTES }))
      .rejects.toMatchObject({ code: "blocked" });
    await expect(fs.readFile(byteTarget, "utf8")).resolves.toBe("untouched");

    const recordRoot = await sandbox();
    const recordStore = await createFilesystemMediaStore(options(recordRoot));
    const recordTarget = join(recordRoot, "outside-record");
    await fs.writeFile(recordTarget, "untouched");
    await fs.symlink(recordTarget, paths(recordRoot).record);
    await expect(recordStore.upload({ fileName: "pixel.png", declaredMediaType: "image/png", bytes: PNG_BYTES }))
      .rejects.toMatchObject({ code: "blocked" });
    await expect(fs.readFile(recordTarget, "utf8")).resolves.toBe("untouched");
  });

  it("detects root replacement before mutation", async () => {
    const parent = await sandbox();
    const root = join(parent, "media-store");
    const store = await createFilesystemMediaStore(options(root));
    await fs.rename(root, join(parent, "original"));
    await fs.mkdir(root);

    await expect(store.upload({ fileName: "pixel.png", declaredMediaType: "image/png", bytes: PNG_BYTES }))
      .rejects.toMatchObject({ code: "blocked" });
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it("stops a pending signature read when the upload is aborted", async () => {
    const root = await sandbox();
    const store = await createFilesystemMediaStore(options(root));
    const controller = new AbortController();
    const source = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
          return: async () => ({ done: true as const, value: undefined }),
        };
      },
    };
    const upload = store.upload({ fileName: "pixel.png", declaredMediaType: "image/png", bytes: source, signal: controller.signal });
    controller.abort(new Error("client aborted"));
    await expect(upload).rejects.toThrow("client aborted");
    await expect(fs.readdir(join(root, "records"))).resolves.toEqual([]);
    await expect(fs.readdir(join(root, "public", "uploaded-media"))).resolves.toEqual([]);
  });

  it("keeps dangling records visible while get reports missing bytes", async () => {
    const root = await sandbox();
    const store = await createFilesystemMediaStore(options(root));
    await store.upload({ fileName: "pixel.png", declaredMediaType: "image/png", bytes: PNG_BYTES });
    await fs.unlink(paths(root).bytes);

    await expect(store.list()).resolves.toHaveLength(1);
    await expect(store.get("safe-id")).resolves.toMatchObject({ status: "bytes-missing", reason: "missing" });
  });

  it("reports checksum mismatch as bytes-missing", async () => {
    const root = await sandbox();
    const store = await createFilesystemMediaStore(options(root));
    await store.upload({ fileName: "pixel.png", declaredMediaType: "image/png", bytes: PNG_BYTES });
    await fs.writeFile(paths(root).bytes, Uint8Array.from([...PNG_BYTES.slice(0, -1), 9]));

    await expect(store.get("safe-id")).resolves.toMatchObject({ status: "bytes-missing", reason: "checksum-mismatch" });
  });

  it("deletes the record first and a retry is idempotent after byte deletion fails", async () => {
    const root = await sandbox();
    const bytesPath = paths(root).bytes;
    const store = await createFilesystemMediaStore(options(root, {
      operations: {
        unlink: async (path: string) => {
          if (path.endsWith("/public/uploaded-media/media-safe-id.png")) throw Object.assign(new Error("injected byte failure"), { code: "EIO" });
          await fs.unlink(path);
        },
      },
    }));
    await store.upload({ fileName: "pixel.png", declaredMediaType: "image/png", bytes: PNG_BYTES });

    await expect(store.delete("safe-id")).rejects.toMatchObject({ operation: "delete", code: "write-failed" });
    await expect(fs.stat(paths(root).record)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(bytesPath)).resolves.toEqual(Buffer.from(PNG_BYTES));
    await expect(store.delete("safe-id")).resolves.toBe(false);
  });

  it("clear removes records and orphan bytes while preserving unowned files", async () => {
    const root = await sandbox();
    const store = await createFilesystemMediaStore(options(root));
    await store.upload({ fileName: "pixel.png", declaredMediaType: "image/png", bytes: PNG_BYTES });
    const bytesDirectory = join(root, "public", "uploaded-media");
    await fs.writeFile(join(bytesDirectory, "media-orphan.pdf"), PDF_BYTES);
    await fs.writeFile(join(bytesDirectory, "keep.txt"), "keep");

    await store.clear();

    await expect(fs.readdir(join(root, "records"))).resolves.toEqual([]);
    await expect(fs.readdir(bytesDirectory)).resolves.toEqual(["keep.txt"]);
  });

  it("imports canonical records only when signature, length, and checksum agree", async () => {
    const root = await sandbox();
    const store = await createFilesystemMediaStore(options(root));
    const checksum = createHash("sha256").update(PNG_BYTES).digest("hex");
    const record = createMediaRecord({ fileName: "pixel.png", mediaType: "image/png", byteLength: PNG_BYTES.byteLength, checksum }, {
      id: "imported-id",
      timestamp: "2026-08-31T00:00:00.000Z",
    });
    await store.put(record, PNG_BYTES);
    await expect(store.get("imported-id")).resolves.toMatchObject({ status: "loaded", record: { id: "imported-id" } });
  });
});
