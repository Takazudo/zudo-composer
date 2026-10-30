// The browser half of the native editorial boundary: every method is one
// request to the dev server, which answers it with the same native adapter the
// scenario tests run.
import { EditorialError, type ContentEditorialBoundary, type EditorialErrorCode, type EditorialFieldDiagnostic } from "./types";

export type EditorialWireOperation =
  | "editorial-read" | "editorial-revisions" | "editorial-revision" | "editorial-compare"
  | "editorial-validate" | "editorial-save" | "editorial-restore" | "editorial-publication";
export type EditorialWireCall = (operation: EditorialWireOperation, payload: unknown) => Promise<unknown>;

const CODES: readonly EditorialErrorCode[] = ["invalid-request", "not-found", "forbidden", "invalid-value", "revision-conflict", "operation-key-reuse", "restore-incompatible", "configuration-required", "unavailable"];

function unwrap<T>(result: unknown): T {
  if (result && typeof result === "object" && "ok" in result) {
    if (result.ok === true && "value" in result) return result.value as T;
    const error = (result as { error?: { code?: unknown; message?: unknown; diagnostics?: unknown } }).error;
    if (error && typeof error.message === "string") {
      const code = CODES.includes(error.code as EditorialErrorCode) ? error.code as EditorialErrorCode : "unavailable";
      const diagnostics = Array.isArray(error.diagnostics) ? error.diagnostics.filter((item): item is EditorialFieldDiagnostic => !!item && typeof item === "object" && typeof (item as EditorialFieldDiagnostic).fieldId === "string") : [];
      throw new EditorialError(code, error.message, diagnostics);
    }
  }
  throw new EditorialError("unavailable", "The local Content provider returned a malformed editorial response.");
}

export function createRemoteContentEditorial(call: EditorialWireCall): ContentEditorialBoundary {
  const send = async <T>(operation: EditorialWireOperation, payload: unknown = {}): Promise<T> => unwrap<T>(await call(operation, payload));
  return {
    backend: "native",
    readEntry: (query) => send("editorial-read", query),
    listRevisions: (query) => send("editorial-revisions", query),
    readRevision: (query) => send("editorial-revision", query),
    compare: (query) => send("editorial-compare", query),
    validateFields: (request) => send("editorial-validate", request),
    saveFields: (request) => send("editorial-save", request),
    restoreRevision: (request) => send("editorial-restore", request),
    publicationStatus: () => send("editorial-publication"),
  };
}
