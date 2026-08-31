export interface FileTransfer {
  readonly files?: ArrayLike<File> | null;
  readonly items?: ArrayLike<Pick<DataTransferItem, "kind" | "getAsFile">> | null;
}

const extensionByMime: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function filesFromItems(items: FileTransfer["items"]): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

export function normalizedFilesFromTransfer(transfer: FileTransfer): File[] {
  const itemFiles = filesFromItems(transfer.items);
  return itemFiles.length > 0 ? itemFiles : Array.from(transfer.files ?? []);
}

export type UploadNow = number | (() => number);

export function normalizedClipboardFiles(transfer: FileTransfer, now: UploadNow = Date.now): File[] {
  const files = normalizedFilesFromTransfer(transfer);
  if (files.length === 0) return files;
  const timestamp = typeof now === "function" ? now() : now;
  return files.map((file) => {
    if (file.name) return file;
    const extension = extensionByMime[file.type.toLowerCase()] ?? "bin";
    return new File([file], `pasted-image-${timestamp}.${extension}`, {
      type: file.type || "application/octet-stream",
      lastModified: file.lastModified,
    });
  });
}

export function uploadExtensionForMime(mime: string): string {
  return extensionByMime[mime.toLowerCase()] ?? "bin";
}
