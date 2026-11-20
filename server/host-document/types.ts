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
/** Informational captured provenance, never an editing capability. */
export interface HostFieldSource {
  prop: string;
  label: string;
  sources: readonly {
    entry: { providerId: string; modelId: string; recordId: string };
    fieldId?: string;
    fieldLabel: string;
    reason?: string;
    affectedUses: readonly { pathname: string; renderedNodeId: string; prop: string }[];
  }[];
  reason?: string;
}
export interface HostDocumentTarget {
  fieldSources?: readonly HostFieldSource[];
  presentation?: { label: string; kindTitle: string; transparent: boolean };
  capabilities?: {
    remove?: { allowed: boolean; reason?: string }; fields: { allowed: boolean; reason?: string }; structure: { allowed: boolean; reason?: string }; placement: { allowed: boolean; reason?: string };
    uses: readonly string[];
    insertSlots: readonly { slotId: string; label: string; reason?: string; components: readonly { id: string; title: string }[] }[];
  };
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
  navigation?: { url: string; pathnames: readonly string[] };
  targets: readonly HostDocumentTarget[];
}
