// The Composer inspector: three tabs over one selection.
//
// Purely presentational over the shared document model and controller
// contracts — it reads `document`/`manifest`/`selectedId`/`mode` (plain values
// or signals) and reports every mutation through typed callbacks, never
// touching commands or storage. The selected node's field editors stay mounted
// while the document updates, so a focused field keeps its caret.
//
// The tabs exist because the three things this pane carries answer different
// questions and used to be stacked: reuse guidance is document-scoped and was
// pushing the props an author came to edit below the fold, and the slot list is
// navigation rather than editing. Properties is what opens.
//
// Layered behaviour:
//  - identity, parent and position are derived, read-only views built with the
//    headless traversal/diagnostics API (`findLocation`, `classifyNode`,
//    `orderedSlotIds`) — never a second tree or index implementation;
//  - editable fields are declared ONLY by the selected node's manifest entry.
//    A node blocked solely by invalid persisted prop values keeps its fields as
//    a recovery path; any other opaque node renders its diagnostics and its raw
//    identity alone. Copy/Duplicate/Delete stay available for an opaque node —
//    they act on the slot array, not on the node's own props;
//  - Preview keeps the same selection and values on screen with every control
//    disabled, so switching back to Edit never loses what was selected.

import { MAPPING_ENTRY_IDENTITY_CAPABILITY } from "../../../../mapping/model/types";
import { computed, For, Show, signal, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type {
  ComponentCatalog,
  CompositionDocument,
  CompositionNode,
  Grammar,
  GrammarAcceptedKind,
  GrammarRegion,
  GlobalTemplateOutletTarget,
  JsonObject,
  LinkedEditorLifecycleActions,
  LinkedEditorPresentation,
  RootPolicy,
  RootPolicyOrigin,
} from "../../../../composer/browser";
import {
  buildGrammar,
  canRepairNodeProps,
  classifyNode,
  describeKindChildren,
  describeSlotCompleteness,
  findLocation,
  isPublishedOutletTarget,
  orderedSlotIds,
  renderGrammarMarkdown,
} from "../../../../composer/browser";
import { RailCollapseButton, type EditorRailsController } from "../../../../components/editor-chrome";
import { CopyIcon, DuplicateIcon, PlusIcon, SlotIcon, TrashIcon } from "../../../../components/icons";
import { read, toSignal, type MaybeSignal } from "../../../../components/reactive";
import { Rebuild } from "../../../../components/rebuild";
import { Keyed } from "../../../../runtime";
import {
  Banner,
  Button,
  Chip,
  EmptyState,
  Pane,
  PaneBody,
  PaneHeader,
  PaneSection,
  PaneTabs,
  SegmentedControl,
} from "../../../../components/ui";
import type { PaneTab } from "../../../../components/ui";
import type { ComponentDefinition } from "../../active-pack";
import type { ComposerMode } from "../../chrome/controller-model";
import type { PropPath, PropCoalescing } from "../../chrome/history-model";
import { memo } from "../../reactive/memo";
import { describeSlotRule, partitionCatalog, type SlotRule } from "../slot-rules";
import type { SelectedSlot } from "../tree/structure-pane";
import { ComposerCopyButton } from "../export/copy-button";
import { InspectorField, seedValue } from "./inspector-field";
import { ReuseControls, type ReuseSelectedSlot } from "./reuse-controls";
import type { ReuseAuthoringActionResult } from "../shared/reuse-authoring-contract";

type InspectorTab = "props" | "slots" | "reuse";
type GrammarFormat = "markdown" | "json";

export interface InspectorPanelProps {
  document: MaybeSignal<CompositionDocument>;
  manifest: ComponentCatalog;
  /** Catalog used by the Slots tab's rule display. A restricted slot's accepted-component rows are empty without it. */
  entries?: readonly ComponentDefinition[];
  selectedId: MaybeSignal<string | null>;
  /** The slot chosen in Structure, when the selected row is a slot. */
  selectedSlot?: MaybeSignal<SelectedSlot | null>;
  /** The document's effective root policy — drives the document row's Grammar-for-agents block. */
  rootPolicy?: MaybeSignal<RootPolicy | undefined>;
  mode: MaybeSignal<ComposerMode>;
  /** The editor's rails; the header offers the inspector's collapse control when given. */
  rails?: EditorRailsController;
  onUpdateProps: (
    nodeId: string,
    patch: JsonObject,
    coalescePaths?: PropCoalescing,
    removeProps?: readonly string[],
  ) => void;
  /**
   * Debounced commit channel for PER-KEYSTREAM fields — text/color/number.
   * When absent, those fields fall back to `onUpdateProps` (immediate), so
   * presentational usage and tests need no extra wiring. Discrete controls
   * (checkbox/select) always commit through `onUpdateProps`.
   */
  onUpdatePropsDebounced?: (nodeId: string, patch: JsonObject, coalescePaths?: PropCoalescing) => void;
  /** Synchronously land any debounce-pending commit — fields call it on blur. */
  onFlushPendingProps?: () => void;
  onRemove: (nodeId: string) => void;
  onCopy?: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
  /** Select one of the selected node's slots in Structure. */
  onJumpToSlot?: (slot: SelectedSlot) => void;
  /** Publish the current non-empty document as a saved Pattern. */
  onPublishPattern?: () => void;
  /** Provider-guarded source-role removal. The caller must not clear optimistically. */
  onClearPublication?: () => Promise<ReuseAuthoringActionResult>;
  /** Provider-checked publish/reassign for a real empty component slot. */
  onSetGlobalTemplateOutlet?: (
    target: GlobalTemplateOutletTarget,
    label: string,
  ) => Promise<ReuseAuthoringActionResult>;
  /** Latest typed controller error (e.g. protected outlet-owner removal). */
  lastError?: MaybeSignal<string | null>;
  /**
   * Optional friendlier display name for a component id — e.g. from the host's
   * richer catalog, which this component's `ComponentCatalog` does not carry.
   * Falls back to the raw, stable `componentId`.
   */
  titleFor?: (componentId: string) => string | undefined;
  /** Document-level link state; selection and fields remain local-only. */
  linkedPresentation?: MaybeSignal<LinkedEditorPresentation>;
  linkedActions?: MaybeSignal<LinkedEditorLifecycleActions | undefined>;
}

/** The chain of `Component › slot` steps down to the selected node. */
function parentPath(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  selectedId: string,
  titleFor: ((componentId: string) => string | undefined) | undefined,
): string {
  const steps: string[] = [];
  let location = findLocation(document, manifest, selectedId);
  while (location && location.parentId !== null) {
    const parent = findLocation(document, manifest, location.parentId);
    if (!parent) break;
    const entry = manifest.get(parent.node.componentId);
    const slot = entry?.slots.find((candidate) => candidate.id === location!.slotId);
    steps.push(`${titleFor?.(parent.node.componentId) ?? parent.node.componentId} › ${slot?.label ?? location.slotId}`);
    location = parent;
  }
  steps.reverse();
  return steps.length === 0 ? "Document root" : steps.join(" / ");
}

/**
 * The rule for one of the selected node's own slots, for the read-only Slots
 * tab. Mirrors `describeSlotRule`, with one deliberate difference: a
 * published Global template outlet is always "unavailable" there (nothing
 * may be added locally), which would hide the very rule this tab exists to
 * show — the contract every bound consumer page inserts under. So the
 * outlet case is partitioned directly from the declared slot instead.
 */
function describeInspectorSlotRule(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  catalog: readonly ComponentDefinition[],
  parentId: string,
  slotId: string,
): SlotRule & { isOutlet: boolean } {
  const isOutlet = isPublishedOutletTarget(document, parentId, slotId);
  const insertionRule = describeSlotRule({ catalog, manifest, document, target: { parentId, slotId, index: 0 } });
  // An opaque owner (e.g. one holding a child its own rule rejects) is "unavailable" for
  // insertion, but this read-only tab must still show the declared rule it violates.
  if (!isOutlet && insertionRule.kind !== "unavailable") return { ...insertionRule, isOutlet: false };

  const location = findLocation(document, manifest, parentId);
  const entry = location ? manifest.get(location.node.componentId) : undefined;
  const slot = entry?.slots.find((candidate) => candidate.id === slotId);
  const count = location?.node.slots[slotId]?.length ?? 0;
  if (!entry || !slot) {
    return {
      kind: "unavailable",
      accepts: [],
      hiddenByRule: [],
      cardinality: "many",
      count,
      full: false,
      origin: null,
      blockedReason: "This destination is no longer available.",
      isOutlet,
    };
  }
  return {
    ...partitionCatalog(catalog, manifest, slot.accepts),
    cardinality: slot.cardinality,
    ...(slot.min === undefined ? {} : { min: slot.min }),
    ...(slot.max === undefined ? {} : { max: slot.max }),
    count,
    full: false,
    origin: {
      componentId: entry.id,
      componentTitle: catalog.find((definition) => definition.id === entry.id)?.title ?? entry.title,
      slotId: slot.id,
      slotLabel: slot.label,
    },
    blockedReason: null,
    isOutlet,
  };
}

/** "Cardinality: many · at least N · at most M", omitting absent bounds. */
function describeCardinality(rule: SlotRule): string {
  if (rule.cardinality === "single") return "Cardinality: exactly one";
  const parts = ["many"];
  if (rule.min !== undefined) parts.push(`at least ${rule.min}`);
  if (rule.max !== undefined) parts.push(`at most ${rule.max}`);
  return `Cardinality: ${parts.join(" · ")}`;
}

/** A region's container/slot identity, for both the synthesized-grammar label and the real one. */
interface RegionIdentity {
  componentId: string;
  componentTitle: string;
  slotId: string;
  slotLabel: string;
  outletLabel: string;
}

/** The generic virtual-root identity, for a resolved root policy with no display origin. */
const DOCUMENT_ROOT_IDENTITY: RegionIdentity = {
  componentId: "document",
  componentTitle: "Document",
  slotId: "root",
  slotLabel: "Document root",
  outletLabel: "Document root",
};

/** A rule's origin, as the region identity `grammarForRestrictedRule` needs — `fallback` covers a root policy with no display origin. */
function regionIdentity(origin: RootPolicyOrigin | null, fallback: RegionIdentity): RegionIdentity {
  if (!origin) return fallback;
  return {
    componentId: origin.componentId,
    componentTitle: origin.componentTitle,
    slotId: origin.slotId,
    slotLabel: origin.slotLabel,
    outletLabel: origin.viaTemplate?.outletLabel ?? origin.slotLabel,
  };
}

/**
 * The agent-facing grammar for one restricted rule, scoped to that region only —
 * "same output as `zudo-composer grammar`" but never the whole pack.
 *
 * A rule backed by this very document's own published Global template outlet
 * reuses #634's `buildGrammar` over the manifest and this one document, which
 * is already the exact template `zudo-composer grammar --template` would
 * select. Every other restricted rule (an ordinary nested slot, or a bound
 * consumer's root policy) has no template document to hand `buildGrammar` —
 * its region is synthesized straight from the rule #633 already computed,
 * using the same `describeKindChildren` `buildGrammar` uses for a kind's own
 * children so the two paths read identically.
 */
function grammarForRestrictedRule(
  rule: SlotRule,
  manifest: ComponentCatalog,
  document: CompositionDocument,
  identity: RegionIdentity,
  isOutlet: boolean,
): Grammar {
  if (isOutlet) return buildGrammar({ manifest, templates: [document] });

  const accepts: GrammarAcceptedKind[] = rule.accepts.map((component) => ({
    id: component.id,
    title: component.title,
    description: manifest.get(component.id)?.description ?? "",
    accepts: describeKindChildren(component.id, manifest),
  }));
  const region: GrammarRegion = {
    outletLabel: identity.outletLabel,
    componentId: identity.componentId,
    componentTitle: identity.componentTitle,
    slotId: identity.slotId,
    slotLabel: identity.slotLabel,
    cardinality: rule.cardinality,
    ...(rule.min === undefined ? {} : { min: rule.min }),
    ...(rule.max === undefined ? {} : { max: rule.max }),
    accepts,
  };
  return {
    mappingSources: { entryIdentity: MAPPING_ENTRY_IDENTITY_CAPABILITY },
    pack: { id: manifest.pack.packId, version: manifest.pack.packVersion },
    templates: [{ id: `${identity.componentId}.${identity.slotId}`, name: `${identity.componentTitle} › ${identity.slotLabel}`, region, open: false }],
    unavailableTemplates: [],
    openRoot: { accepts: "any" },
  };
}

/** The Slots tab's "Grammar for agents" block: a Markdown/JSON toggle over one region's grammar, with Copy. */
function GrammarForAgentsSection({ grammar }: { grammar: Grammar }): Child {
  const format = signal<GrammarFormat>("markdown");
  const text = computed(() => (format.value === "markdown" ? renderGrammarMarkdown(grammar) : JSON.stringify(grammar, null, 2)));

  return (
    <PaneSection
      title="Grammar for agents"
      class="sg-composer-inspector-grammar"
      action={
        <SegmentedControl<GrammarFormat>
          label="Grammar format"
          mode="pressed"
          size="sm"
          value={format}
          onChange={(next) => { format.value = next; }}
          options={[
            { value: "markdown", label: "Markdown" },
            { value: "json", label: "JSON" },
          ]}
        />
      }
    >
      <pre class="sg-composer-export__code">{text}</pre>
      <Rebuild value={text}>{(current) => <ComposerCopyButton text={current} label="Copy" size="sm" />}</Rebuild>
      <p class="sg-composer-inspector-note">
        Same output as <code>zudo-composer grammar</code>. Derived from the manifest and the template; nothing
        authored by hand.
      </p>
    </PaneSection>
  );
}

/** A grammar derivation builds a fresh object every time; equal output must not rebuild its section. */
function sameGrammar(left: Grammar | null, right: Grammar | null): boolean {
  return left === right || (left !== null && right !== null && JSON.stringify(left) === JSON.stringify(right));
}

interface Selection {
  /** `node:<id>` while the selected id resolves, `root` for the document row, `missing` otherwise. */
  key: string;
  nodeId: string | null;
}

export function InspectorPanel({
  document: documentProp,
  manifest,
  entries = [],
  selectedId: selectedIdProp,
  selectedSlot: selectedSlotProp = null,
  mode,
  rails,
  onUpdateProps,
  onUpdatePropsDebounced,
  onFlushPendingProps,
  onRemove,
  onCopy,
  onDuplicate,
  onJumpToSlot,
  onPublishPattern = () => undefined,
  onClearPublication = async () => ({
    status: "unavailable" as const,
    message: "Publication changes need a current relationship check before they can be cleared.",
  }),
  onSetGlobalTemplateOutlet,
  lastError = null,
  titleFor,
  linkedPresentation = { state: "local" },
  linkedActions,
  rootPolicy,
}: InspectorPanelProps): Child {
  const document = toSignal(documentProp);
  const selectedId = toSignal(selectedIdProp);
  const selectedSlot = toSignal(selectedSlotProp);
  const requestedTab = signal<InspectorTab>("props");
  const readOnly = computed(() => read(mode) === "preview");

  const location = computed(() => {
    const id = selectedId.value;
    return id !== null ? findLocation(document.value, manifest, id) : undefined;
  });
  const node = computed(() => location.value?.node);
  const selection = memo((): Selection => {
    const current = node.value;
    if (current) return { key: `node:${current.id}`, nodeId: current.id };
    return { key: selectedId.value === null ? "root" : "missing", nodeId: null };
  });
  const slotIds = memo(() => {
    const current = node.value;
    return current ? orderedSlotIds(current, manifest.get(current.componentId)) : [];
  });

  // Resolved as a derivation, not repaired afterwards: a tab that no longer
  // exists for the new selection is never shown.
  const activeTab = computed((): InspectorTab => (requestedTab.value === "slots" && slotIds.value.length === 0 ? "props" : requestedTab.value));
  const title = computed(() => {
    const current = node.value;
    return current ? titleFor?.(current.componentId) ?? current.componentId : "Inspector";
  });
  const version = computed(() => node.value?.componentVersion);
  const inspectorState = computed(() => {
    const current = node.value;
    if (!current) return "empty";
    const diagnostic = classifyNode(current, manifest);
    const entry = manifest.get(current.componentId);
    return entry !== undefined && canRepairNodeProps(diagnostic) ? "recoverable" : diagnostic.opaque ? "opaque" : "editable";
  });

  const reuseSlot = memo((): ReuseSelectedSlot | null => {
    const slot = selectedSlot.value;
    const current = node.value;
    if (!slot || !current) return null;
    const entry = manifest.get(current.componentId);
    return {
      ...slot,
      label: entry?.slots.find((candidate) => candidate.id === slot.slotId)?.label ?? slot.slotId,
      empty: (current.slots[slot.slotId] ?? []).length === 0,
    };
  });

  const hasSlots = computed(() => slotIds.value.length > 0);

  return (
    <Pane label="Inspector">
      <PaneHeader
        title={title}
        actions={rails ? <RailCollapseButton rail="insp" rails={rails} /> : undefined}
      >
        <Show when={computed(() => Boolean(version.value))}>
          {() => <Chip tone="plain">v{computed(() => version.value ?? "")}</Chip>}
        </Show>
      </PaneHeader>
      <Keyed value={hasSlots} by={(value) => String(value)}>
        {(withSlots) => {
          const tabs: PaneTab<InspectorTab>[] = [
            { id: "props", label: "Properties" },
            { id: "slots", label: "Slots", count: computed(() => slotIds.value.length), disabled: !withSlots.value },
            { id: "reuse", label: "Reuse" },
          ];
          return <PaneTabs label="Inspector" tabs={tabs} activeId={activeTab} onSelect={(tab) => { requestedTab.value = tab; }} />;
        }}
      </Keyed>
      <PaneBody>
        <div data-sg-inspector-state={inspectorState}>
          <Show when={computed(() => activeTab.value === "reuse")}>
            {() => (
              <ReuseControls
                document={document}
                manifest={manifest}
                mode={mode}
                lastError={lastError}
                onPublishPattern={onPublishPattern}
                onClearPublication={onClearPublication}
                onSetGlobalTemplateOutlet={onSetGlobalTemplateOutlet}
                selectedSlot={reuseSlot}
                linkedPresentation={linkedPresentation}
                linkedActions={linkedActions}
              />
            )}
          </Show>
          <Show when={computed(() => activeTab.value !== "reuse")}>
            {() => (
              <Keyed value={selection} by={(current) => current.key}>
                {(current) => {
                  const nodeId = current.value.nodeId;
                  if (nodeId === null) {
                    return (
                      <EmptySelection
                        document={document}
                        manifest={manifest}
                        entries={entries}
                        isRoot={current.value.key === "root"}
                        rootPolicy={rootPolicy}
                      />
                    );
                  }
                  const view: NodeViewProps = {
                    nodeId,
                    document,
                    manifest,
                    entries,
                    readOnly,
                    lastError,
                    titleFor,
                    onUpdateProps,
                    onUpdatePropsDebounced,
                    onFlushPendingProps,
                    onRemove,
                    onCopy,
                    onDuplicate,
                    onJumpToSlot,
                  };
                  return (
                    <>
                      <Show when={computed(() => activeTab.value === "props")}>{() => <NodeProperties {...view} />}</Show>
                      <Show when={computed(() => activeTab.value === "slots")}>{() => <NodeSlots {...view} />}</Show>
                    </>
                  );
                }}
              </Keyed>
            )}
          </Show>
        </div>
      </PaneBody>
    </Pane>
  );
}

function EmptySelection({
  document,
  manifest,
  entries,
  isRoot,
  rootPolicy,
}: {
  document: ReadonlySignal<CompositionDocument>;
  manifest: ComponentCatalog;
  entries: readonly ComponentDefinition[];
  isRoot: boolean;
  rootPolicy: MaybeSignal<RootPolicy | undefined> | undefined;
}): Child {
  // The document row shares this same "nothing selected" state, so its
  // Grammar-for-agents block lives here rather than behind a selection.
  const rootGrammar = memo((): Grammar | null => {
    if (!isRoot) return null;
    const doc = document.value;
    const rootRule = describeSlotRule({ catalog: entries, manifest, document: doc, target: { parentId: null, slotId: "", index: 0 }, rootPolicy: read(rootPolicy) });
    return rootRule.kind === "restricted"
      ? grammarForRestrictedRule(rootRule, manifest, doc, regionIdentity(rootRule.origin, DOCUMENT_ROOT_IDENTITY), false)
      : null;
  }, sameGrammar);
  return (
    <>
      <EmptyState
        inline
        title="Nothing selected"
        description={computed(() =>
          document.value.root.length === 0
            ? "The composition is empty. Add a component from Structure to start editing."
            : "Select a component in the canvas or in Structure to edit its properties.")}
      />
      <Rebuild value={rootGrammar}>{(grammar) => (grammar ? <GrammarForAgentsSection grammar={grammar} /> : null)}</Rebuild>
    </>
  );
}

interface NodeViewProps {
  nodeId: string;
  document: ReadonlySignal<CompositionDocument>;
  manifest: ComponentCatalog;
  entries: readonly ComponentDefinition[];
  readOnly: ReadonlySignal<boolean>;
  lastError: MaybeSignal<string | null>;
  titleFor: ((componentId: string) => string | undefined) | undefined;
  onUpdateProps: InspectorPanelProps["onUpdateProps"];
  onUpdatePropsDebounced: InspectorPanelProps["onUpdatePropsDebounced"];
  onFlushPendingProps: InspectorPanelProps["onFlushPendingProps"];
  onRemove: InspectorPanelProps["onRemove"];
  onCopy: InspectorPanelProps["onCopy"];
  onDuplicate: InspectorPanelProps["onDuplicate"];
  onJumpToSlot: InspectorPanelProps["onJumpToSlot"];
}

interface DiagnosticView {
  opaque: boolean;
  canRepairProps: boolean;
  reasons: string;
}

/** The selected node as of the latest document; the node id is fixed for this view's lifetime. */
function nodeSignals(nodeId: string, document: ReadonlySignal<CompositionDocument>, manifest: ComponentCatalog) {
  const location = computed(() => findLocation(document.value, manifest, nodeId));
  const node = computed((): CompositionNode | undefined => location.value?.node);
  return { location, node };
}

function NodeProperties({
  nodeId,
  document,
  manifest,
  readOnly,
  lastError,
  titleFor,
  onUpdateProps,
  onUpdatePropsDebounced,
  onFlushPendingProps,
  onRemove,
  onCopy,
  onDuplicate,
}: NodeViewProps): Child {
  const { location, node } = nodeSignals(nodeId, document, manifest);
  const initial = node.value!;
  const componentId = initial.componentId;
  const entry = manifest.get(componentId);
  const title = titleFor?.(componentId) ?? componentId;

  const diagnostic = computed(() => {
    const current = node.value;
    return current ? classifyNode(current, manifest) : null;
  });
  const diagnosticView = memo((): DiagnosticView => {
    const current = diagnostic.value;
    return {
      opaque: current?.opaque ?? false,
      canRepairProps: current !== null && entry !== undefined && canRepairNodeProps(current),
      reasons: JSON.stringify(current?.reasons ?? []),
    };
  });
  const fields = memo(() => {
    const view = diagnosticView.value;
    const fieldsEditable = !view.opaque || view.canRepairProps;
    return fieldsEditable && entry ? entry.fields : [];
  });
  const props = computed(() => node.value?.props ?? {});
  const present = memo(() => fields.value.filter((field) => Object.hasOwn(props.value, field.prop) || field.required === true));
  const absentOptional = memo(() => fields.value.filter((field) => !Object.hasOwn(props.value, field.prop) && field.required !== true));
  const nodeFacts = memo(() => {
    const current = location.value;
    const doc = document.value;
    if (!current) return { parent: "", position: "" };
    const siblings =
      current.parentId === null
        ? doc.root
        : (findLocation(doc, manifest, current.parentId)?.node.slots[current.slotId] ?? []);
    return {
      parent: parentPath(doc, manifest, nodeId, titleFor),
      position: `${current.index + 1} of ${siblings.length}`,
    };
  });

  const commitWith = (channel: (nodeId: string, patch: JsonObject, coalescePaths?: PropCoalescing) => void, prop: string) =>
    (value: Parameters<typeof channel>[1][string], path?: PropPath, structural?: boolean) => {
      const coalescePaths = structural ? null : path && path.length > 0 ? [path as PropPath] : undefined;
      if (coalescePaths === undefined) channel(nodeId, { [prop]: value });
      else channel(nodeId, { [prop]: value }, coalescePaths);
    };

  return (
    <>
      <Show when={readOnly}>
        {() => (
          <PaneSection title="Preview">
            <p class="sg-composer-inspector-note" role="status">
              Preview mode — properties are read-only.
            </p>
          </PaneSection>
        )}
      </Show>

      <Show when={computed(() => diagnosticView.value.opaque)}>
        {() => (
          <Rebuild value={diagnosticView}>
            {(view) => (
              <PaneSection title="Diagnostics">
                <Banner
                  tone="err"
                  title={
                    view.canRepairProps
                      ? "This component has invalid properties."
                      : "This component can't be edited."
                  }
                >
                  <ul class="sg-composer-inspector-diagnostics">
                    {(diagnostic.value?.reasons ?? []).map((reason, index) => (
                      <li key={`${reason.code}-${index}`}>
                        {reason.message}
                        {reason.code === "unaccepted-child" ? (
                          <> — rule from {title} › {entry?.slots.find((slot) => slot.id === reason.slotId)?.label ?? reason.slotId}</>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Banner>
              </PaneSection>
            )}
          </Rebuild>
        )}
      </Show>

      <Show when={computed(() => present.value.length > 0)}>
        {() => (
          <PaneSection title="Properties" class="sg-composer-inspector-props">
            <For each={present} by={(field) => `${nodeId}:${field.prop}`}>
              {(fieldSignal) => {
                const field = fieldSignal.value;
                return (
                  <InspectorField
                    field={field}
                    value={computed(() => (Object.hasOwn(props.value, field.prop) ? props.value[field.prop] : undefined))}
                    disabled={readOnly}
                    onRemove={() => onUpdateProps(nodeId, {}, null, [field.prop])}
                    onCommit={commitWith(onUpdateProps, field.prop)}
                    onCommitDebounced={onUpdatePropsDebounced ? commitWith(onUpdatePropsDebounced, field.prop) : undefined}
                    onFlushPending={onFlushPendingProps}
                  />
                );
              }}
            </For>
          </PaneSection>
        )}
      </Show>

      <Show when={computed(() => absentOptional.value.length > 0)}>
        {() => (
          <PaneSection title="Optional props">
            <div class="sg-composer-inspector-optional">
              <For each={absentOptional} by={(field) => field.prop}>
                {(fieldSignal) => {
                  const field = fieldSignal.value;
                  const seed = seedValue(field);
                  return (
                    <Button
                      size="xs"
                      disabled={computed(() => readOnly.value || seed === undefined)}
                      aria-label={`Add ${field.label}`}
                      title={
                        seed === undefined
                          ? "This value has required fields with no deterministic seed."
                          : undefined
                      }
                      data-sg-inspector-optional-field={field.prop}
                      // `null` coalescing: adding a prop is a structural
                      // change, and its own point in the history stack.
                      on:click={() => {
                        if (seed !== undefined) onUpdateProps(nodeId, { [field.prop]: seed }, null);
                      }}
                    >
                      <PlusIcon size="xs" />
                      {field.label}
                    </Button>
                  );
                }}
              </For>
            </div>
          </PaneSection>
        )}
      </Show>

      <PaneSection title="Node">
        <dl class="sg-composer-inspector-node">
          <dt>Component</dt>
          <dd><code>{componentId}</code></dd>
          <dt>ID</dt>
          <dd><code>{nodeId}</code></dd>
          <dt>Parent</dt>
          <dd>{computed(() => nodeFacts.value.parent)}</dd>
          <dt>Position</dt>
          <dd>{computed(() => nodeFacts.value.position)}</dd>
        </dl>
        <div class="sg-composer-inspector-node-actions">
          {onDuplicate ? (
            <Button size="sm" disabled={readOnly} on:click={() => onDuplicate(nodeId)}>
              <DuplicateIcon size="sm" />
              Duplicate
            </Button>
          ) : null}
          {onCopy ? (
            <Button size="sm" disabled={readOnly} on:click={() => onCopy(nodeId)}>
              <CopyIcon size="sm" />
              Copy
            </Button>
          ) : null}
          <Button
            variant="danger"
            size="sm"
            class="sg-composer-inspector-remove"
            disabled={readOnly}
            on:click={() => onRemove(nodeId)}
          >
            <TrashIcon size="sm" />
            Delete
          </Button>
        </div>
        <Show when={computed(() => Boolean(read(lastError)))}>
          {() => <p class="sg-composer-inspector-note" role="alert">{computed(() => read(lastError) ?? "")}</p>}
        </Show>
      </PaneSection>
    </>
  );
}

function NodeSlots({ nodeId, document, manifest, entries, titleFor, onJumpToSlot }: NodeViewProps): Child {
  const { node } = nodeSignals(nodeId, document, manifest);
  const componentId = node.value!.componentId;
  const entry = manifest.get(componentId);
  const title = titleFor?.(componentId) ?? componentId;
  // The slot list is a read-only view of the whole document, rebuilt per document.
  const view = memo(() => ({ document: document.value, node: node.value }));
  return (
    <PaneSection title="Slots">
      <Rebuild value={view}>
        {({ document: doc, node: current }) => {
          if (!current) return <ul class="sg-composer-inspector-slots" data-sg-inspector-slots />;
          const slotIds = orderedSlotIds(current, entry);
          // One document-wide walk, reused for every slot row below.
          const completeness = describeSlotCompleteness(doc, manifest);
          return (
            <ul class="sg-composer-inspector-slots" data-sg-inspector-slots>
              {slotIds.map((slotId) => {
                const slot = entry?.slots.find((candidate) => candidate.id === slotId);
                const count = (current.slots[slotId] ?? []).length;
                const label = slot?.label ?? slotId;
                const rule = describeInspectorSlotRule(doc, manifest, entries, nodeId, slotId);
                const underMin = completeness.find(
                  (candidate) => candidate.nodeId === nodeId && candidate.slotId === slotId,
                );
                return (
                  <li key={slotId} class="sg-composer-inspector-slot">
                    <SlotIcon size="sm" />
                    <span class="sg-composer-inspector-slot-name">{label}</span>
                    <span class="sg-composer-inspector-slot-meta">
                      {count} {count === 1 ? "child" : "children"}
                      {slot?.cardinality === "single" ? " · single" : ""}
                    </span>
                    {onJumpToSlot ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label={`Jump to ${label}`}
                        on:click={() => onJumpToSlot({ parentId: nodeId, slotId })}
                      >
                        Jump
                      </Button>
                    ) : null}
                    <div class="sg-composer-inspector-slot-detail">
                      {underMin ? (
                        <Banner tone="warn">
                          This slot needs at least {underMin.min} {underMin.min === 1 ? "component" : "components"}
                          {" "}(has {underMin.count}).
                        </Banner>
                      ) : null}
                      {rule.kind === "open" ? (
                        <p class="sg-composer-inspector-note">Accepts any component in the pack.</p>
                      ) : null}
                      {rule.kind === "restricted" ? (
                        <PaneSection title="Rule" class="sg-composer-inspector-rule">
                          {rule.origin ? (
                            <p class="sg-composer-inspector-rule-origin">
                              Rule from {rule.origin.componentTitle} › {rule.origin.slotLabel}
                              {rule.origin.viaTemplate ? ` · template ${rule.origin.viaTemplate.sourceName}` : ""}
                            </p>
                          ) : null}
                          <ul class="sg-composer-inspector-rule-list">
                            {rule.accepts.map((component) => (
                              <li key={component.id} class="sg-composer-inspector-rule-row">
                                <span>{component.title}</span>
                                {component.hasOwnRule ? (
                                  <span class="sg-composer-inspector-rule-badge">has rule</span>
                                ) : null}
                                <code>{component.id}</code>
                              </li>
                            ))}
                          </ul>
                          <p class="sg-composer-inspector-rule-bounds">{describeCardinality(rule)}</p>
                          {rule.isOutlet ? (
                            <p class="sg-composer-inspector-rule-applies">
                              Applies to: every page bound to this template
                            </p>
                          ) : null}
                          <p class="sg-composer-inspector-note">
                            Read-only here. The rule is part of the component’s schema, not of this
                            composition. Change it in the host’s component source and republish the pack.
                          </p>
                        </PaneSection>
                      ) : null}
                      {rule.kind === "restricted" ? (
                        <GrammarForAgentsSection
                          grammar={grammarForRestrictedRule(
                            rule,
                            manifest,
                            doc,
                            regionIdentity(rule.origin, { componentId, componentTitle: title, slotId, slotLabel: label, outletLabel: label }),
                            rule.isOutlet,
                          )}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </Rebuild>
    </PaneSection>
  );
}
