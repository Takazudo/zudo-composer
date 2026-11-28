import { computed, Show, signal, type Child, type ReadonlySignal, type Signal } from "@takazudo/zfb/zudo-react";
import { RailCollapseButton, type EditorRailsController } from "../../../../components/editor-chrome";
import { derive, followModel, memo, toSignal, type MaybeSignal } from "../../../../components/reactive";
import { Rebuild } from "../../../../components/rebuild";
import { Keyed } from "../../../../runtime";
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
import { countDescendants } from "../tree/tree-helpers";
import { HostPageAuthoringLink } from "./host-page-authoring-link";
import { CompositionField } from "./composition-field";
import { MappingField } from "./mapping-field";
import { PageTextField, type PageTextProperty } from "./page-field";

type SourceKind = SitemapPageSource["kind"];
type InspectorTab = "page" | "source";

const SOURCE_OPTIONS = [
  { value: "unassigned" as const, label: "None" },
  { value: "composition" as const, label: "Composition" },
  { value: "mapping" as const, label: "Mapping" },
];

export interface InspectorPanelProps {
  sitemap?: MaybeSignal<{ providerId: string; recordId: string; active: boolean } | undefined>;
  document: MaybeSignal<SitemapDocument>;
  node: MaybeSignal<SitemapNode | null>;
  /** Authored route per page id; the Slug field shows the selected page's. */
  routes: MaybeSignal<ReadonlyMap<string, string>>;
  catalog: Pick<CompositionCatalog, "listCompositions" | "resolveComposition">;
  mappingCatalog?: MappingAssignmentCatalog;
  routeInfo?: MaybeSignal<SitemapNodeRouteInfo | undefined>;
  /** The editor body's rails controller, for the collapse control. */
  rails?: EditorRailsController;
  onUpdatePropsDebounced: (pageId: string, patch: Partial<Pick<SitemapNode, "title" | "slug" | "notes">>) => void;
  onFlushPropUpdates?: () => void;
  onUpdateSource: (pageId: string, source: SitemapPageSource) => void;
  onReparent: (pageId: string, parentId: string) => void;
  onDelete: (pageId: string) => void;
  /** Asks the one editor confirmation before a destructive answer. */
  onConfirm: (request: { title: string; message: string; confirmLabel: string; onConfirm: () => void }) => void;
}

/** The chip beside the page name: what renders it right now. */
function assignmentChip(kind: SourceKind, status: SitemapNodeRouteInfo["status"] | undefined): Child {
  if (kind === "composition") return <Chip tone="ok" dot>Composition</Chip>;
  if (kind === "mapping") {
    return <Chip tone={status === "blocked" ? "warn" : "accent"} dot>Mapping</Chip>;
  }
  return <Chip tone="warn" dot>Unassigned</Chip>;
}

export function InspectorPanel(props: InspectorPanelProps): Child {
  const node = toSignal(props.node);
  const rails = props.rails;
  const collapse = rails ? <RailCollapseButton rail="insp" rails={rails} /> : undefined;
  // Both survive a selection change, as the panel's own state did.
  const tab = signal<InspectorTab>("page");
  const chosen = signal<{ pageId: string; kind: SourceKind } | null>(null);
  return (
    <>
      <Show when={computed(() => node.value === null)}>{() => (
        <Pane label="Inspector">
          <PaneHeader title="Inspector" actions={collapse} />
          <PaneBody padded>
            <p class="sg-sitemapper-inspector__empty">Select a page to edit its details.</p>
          </PaneBody>
        </Pane>
      )}</Show>
      {/* Keyed by page: switching selection discards a focused draft. */}
      <Keyed value={computed(() => node.value?.id ?? null)} by={(id) => id ?? ""}>{(id) => id.value === null ? null : (
        <PageInspector {...props} node={node as ReadonlySignal<SitemapNode | null>} tab={tab} chosen={chosen} collapse={collapse} />
      )}</Keyed>
    </>
  );
}

function PageInspector({
  sitemap: sitemapInput,
  document: documentInput,
  node: nodeInput,
  routes: routesInput,
  catalog,
  mappingCatalog,
  routeInfo: routeInfoInput,
  onUpdatePropsDebounced,
  onFlushPropUpdates,
  onUpdateSource,
  onReparent,
  onDelete,
  onConfirm,
  tab,
  chosen,
  collapse,
}: Omit<InspectorPanelProps, "node"> & { node: ReadonlySignal<SitemapNode | null>; tab: Signal<InspectorTab>; chosen: Signal<{ pageId: string; kind: SourceKind } | null>; collapse: Child }): Child {
  let last = nodeInput.value!;
  // Kept across the one pass in which the selection is cleared and this inspector leaves.
  const node = computed(() => { last = nodeInput.value ?? last; return last; });
  const pageId = last.id;
  const document = toSignal(documentInput);
  const routes = toSignal(routesInput);
  const routeInfo = toSignal(routeInfoInput);
  const sitemap = toSignal(sitemapInput);
  const sourceKind = computed(() => node.value.source.kind);

  // The segmented control stands ahead of the document only while the page has
  // nothing assigned: "Composition" is chosen before one is picked, and
  // switching away from an assigned source clears it first, so the chosen kind
  // has to survive that clear or the author is sent back to None mid-switch.
  //
  // Derived rather than synchronised, because an effect that mirrors the
  // document cannot tell the clear this control just performed from one made
  // anywhere else. The moment anything is actually assigned — here or in
  // another surface — the document wins.
  const kind = computed<SourceKind>(() => {
    const choice = chosen.value;
    return choice !== null && choice.pageId === pageId && sourceKind.value === "unassigned" ? choice.kind : sourceKind.value;
  });

  const index = derive(() => [document.value] as const, indexDocument);
  const parentOptions = computed(() => {
    const excluded = new Set<string>();
    const collect = (current: SitemapNode): void => {
      excluded.add(current.id);
      current.children.forEach(collect);
    };
    collect(node.value);
    return [...index.value.byId.values()]
      .filter((location) => !excluded.has(location.node.id) && location.node.source.kind !== "mapping")
      .map((location) => ({ id: location.node.id, title: location.node.title }));
  });
  const location = computed(() => index.value.byId.get(pageId));
  const isRoot = computed(() => location.value?.parentId === null);
  const descendants = computed(() => countDescendants(node.value));

  function commit(prop: PageTextProperty, value: string): void {
    onUpdatePropsDebounced(pageId, { [prop]: value });
  }

  function chooseKind(next: SourceKind): void {
    if (next === kind.value) return;
    const assigned = node.value.source.kind;
    if (assigned === "unassigned" || assigned === next) {
      chosen.value = { pageId, kind: next };
      return;
    }
    onConfirm({
      title: assigned === "composition" ? "Clear the assigned composition?" : "Clear the assigned mapping?",
      message: "A page renders either a composition or a mapping route family, so switching removes the current one.",
      confirmLabel: "Clear",
      onConfirm: () => {
        onUpdateSource(pageId, { kind: "unassigned" });
        chosen.value = { pageId, kind: next };
      },
    });
  }

  const parentKey = computed(() => `${isRoot.value}|${parentOptions.value.map((option) => `${option.id}\u0000${option.title}`).join("\u0001")}`);

  return (
    <Pane label="Inspector">
      <PaneHeader
        title={<span class="sg-sitemapper-inspector__name"><PageIcon size="sm" />{computed(() => node.value.title)}</span>}
        actions={collapse}
      >
        <Rebuild value={memo(() => [sourceKind.value, routeInfo.value?.status] as const)}>{([currentKind, status]) => assignmentChip(currentKind, status)}</Rebuild>
      </PaneHeader>
      <Rebuild value={memo(() => [sitemap.value, routeInfo.value] as const)}>{([currentSitemap, info]) => (
        <HostPageAuthoringLink sitemap={currentSitemap} pageId={pageId} routeInfo={info} flush={onFlushPropUpdates} />
      )}</Rebuild>
      <PaneTabs
        label="Inspector"
        tabs={[{ id: "page", label: "Page" }, { id: "source", label: "Source" }]}
        activeId={tab}
        onSelect={(next) => { tab.value = next; }}
      />
      <PaneBody>
        <Show when={computed(() => tab.value === "page")}>{() => (
          <PaneSection title="Page">
            <PageTextField
              prop="title"
              label="Title"
              value={computed(() => node.value.title)}
              onCommit={commit}
              onFlushPending={onFlushPropUpdates}
            />
            <PageTextField
              prop="slug"
              label="Slug"
              mono
              value={computed(() => node.value.slug ?? "")}
              help={<code class="sg-sitemapper-mono">{computed(() => routes.value.get(pageId) ?? "/")}</code>}
              onCommit={commit}
              onFlushPending={onFlushPropUpdates}
            />
            <Field label="Parent" help={computed(() => isRoot.value ? "The root page has no parent." : null)}>
              {(field) => (
                <Keyed value={parentKey} by={(key) => key}>{() => {
                  const root = isRoot.value;
                  const model = followModel(() => location.value?.parentId ?? "");
                  return (
                    <Select
                      size="sm"
                      field={field}
                      disabled={root}
                      modelValue={model}
                      on:change={(event) => {
                        const parentId = event.currentTarget.value;
                        if (parentId) onReparent(pageId, parentId);
                      }}
                    >
                      {root ? <option value="">No parent</option> : null}
                      {parentOptions.value.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
                    </Select>
                  );
                }}</Keyed>
              )}
            </Field>
            <PageTextField
              prop="notes"
              label="Notes"
              multiline
              placeholder="Internal notes about this page…"
              value={computed(() => node.value.notes ?? "")}
              onCommit={commit}
              onFlushPending={onFlushPropUpdates}
            />
          </PaneSection>
        )}</Show>
        <Show when={computed(() => tab.value === "source")}>{() => (
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
              <Show when={computed(() => kind.value === "composition")}>{() => (
                <CompositionField
                  value={computed(() => { const source = node.value.source; return source.kind === "composition" ? source.ref : undefined; })}
                  catalog={catalog}
                  onChange={(ref) => onUpdateSource(pageId, ref ? { kind: "composition", ref } : { kind: "unassigned" })}
                />
              )}</Show>
              {mappingCatalog ? (
                <Show when={computed(() => kind.value === "mapping")}>{() => (
                  <MappingField
                    value={computed(() => { const source = node.value.source; return source.kind === "mapping" ? source : undefined; })}
                    routeInfo={routeInfo}
                    catalog={mappingCatalog}
                    onChange={(source) => onUpdateSource(pageId, source)}
                  />
                )}</Show>
              ) : (
                <Show when={computed(() => kind.value === "mapping")}>{() => (
                  <p class="sg-sitemapper-inspector__empty">No Mapping provider is mounted in this build.</p>
                )}</Show>
              )}
              <Show when={computed(() => kind.value === "unassigned")}>{() => (
                <p class="sg-sitemapper-inspector__empty">This page renders nothing until a source is assigned.</p>
              )}</Show>
            </PaneSection>
            <PaneSection title="Danger">
              <Button
                variant="danger"
                size="sm"
                disabled={isRoot}
                on:click={() => onDelete(pageId)}
              >
                <TrashIcon size="sm" />
                Delete page…
              </Button>
              <p class="cms-field__help">
                {computed(() => isRoot.value
                  ? "The root page cannot be deleted."
                  : descendants.value > 0
                    ? `Its ${descendants.value} sub-${descendants.value === 1 ? "page" : "pages"} are deleted with it.`
                    : "This page is deleted permanently.")}
              </p>
            </PaneSection>
          </>
        )}</Show>
      </PaneBody>
    </Pane>
  );
}

export default InspectorPanel;
