import type { SiteCompiledRoute } from "../../src/site-project/compiler/types";
import type { JsonObject } from "../../src/composer/model/types";

export interface HostDocumentIdentity {
  workspaceId: string;
  revision: string;
  pathname: string;
  packId: string;
  packVersion: string;
  rendererId: string;
  rendererVersion: string;
  rendererDigest: string;
}
export interface HostDocumentTarget {
  renderedNodeId: string;
  providerId: string;
  recordId: string;
  nodeId: string;
  componentId: string;
  parentRenderedNodeId: string | null;
  slotId: string | null;
  /** Local page placeholder that owns this materialized root's arrangement. */
  placement?: { providerId: string; recordId: string; nodeId: string; parentNodeId: string | null; slotId: string | null };
  props: JsonObject;
  entries: readonly { providerId: string; modelId: string; recordId: string }[];
}
export interface HostDocumentRenderInput {
  route: SiteCompiledRoute;
  project?: import("../../src/site-project/model/types").SiteProject;
  identity: HostDocumentIdentity;
  targets: readonly HostDocumentTarget[];
}
/** Trusted host code, never model-generated source. Mark selectable elements with data-composer-target. */
export interface HostDocumentRenderer {
  renderDocument(input: HostDocumentRenderInput): string | Promise<string>;
}
export interface HostDocumentPreview {
  identity: HostDocumentIdentity;
  frameId: string;
  html: string;
  targets: readonly HostDocumentTarget[];
}
