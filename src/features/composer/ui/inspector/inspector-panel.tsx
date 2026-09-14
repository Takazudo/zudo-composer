/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Composer inspector: three tabs over one selection.
//
// Purely presentational over the shared document model and controller
// contracts — it reads `document`/`manifest`/`selectedId`/`mode` and reports
// every mutation through typed callbacks, never touching commands or storage.
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

import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import type {
  ComponentCatalog,
  CompositionDocument,
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
import { RailCollapseButton } from "../../../../components/editor-chrome";
import { CopyIcon, DuplicateIcon, PlusIcon, SlotIcon, TrashIcon } from "../../../../components/icons";
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
import { describeSlotRule, partitionCatalog, type SlotRule } from "../slot-rules";
import type { SelectedSlot } from "../tree/structure-pane";
import { ComposerCopyButton } from "../export/copy-button";
import { InspectorField, seedValue } from "./inspector-field";
import { ReuseControls } from "./reuse-controls";
import type { ReuseAuthoringActionResult } from "../shared/reuse-authoring-contract";

type InspectorTab = "props" | "slots" | "reuse";
type GrammarFormat = "markdown" | "json";

export interface InspectorPanelProps {
  document: CompositionDocument;
  manifest: ComponentCatalog;
  /** Catalog used by the Slots tab's rule display. A restricted slot's accepted-component rows are empty without it. */
  entries?: readonly ComponentDefinition[];
  selectedId: string | null;
  /** The slot chosen in Structure, when the selected row is a slot. */
  selectedSlot?: SelectedSlot | null;
  /** The document's effective root policy — drives the document row's Grammar-for-agents block. */
  rootPolicy?: RootPolicy;
  mode: ComposerMode;
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
  lastError?: string | null;
  /**
   * Optional friendlier display name for a component id — e.g. from the host's
   * richer catalog, which this component's `ComponentCatalog` does not carry.
   * Falls back to the raw, stable `componentId`.
   */
  titleFor?: (componentId: string) => string | undefined;
  /** Document-level link state; selection and fields remain local-only. */
  linkedPresentation?: LinkedEditorPresentation;
  linkedActions?: LinkedEditorLifecycleActions;
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
  if (!isOutlet) {
    return {
      ...describeSlotRule({ catalog, manifest, document, target: { parentId, slotId, index: 0 } }),
      isOutlet: false,
    };
  }

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
      isOutlet: true,
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
    isOutlet: true,
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
    pack: { id: manifest.pack.packId, version: manifest.pack.packVersion },
    templates: [{ id: `${identity.componentId}.${identity.slotId}`, name: `${identity.componentTitle} › ${identity.slotLabel}`, region, open: false }],
    openRoot: { accepts: "any" },
  };
}

/** The Slots tab's "Grammar for agents" block: a Markdown/JSON toggle over one region's grammar, with Copy. */
function GrammarForAgentsSection({ grammar }: { grammar: Grammar }): JSX.Element {
  const [format, setFormat] = useState<GrammarFormat>("markdown");
  const text = format === "markdown" ? renderGrammarMarkdown(grammar) : JSON.stringify(grammar, null, 2);

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
          onChange={setFormat}
          options={[
            { value: "markdown", label: "Markdown" },
            { value: "json", label: "JSON" },
          ]}
        />
      }
    >
      <pre class="sg-composer-export__code">{text}</pre>
      <ComposerCopyButton text={text} label="Copy" size="sm" />
      <p class="sg-composer-inspector-note">
        Same output as <code>zudo-composer grammar</code>. Derived from the manifest and the template; nothing
        authored by hand.
      </p>
    </PaneSection>
  );
}

function InspectorShell({
  title,
  version,
  tabs,
  activeTab,
  onSelectTab,
  children,
}: {
  title: ComponentChildren;
  version?: string | number;
  tabs: readonly PaneTab<InspectorTab>[];
  activeTab: InspectorTab;
  onSelectTab: (tab: InspectorTab) => void;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <Pane label="Inspector">
      <PaneHeader
        title={title}
        actions={<RailCollapseButton rail="insp" />}
      >
        {version ? <Chip tone="plain">v{version}</Chip> : null}
      </PaneHeader>
      <PaneTabs label="Inspector" tabs={tabs} activeId={activeTab} onSelect={onSelectTab} />
      <PaneBody>{children}</PaneBody>
    </Pane>
  );
}

export function InspectorPanel({
  document,
  manifest,
  entries = [],
  selectedId,
  selectedSlot = null,
  mode,
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
}: InspectorPanelProps): JSX.Element {
  const [requestedTab, setRequestedTab] = useState<InspectorTab>("props");
  const readOnly = mode === "preview";
  const location = selectedId !== null ? findLocation(document, manifest, selectedId) : undefined;
  const node = location?.node;
  const entry = node ? manifest.get(node.componentId) : undefined;
  const slotIds = node ? orderedSlotIds(node, entry) : [];

  const reuse = (
    <ReuseControls
      document={document}
      manifest={manifest}
      mode={mode}
      lastError={lastError}
      onPublishPattern={onPublishPattern}
      onClearPublication={onClearPublication}
      onSetGlobalTemplateOutlet={onSetGlobalTemplateOutlet}
      selectedSlot={
        selectedSlot && node
          ? {
            ...selectedSlot,
            label: entry?.slots.find((slot) => slot.id === selectedSlot.slotId)?.label ?? selectedSlot.slotId,
            empty: (node.slots[selectedSlot.slotId] ?? []).length === 0,
          }
          : null
      }
      linkedPresentation={linkedPresentation}
      linkedActions={linkedActions}
    />
  );

  // Resolved during render, not repaired in an effect: an effect runs after
  // paint, so a tab that no longer exists for the new selection would be shown
  // for a frame before it moved.
  const tabs: PaneTab<InspectorTab>[] = [
    { id: "props", label: "Properties" },
    { id: "slots", label: "Slots", count: slotIds.length, disabled: slotIds.length === 0 },
    { id: "reuse", label: "Reuse" },
  ];
  const activeTab: InspectorTab = requestedTab === "slots" && slotIds.length === 0 ? "props" : requestedTab;

  if (!node || !location) {
    // The document row shares this same "nothing selected" state, so its
    // Grammar-for-agents block lives here rather than behind a selection.
    const rootRule = selectedId === null
      ? describeSlotRule({ catalog: entries, manifest, document, target: { parentId: null, slotId: "", index: 0 }, rootPolicy })
      : null;
    const rootGrammar = rootRule?.kind === "restricted"
      ? grammarForRestrictedRule(rootRule, manifest, document, regionIdentity(rootRule.origin, DOCUMENT_ROOT_IDENTITY), false)
      : null;

    return (
      <InspectorShell title="Inspector" tabs={tabs} activeTab={activeTab} onSelectTab={setRequestedTab}>
        <div data-sg-inspector-state="empty">
          {activeTab === "reuse" ? (
            reuse
          ) : (
            <>
              <EmptyState
                inline
                title="Nothing selected"
                description={
                  document.root.length === 0
                    ? "The composition is empty. Add a component from Structure to start editing."
                    : "Select a component in the canvas or in Structure to edit its properties."
                }
              />
              {rootGrammar && <GrammarForAgentsSection grammar={rootGrammar} />}
            </>
          )}
        </div>
      </InspectorShell>
    );
  }

  const diagnostic = classifyNode(node, manifest);
  const canRepairProps = entry !== undefined && canRepairNodeProps(diagnostic);
  const fieldsEditable = !diagnostic.opaque || canRepairProps;
  const fields = fieldsEditable && entry ? entry.fields : [];
  const present = fields.filter((field) => Object.hasOwn(node.props, field.prop) || field.required === true);
  const absentOptional = fields.filter((field) => !Object.hasOwn(node.props, field.prop) && field.required !== true);
  const title = titleFor?.(node.componentId) ?? node.componentId;

  const siblings =
    location.parentId === null
      ? document.root
      : (findLocation(document, manifest, location.parentId)?.node.slots[location.slotId] ?? []);

  return (
    <InspectorShell
      title={title}
      version={node.componentVersion}
      tabs={tabs}
      activeTab={activeTab}
      onSelectTab={setRequestedTab}
    >
      <div data-sg-inspector-state={canRepairProps ? "recoverable" : diagnostic.opaque ? "opaque" : "editable"}>
        {activeTab === "props" && (
          <>
            {readOnly && (
              <PaneSection title="Preview">
                <p class="sg-composer-inspector-note" role="status">
                  Preview mode — properties are read-only.
                </p>
              </PaneSection>
            )}

            {diagnostic.opaque && (
              <PaneSection title="Diagnostics">
                <Banner
                  tone="err"
                  title={
                    canRepairProps
                      ? "This component has invalid properties."
                      : "This component can't be edited."
                  }
                >
                  <ul class="sg-composer-inspector-diagnostics">
                    {diagnostic.reasons.map((reason, index) => (
                      <li key={`${reason.code}-${index}`}>
                        {reason.message}
                        {reason.code === "unaccepted-child" && (
                          <> — rule from {parentPath(document, manifest, node.id, titleFor)}</>
                        )}
                      </li>
                    ))}
                  </ul>
                </Banner>
              </PaneSection>
            )}

            {present.length > 0 && (
              <PaneSection title="Properties" class="sg-composer-inspector-props">
                {present.map((field) => (
                  <InspectorField
                    key={`${selectedId}:${field.prop}`}
                    field={field}
                    value={Object.hasOwn(node.props, field.prop) ? node.props[field.prop] : undefined}
                    disabled={readOnly}
                    onRemove={() => onUpdateProps(node.id, {}, null, [field.prop])}
                    onCommit={(value, path, structural) => {
                      const coalescePaths = structural ? null : path && path.length > 0 ? [path as PropPath] : undefined;
                      if (coalescePaths === undefined) onUpdateProps(node.id, { [field.prop]: value });
                      else onUpdateProps(node.id, { [field.prop]: value }, coalescePaths);
                    }}
                    onCommitDebounced={
                      onUpdatePropsDebounced &&
                      ((value, path, structural) => {
                        const coalescePaths = structural ? null : path && path.length > 0 ? [path as PropPath] : undefined;
                        if (coalescePaths === undefined) onUpdatePropsDebounced(node.id, { [field.prop]: value });
                        else onUpdatePropsDebounced(node.id, { [field.prop]: value }, coalescePaths);
                      })
                    }
                    onFlushPending={onFlushPendingProps}
                  />
                ))}
              </PaneSection>
            )}

            {absentOptional.length > 0 && (
              <PaneSection title="Optional props">
                <div class="sg-composer-inspector-optional">
                  {absentOptional.map((field) => {
                    const seed = seedValue(field);
                    return (
                      <Button
                        key={field.prop}
                        size="xs"
                        disabled={readOnly || seed === undefined}
                        aria-label={`Add ${field.label}`}
                        title={
                          seed === undefined
                            ? "This value has required fields with no deterministic seed."
                            : undefined
                        }
                        data-sg-inspector-optional-field={field.prop}
                        // `null` coalescing: adding a prop is a structural
                        // change, and its own point in the history stack.
                        onClick={() => {
                          if (seed !== undefined) onUpdateProps(node.id, { [field.prop]: seed }, null);
                        }}
                      >
                        <PlusIcon size="xs" />
                        {field.label}
                      </Button>
                    );
                  })}
                </div>
              </PaneSection>
            )}

            <PaneSection title="Node">
              <dl class="sg-composer-inspector-node">
                <dt>Component</dt>
                <dd><code>{node.componentId}</code></dd>
                <dt>ID</dt>
                <dd><code>{node.id}</code></dd>
                <dt>Parent</dt>
                <dd>{parentPath(document, manifest, node.id, titleFor)}</dd>
                <dt>Position</dt>
                <dd>{location.index + 1} of {siblings.length}</dd>
              </dl>
              <div class="sg-composer-inspector-node-actions">
                {onDuplicate && (
                  <Button size="sm" disabled={readOnly} onClick={() => onDuplicate(node.id)}>
                    <DuplicateIcon size="sm" />
                    Duplicate
                  </Button>
                )}
                {onCopy && (
                  <Button size="sm" disabled={readOnly} onClick={() => onCopy(node.id)}>
                    <CopyIcon size="sm" />
                    Copy
                  </Button>
                )}
                <Button
                  variant="danger"
                  size="sm"
                  class="sg-composer-inspector-remove"
                  disabled={readOnly}
                  onClick={() => onRemove(node.id)}
                >
                  <TrashIcon size="sm" />
                  Delete
                </Button>
              </div>
              {lastError && (
                <p class="sg-composer-inspector-note" role="alert">{lastError}</p>
              )}
            </PaneSection>
          </>
        )}

        {activeTab === "slots" && (
          <PaneSection title="Slots">
            <ul class="sg-composer-inspector-slots" data-sg-inspector-slots>
              {(() => {
                // One document-wide walk, reused for every slot row below.
                const completeness = describeSlotCompleteness(document, manifest);
                return slotIds.map((slotId) => {
                  const slot = entry?.slots.find((candidate) => candidate.id === slotId);
                  const count = (node.slots[slotId] ?? []).length;
                  const label = slot?.label ?? slotId;
                  const rule = describeInspectorSlotRule(document, manifest, entries, node.id, slotId);
                  const underMin = completeness.find(
                    (candidate) => candidate.nodeId === node.id && candidate.slotId === slotId,
                  );
                  return (
                    <li key={slotId} class="sg-composer-inspector-slot">
                      <SlotIcon size="sm" />
                      <span class="sg-composer-inspector-slot-name">{label}</span>
                      <span class="sg-composer-inspector-slot-meta">
                        {count} {count === 1 ? "child" : "children"}
                        {slot?.cardinality === "single" ? " · single" : ""}
                      </span>
                      {onJumpToSlot && (
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label={`Jump to ${label}`}
                          onClick={() => onJumpToSlot({ parentId: node.id, slotId })}
                        >
                          Jump
                        </Button>
                      )}
                      <div class="sg-composer-inspector-slot-detail">
                        {underMin && (
                          <Banner tone="warn">
                            This slot needs at least {underMin.min} {underMin.min === 1 ? "component" : "components"}
                            {" "}(has {underMin.count}).
                          </Banner>
                        )}
                        {rule.kind === "open" && (
                          <p class="sg-composer-inspector-note">Accepts any component in the pack.</p>
                        )}
                        {rule.kind === "restricted" && (
                          <PaneSection title="Rule" class="sg-composer-inspector-rule">
                            {rule.origin && (
                              <p class="sg-composer-inspector-rule-origin">
                                Rule from {rule.origin.componentTitle} › {rule.origin.slotLabel}
                                {rule.origin.viaTemplate ? ` · template ${rule.origin.viaTemplate.sourceName}` : ""}
                              </p>
                            )}
                            <ul class="sg-composer-inspector-rule-list">
                              {rule.accepts.map((component) => (
                                <li key={component.id} class="sg-composer-inspector-rule-row">
                                  <span>{component.title}</span>
                                  {component.hasOwnRule && (
                                    <span class="sg-composer-inspector-rule-badge">has rule</span>
                                  )}
                                  <code>{component.id}</code>
                                </li>
                              ))}
                            </ul>
                            <p class="sg-composer-inspector-rule-bounds">{describeCardinality(rule)}</p>
                            {rule.isOutlet && (
                              <p class="sg-composer-inspector-rule-applies">
                                Applies to: every page bound to this template
                              </p>
                            )}
                            <p class="sg-composer-inspector-note">
                              Read-only here. The rule is part of the component&rsquo;s schema, not of this
                              composition. Change it in the host&rsquo;s component source and republish the pack.
                            </p>
                          </PaneSection>
                        )}
                        {rule.kind === "restricted" && (
                          <GrammarForAgentsSection
                            grammar={grammarForRestrictedRule(
                              rule,
                              manifest,
                              document,
                              regionIdentity(rule.origin, { componentId: node.componentId, componentTitle: title, slotId, slotLabel: label, outletLabel: label }),
                              rule.isOutlet,
                            )}
                          />
                        )}
                      </div>
                    </li>
                  );
                });
              })()}
            </ul>
          </PaneSection>
        )}

        {activeTab === "reuse" && reuse}
      </div>
    </InspectorShell>
  );
}
