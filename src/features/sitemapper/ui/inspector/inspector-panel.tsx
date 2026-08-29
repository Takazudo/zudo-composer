/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import type { CompositionCatalog } from "../../../../sitemapper/catalog";
import type { MappingAssignmentCatalog, SitemapNodeRouteInfo } from "../../../../sitemapper/routes";
import type { CompositionRef, SitemapNode, SitemapPageSource } from "../../../../sitemapper/model";
import { CompositionField } from "./composition-field";
import { MappingField } from "./mapping-field";
import { InspectorField, type InspectorTextProperty } from "./inspector-field";

export interface InspectorPanelProps {
  selectedId: string | null;
  node: SitemapNode | null;
  catalog: Pick<CompositionCatalog, "listCompositions" | "resolveComposition">;
  onUpdatePropsDebounced: (nodeId: string, patch: Partial<Pick<SitemapNode, "title" | "slug" | "notes">>) => void;
  onFlushPropUpdates?: () => void;
  onUpdateComposition: (nodeId: string, composition: CompositionRef | null) => void;
  mappingCatalog?: MappingAssignmentCatalog;
  routeInfo?: SitemapNodeRouteInfo;
  onUpdateSource?: (nodeId: string, source: SitemapPageSource) => void;
}

const TEXT_FIELDS: ReadonlyArray<{ prop: InspectorTextProperty; label: string; multiline?: boolean }> = [
  { prop: "title", label: "Title" },
  { prop: "slug", label: "Slug" },
  { prop: "notes", label: "Notes", multiline: true },
];

export function InspectorPanel({
  selectedId,
  node,
  catalog,
  onUpdatePropsDebounced,
  onFlushPropUpdates,
  onUpdateComposition,
  mappingCatalog,
  routeInfo,
  onUpdateSource,
}: InspectorPanelProps): JSX.Element {
  if (!selectedId || !node || node.id !== selectedId) {
    return (
      <aside class="sg-sitemapper-inspector" aria-label="Page inspector">
        <p class="sg-sitemapper-inspector__empty">Select a page to edit its details.</p>
      </aside>
    );
  }

  return (
    <aside class="sg-sitemapper-inspector" aria-label={`Inspector for ${node.title}`}>
      <header class="sg-sitemapper-inspector__header">
        <p>Page</p>
        <h2>{node.title}</h2>
      </header>
      <div class="sg-sitemapper-inspector__fields">
        {TEXT_FIELDS.map((field) => (
          <InspectorField
            key={`${selectedId}:${field.prop}`}
            prop={field.prop}
            label={field.label}
            value={node[field.prop] ?? ""}
            multiline={field.multiline}
            onCommit={(prop, value) => onUpdatePropsDebounced(selectedId, { [prop]: value })}
            onFlushPending={onFlushPropUpdates}
          />
        ))}
      </div>
      <section class="sg-sitemapper-composition" aria-labelledby="sg-sitemapper-source-label">
        <h3 id="sg-sitemapper-source-label">Page source</h3>
        <p>Current: {node.source.kind === "unassigned" ? "Unassigned" : node.source.kind === "composition" ? "Static Composition" : "Content Mapping"}</p>
      </section>
      {node.source.kind !== "mapping" && <CompositionField
          value={node.source.kind === "composition" ? node.source.ref : undefined}
          catalog={catalog}
          onChange={(composition) => onUpdateComposition(selectedId, composition)}
        />}
      {mappingCatalog && <MappingField value={node.source.kind === "mapping" ? node.source : undefined} routeInfo={routeInfo} catalog={mappingCatalog} onChange={(source) => onUpdateSource?.(selectedId, source)} />}
    </aside>
  );
}

export default InspectorPanel;
