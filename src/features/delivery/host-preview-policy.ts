import { fileProviderConfig } from "virtual:composer-file-provider-config";
import { isSitePath, isWorkingPreviewPath } from "./routing";
/** Trusted serve-only configuration; deliberately independent of the authoring-route whitelist. */
export const hostDocumentPreviewConfigured = fileProviderConfig?.nativeEditing?.hostDocument === true;
export const savedHostPreviewHref = "/composer?native=1";
export function hostPreviewBoundary(pathname: string, configured: boolean): "working" | "activated" | null {
  if (!configured) return null;
  return isSitePath(pathname) ? "activated" : isWorkingPreviewPath(pathname) ? "working" : null;
}
