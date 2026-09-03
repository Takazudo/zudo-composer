/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { RailCollapseButton } from "../../../../components/editor-chrome";
import { PageIcon, TrashIcon } from "../../../../components/icons";
import {
  Button,
  Chip,
  Field,
  Pane,
  PaneBody,
  PaneHeader,
  PaneSection,
  PaneTabs,
  SegmentedControl,
  Select,
} from "../../../../components/ui";
import type { CompositionCatalog } from "../../../../sitemapper/catalog";
import type { SitemapDocument, SitemapNode, SitemapPageSource } from "../../../../sitemapper/model";
import { indexDocument } from "../../../../sitemapper/model";
import type { MappingAssignmentCatalog, SitemapNodeRouteInfo } from "../../../../sitemapper/routes";
import { CompositionField } from "./composition-field";
import { MappingField } from "./mapping-field";
import { countDescendants } from "../tree/tree-helpers";
import { PageTextField, type PageTextProperty } from "./page-field";

type SourceKind = SitemapPageSource["kind"];
type InspectorTab = "page" | "source";

const SOURCE_OPTIONS = [
  { value: "unassigned" as const, label: "None" },
  { value: "composition" as const, label: "Composition" },
  { value: "mapping" as const, label: "Mapping" },
];

export interface InspectorPanelProps {
  document: SitemapDocument;
  node: SitemapNode | null;
  /** Authored route per page id; the Slug field shows the selected page's. */
  routes: ReadonlyMap<string, string>;
  catalog: Pick<CompositionCatalog, "listCompositions" | "resolveComposition">;
  mappingCatalog?: MappingAssignmentCatalog;
  routeInfo?: SitemapNodeRouteInfo;
  onUpdatePropsDebounced: (pageId: string, patch: Partial<Pick<SitemapNode, "title" | "slug" | "notes">>) => void;
  onFlushPropUpdates?: () => void;
  onUpdateSource: (pageId: string, source: SitemapPageSource) => void;
  onReparent: (pageId: string, parentId: string) => void;
  onDelete: (pageId: string) => void;
  /** Asks the one editor confirmation before a destructive answer. */
  onConfirm: (request: { title: string; message: string; confirmLabel: string; onConfirm: () => void }) => void;
}

/** The chip beside the page name: what renders it right now. */
function assignmentChip(node: SitemapNode, routeInfo?: SitemapNodeRouteInfo): JSX.Element {
  if (node.source.kind === "composition") return <Chip tone="ok" dot>Composition</Chip>;
  if (node.source.kind === "mapping") {
    return <Chip tone={routeInfo?.status === "blocked" ? "warn" : "accent"} dot>Mapping</Chip>;
  }
  return <Chip tone="warn" dot>Unassigned</Chip>;
}

export function InspectorPanel({
  document,
  node,
  routes,
  catalog,
  mappingCatalog,
  routeInfo,
  onUpdatePropsDebounced,
  onFlushPropUpdates,
  onUpdateSource,
  onReparent,
  onDelete,
  onConfirm,
}: InspectorPanelProps): JSX.Element {
  const [tab, setTab] = useState<InspectorTab>("page");
  const [kind, setKind] = useState<SourceKind>(node?.source.kind ?? "unassigned");
  const sourceKind = node?.source.kind;
  const pageId = node?.id;

  // The segmented control can stand ahead of the document — "Composition" is
  // chosen before one is picked — but a page change or an assignment made
  // elsewhere resets it to what is actually persisted.
  useEffect(() => {
    setKind(sourceKind ?? "unassigned");
  }, [pageId, sourceKind]);

  const index = useMemo(() => indexDocument(document), [document]);
  const parentOptions = useMemo(() => {
    if (!node) return [];
    const excluded = new Set<string>();
    const collect = (current: SitemapNode): void => {
      excluded.add(current.id);
      current.children.forEach(collect);
    };
    collect(node);
    return [...index.byId.values()]
      .filter((location) => !excluded.has(location.node.id) && location.node.source.kind !== "mapping")
      .map((location) => ({ id: location.node.id, title: location.node.title }));
  }, [index, node]);

  if (!node) {
    return (
      <Pane label="Inspector">
        <PaneHeader title="Inspector" actions={<RailCollapseButton rail="insp" />} />
        <PaneBody padded>
          <p class="sg-sitemapper-inspector__empty">Select a page to edit its details.</p>
        </PaneBody>
      </Pane>
    );
  }

  const location = index.byId.get(node.id);
  const isRoot = location?.parentId === null;
  const descendants = countDescendants(node);

  function commit(prop: PageTextProperty, value: string): void {
    onUpdatePropsDebounced(node!.id, { [prop]: value });
  }

  function chooseKind(next: SourceKind): void {
    if (next === kind) return;
    const assigned = node!.source.kind;
    if (assigned === "unassigned" || assigned === next) {
      setKind(next);
      return;
    }
    onConfirm({
      title: assigned === "composition" ? "Clear the assigned composition?" : "Clear the assigned mapping?",
      message: "A page renders either a composition or a mapping route family, so switching removes the current one.",
      confirmLabel: "Clear",
      onConfirm: () => {
        onUpdateSource(node!.id, { kind: "unassigned" });
        setKind(next);
      },
    });
  }

  return (
    <Pane label="Inspector">
      <PaneHeader
        title={<span class="sg-sitemapper-inspector__name"><PageIcon size="sm" />{node.title}</span>}
        actions={<RailCollapseButton rail="insp" />}
      >
        {assignmentChip(node, routeInfo)}
      </PaneHeader>
      <PaneTabs
        label="Inspector"
        tabs={[{ id: "page", label: "Page" }, { id: "source", label: "Source" }]}
        activeId={tab}
        onSelect={setTab}
      />
      <PaneBody>
        {tab === "page" ? (
          <PaneSection title="Page">
            <PageTextField
              key={`${node.id}:title`}
              prop="title"
              label="Title"
              value={node.title}
              onCommit={commit}
              onFlushPending={onFlushPropUpdates}
            />
            <PageTextField
              key={`${node.id}:slug`}
              prop="slug"
              label="Slug"
              mono
              value={node.slug ?? ""}
              help={<code class="sg-sitemapper-mono">{routes.get(node.id) ?? "/"}</code>}
              onCommit={commit}
              onFlushPending={onFlushPropUpdates}
            />
            <Field label="Parent" help={isRoot ? "The root page has no parent." : undefined}>
              <Select
                size="sm"
                disabled={isRoot}
                value={location?.parentId ?? ""}
                onChange={(event) => {
                  const parentId = event.currentTarget.value;
                  if (parentId) onReparent(node.id, parentId);
                }}
              >
                {isRoot ? <option value="">No parent</option> : null}
                {parentOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
              </Select>
            </Field>
            <PageTextField
              key={`${node.id}:notes`}
              prop="notes"
              label="Notes"
              multiline
              placeholder="Internal notes about this page…"
              value={node.notes ?? ""}
              onCommit={commit}
              onFlushPending={onFlushPropUpdates}
            />
          </PaneSection>
        ) : (
          <>
            <PaneSection title="Page source">
              <Field
                label="Page source"
                help="A page renders either a composition or a mapping route family. Switching clears the other."
              >
                <SegmentedControl
                  class="sg-sitemapper-source__switch"
                  label="Page source type"
                  options={SOURCE_OPTIONS}
                  value={kind}
                  onChange={chooseKind}
                />
              </Field>
              {kind === "composition" ? (
                <CompositionField
                  value={node.source.kind === "composition" ? node.source.ref : undefined}
                  catalog={catalog}
                  onChange={(ref) => onUpdateSource(node.id, ref ? { kind: "composition", ref } : { kind: "unassigned" })}
                />
              ) : null}
              {kind === "mapping" && mappingCatalog ? (
                <MappingField
                  value={node.source.kind === "mapping" ? node.source : undefined}
                  routeInfo={routeInfo}
                  catalog={mappingCatalog}
                  onChange={(source) => onUpdateSource(node.id, source)}
                />
              ) : null}
              {kind === "mapping" && !mappingCatalog ? (
                <p class="sg-sitemapper-inspector__empty">No Mapping provider is mounted in this build.</p>
              ) : null}
              {kind === "unassigned" ? (
                <p class="sg-sitemapper-inspector__empty">This page renders nothing until a source is assigned.</p>
              ) : null}
            </PaneSection>
            <PaneSection title="Danger">
              <Button
                variant="danger"
                size="sm"
                disabled={isRoot}
                onClick={() => onDelete(node.id)}
              >
                <TrashIcon size="sm" />
                Delete page…
              </Button>
              <p class="cms-field__help">
                {isRoot
                  ? "The root page cannot be deleted."
                  : descendants > 0
                    ? `Its ${descendants} sub-${descendants === 1 ? "page" : "pages"} are deleted with it.`
                    : "This page is deleted permanently."}
              </p>
            </PaneSection>
          </>
        )}
      </PaneBody>
    </Pane>
  );
}

export default InspectorPanel;
