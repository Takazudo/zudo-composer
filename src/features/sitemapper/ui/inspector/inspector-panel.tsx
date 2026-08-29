/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import type { CompositionCatalog } from "../../../../sitemapper/catalog";
import type { CompositionRef, SitemapNode } from "../../../../sitemapper/model";
import { CompositionField } from "./composition-field";
import { InspectorField, type InspectorTextProperty } from "./inspector-field";

export interface InspectorPanelProps {
  selectedId: string | null;
  node: SitemapNode | null;
  catalog: Pick<CompositionCatalog, "listCompositions" | "resolveComposition">;
  onUpdatePropsDebounced: (nodeId: string, patch: Partial<Pick<SitemapNode, "title" | "slug" | "notes">>) => void;
  onFlushPropUpdates?: () => void;
  onUpdateComposition: (nodeId: string, composition: CompositionRef | null) => void;
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
      <CompositionField
        value={node.composition}
        catalog={catalog}
        onChange={(composition) => onUpdateComposition(selectedId, composition)}
      />
    </aside>
  );
}

export default InspectorPanel;
