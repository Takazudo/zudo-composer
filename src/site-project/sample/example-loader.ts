import type { MediaFileProvider } from "../../media";
import { currentMediaVersion } from "../../media";
import { serializeSiteProject, type SiteProject, type SiteProjectValidationContext } from "../model";
import { loadCatalogEditorialSiteProject } from "./catalog-editorial";

export const EXAMPLE_PDF_URL = "/uploaded-media/deployment-sample.pdf";
export const EXAMPLE_PDF_CHECKSUM = "e268488c410059adbef72560b28e0e20c992c2d597d40501047f5a59ed1ea2f2";
export interface ExampleCommitOptions { attemptId: string; beforeComplete(): Promise<void> }
export interface ExampleCreationResult<T> { value: T; mediaStatus: "current" | "changed"; message?: string }
const PDF_BYTES = 321;
async function digest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Invoke inside the application's replacement gate, only after confirmation.
 * Media is additive/global; a successful upload is retained if later creation
 * fails. The next attempt discovers and verifies it instead of uploading again.
 */
export async function createCatalogEditorialExample<T>(options: {
  confirmed: boolean;
  context: SiteProjectValidationContext;
  media: MediaFileProvider | null | undefined;
  loadExample(project: SiteProject, revision: string, commit: ExampleCommitOptions): Promise<T>;
  fetch?: typeof fetch;
}): Promise<ExampleCreationResult<T> | undefined> {
  if (!options.confirmed) return undefined;
  if (!options.media) throw new Error("Creating the full example requires the local development Media upload provider. Detached inspection remains available.");
  // Validate the template before any additive Media write.
  loadCatalogEditorialSiteProject(options.context);
  const { store, descriptor } = options.media;
  const snapshot = await store.snapshot();
  let record = snapshot.records.find((record) => record.document.state === "active" && currentMediaVersion(record).checksum === EXAMPLE_PDF_CHECKSUM);
  if (!record) {
    const response = await (options.fetch ?? fetch)(EXAMPLE_PDF_URL, { credentials: "same-origin", redirect: "error" });
    if (!response.ok) throw new Error("The committed example PDF is unavailable; no workspace was created.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== PDF_BYTES || await digest(bytes) !== EXAMPLE_PDF_CHECKSUM) throw new Error("The committed example PDF failed integrity verification; no upload was attempted.");
    record = await store.upload(new File([bytes], "catalog-editorial-blank-sample.pdf", { type: "application/pdf" }), { note: "Optional catalog/editorial example: intentionally blank PDF for per-use link labels.", expectedMutationToken: snapshot.mutationToken });
  }
  const version = currentMediaVersion(record);
  const ref = { providerId: descriptor.id, assetId: record.id };
  const pin = await store.resolveVersion({ ...ref, versionId: version.id });
  if (pin.checksum !== EXAMPLE_PDF_CHECKSUM || pin.byteLength !== PDF_BYTES || pin.mediaType !== "application/pdf") throw new Error("Example Media does not match the committed PDF. The current workspace is unchanged.");
  const captured = await store.snapshot();
  const assertHead = (snapshot: typeof captured) => {
    const current = snapshot.records.find(({ id }) => id === record!.id);
    if (snapshot.mutationToken !== captured.mutationToken || !current || current.document.state !== "active" || current.revision !== record!.revision || current.document.currentVersionId !== version.id || currentMediaVersion(current).checksum !== pin.checksum) throw new Error("Example Media changed before workspace selection. Retry with a fresh Media snapshot; the prior workspace remains selected.");
  };
  assertHead(captured);
  const beforeComplete = async () => {
    assertHead(await store.snapshot());
    const resolved = await store.resolveVersion({ ...ref, versionId: version.id });
    if (JSON.stringify(resolved) !== JSON.stringify(pin)) throw new Error("Example Media pin changed before workspace selection.");
    // resolveVersion performs byte I/O; close that await gap with the token/head read.
    assertHead(await store.snapshot());
  };
  const project = loadCatalogEditorialSiteProject(options.context, ref);
  const revision = await digest(new TextEncoder().encode(serializeSiteProject(project)));
  const value = await options.loadExample(project, revision, { attemptId: `example-${revision}`, beforeComplete });
  try { await beforeComplete(); return { value, mediaStatus: "current" }; }
  catch { return { value, mediaStatus: "changed", message: "Example workspace was created. The checked Media state changed or became unavailable after the selection check; inspect Media before preview or release. Authoring references are not permanently pinned." }; }
}
