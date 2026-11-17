import type { ContentEntryRecord, ContentEntryRef } from "../content/model";
import type { HostDocumentPreview, HostDocumentTarget } from "../../server/host-document/types";
export interface HostContentUse {
  sitemapProviderId: string; sitemapId: string; pageId: string; pathname: string; title: string;
  targets: readonly { target: Pick<HostDocumentTarget, "renderedNodeId" | "providerId" | "recordId" | "nodeId">; fieldId?: string; fieldLabel: string; prop: string }[];
}
export interface HostContentContext {
  mode: "saved-page"; workspaceId: string; revision: string;
  entry: ContentEntryRef; record: ContentEntryRecord;
  pack: { packId: string; packVersion: string };
  renderer: { id: string; version: string; digest: string };
  uses: readonly HostContentUse[];
  unsupported: string;
}
export interface HostContentDocument extends HostDocumentPreview {
  documentUrl: string; content: HostContentContext;
}
