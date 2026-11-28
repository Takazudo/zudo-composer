// The inspector's Reuse tab: one banner saying what this composition is right
// now, then one card per reusable role.
//
// The essays this surface used to carry are gone. Reuse used to sit above the
// props an author actually came to edit, and three paragraphs of scope rules
// pushed them below the fold; each card now states its scope in one line and
// keeps its own action, and the guidance that only matters when an action is
// unavailable is attached to the disabled control instead.

import { computed, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import type {
  ComponentCatalog,
  CompositionDocument,
  GlobalTemplateOutletTarget,
  LinkedEditorLifecycleActions,
  LinkedEditorPresentation,
} from "../../../../composer/browser";
import { diagnoseDocument } from "../../../../composer/browser";
import { ArrowRightIcon, ContainerIcon, RefreshIcon, SlotIcon, TrashIcon, XMarkIcon } from "../../../../components/icons";
import { ConfirmDialog } from "../../../../components/overlay";
import { memo, read, toSignal, type MaybeSignal } from "../../../../components/reactive";
import { Rebuild } from "../../../../components/rebuild";
import { Banner, Button, Field, Input, PaneSection } from "../../../../components/ui";
import type { ComposerMode } from "../../chrome/controller-model";
import type { SelectedSlot } from "../tree/structure-pane";
import type { ReuseAuthoringActionResult } from "../shared/reuse-authoring-contract";
import { createDomId } from "../../../../components/use-dom-id";

export type ReuseSelectedSlot = SelectedSlot & { label: string; empty: boolean };

export interface ReuseControlsProps {
  document: MaybeSignal<CompositionDocument>;
  manifest: ComponentCatalog;
  mode: MaybeSignal<ComposerMode>;
  /** Latest synchronous controller rejection, kept visible beside the controls. */
  lastError?: MaybeSignal<string | null>;
  onPublishPattern: () => void;
  /** Must wait for the provider-owned dependent query before invoking the command. */
  onClearPublication: () => Promise<ReuseAuthoringActionResult>;
  /**
   * The slot selected in Structure, which is what a Global template outlet is
   * published from. Null disables the outlet action with a reason.
   */
  selectedSlot?: MaybeSignal<ReuseSelectedSlot | null>;
  /** Provider-checked publish/reassign for one real empty component slot. */
  onSetGlobalTemplateOutlet?: (
    target: GlobalTemplateOutletTarget,
    label: string,
  ) => Promise<ReuseAuthoringActionResult>;
  /** Document-level link state; selection and fields remain local-only. */
  linkedPresentation?: MaybeSignal<LinkedEditorPresentation>;
  linkedActions?: MaybeSignal<LinkedEditorLifecycleActions | undefined>;
}

type ClearablePublication = "pattern" | "global-template";

const PATTERN_SCOPE = "Whole-composition scope. Publishing makes the entire document reusable, not the selected subtree.";
const OUTLET_SCOPE = "Pick an empty slot and mark it as a named outlet. Consumers fill it from their own document.";

function patternDisabledReason(document: CompositionDocument): string | null {
  if (document.binding !== undefined) {
    return "This composition is bound to a Global template and cannot republish itself. Remove its binding first.";
  }
  if (document.root.length === 0) return "Add at least one root component before publishing a Pattern.";
  if (document.publication?.kind === "global-template") {
    return "This composition is a Global template. Unpublish it before publishing it as a Pattern.";
  }
  return null;
}

/**
 * Why the outlet action is unavailable, or null when it is. Ordered by what an
 * author most needs to know: a document-level conflict outranks a missing
 * capability, which outranks "you have not picked a slot yet".
 */
function outletDisabledReason({
  readOnly,
  document,
  canPublish,
  selectedSlot,
}: {
  readOnly: boolean;
  document: CompositionDocument;
  canPublish: boolean;
  selectedSlot: (SelectedSlot & { label: string; empty: boolean }) | null;
}): string | null {
  if (readOnly) return "Reuse actions are unavailable in preview.";
  if (document.binding !== undefined) return "A bound composition cannot publish an outlet of its own.";
  if (document.publication?.kind === "pattern") {
    return "This composition is a Pattern. Unpublish it before choosing an outlet.";
  }
  if (!canPublish) return "This editor cannot change the outlet.";
  if (selectedSlot === null) return "Select a slot in Structure first.";
  if (!selectedSlot.empty) return `${selectedSlot.label} already has a component. Choose an empty slot.`;
  return null;
}

function clearCopy(kind: ClearablePublication): { title: string; message: string; label: string } {
  return kind === "pattern"
    ? {
      title: "Unpublish Pattern?",
      message: "This removes the composition’s reusable Pattern status. It does not delete the composition.",
      label: "Unpublish Pattern",
    }
    : {
      title: "Unpublish Global template?",
      message: "This removes the composition’s Global template status. It does not delete the composition.",
      label: "Unpublish Global template",
    };
}

/** What this composition is right now, as one line. */
function StatusBanner({
  publication,
  presentation,
  actions,
}: {
  publication: CompositionDocument["publication"];
  presentation: LinkedEditorPresentation;
  actions?: LinkedEditorLifecycleActions;
}): Child {
  if (presentation.state === "blocked") {
    return (
      <Banner
        tone="err"
        title="Linked template unavailable"
        action={
          <>
            {actions?.onRetry ? (
              <Button size="sm" on:click={() => actions.onRetry?.()}>
                <RefreshIcon size="sm" />
                Retry
              </Button>
            ) : null}
            {actions?.onRemoveBrokenBinding ? (
              <Button size="sm" variant="danger" on:click={() => actions.onRemoveBrokenBinding?.()}>
                <TrashIcon size="sm" />
                Remove broken binding
              </Button>
            ) : null}
          </>
        }
      >
        {presentation.message}
      </Banner>
    );
  }

  if (presentation.state === "resolved") {
    return (
      <Banner
        tone="info"
        title="This composition consumes a Global template."
        action={
          <>
            {actions?.onOpenSource ? (
              <Button size="sm" on:click={() => actions.onOpenSource?.(presentation.sourceRecordId)}>
                <ArrowRightIcon size="sm" />
                Open source
              </Button>
            ) : null}
            {actions?.onDetach ? (
              <Button size="sm" on:click={() => actions.onDetach?.()}>
                <XMarkIcon size="sm" />
                Detach
              </Button>
            ) : null}
          </>
        }
      >
        {presentation.sourceName} · Outlet: {presentation.outletLabel || presentation.outletId} · Locked
      </Banner>
    );
  }

  if (publication?.kind === "pattern") {
    return (
      <Banner tone="info" title="This composition is a Pattern.">
        Other compositions can insert it as a linked block. Edits here update every use.
      </Banner>
    );
  }
  if (publication?.kind === "global-template") {
    return (
      <Banner tone="info" title="This composition is a Global template.">
        Outlet {publication.outlet.label || "Untitled outlet"} (id {publication.outlet.id}) is filled by each consumer.
      </Banner>
    );
  }
  return (
    <Banner tone="info" title="This composition is not reusable yet.">
      Publish it as a Pattern, or mark an empty slot as a Global template outlet.
    </Banner>
  );
}

export function ReuseControls({
  document: documentProp,
  manifest,
  mode,
  lastError = null,
  onPublishPattern,
  onClearPublication,
  selectedSlot: selectedSlotProp = null,
  onSetGlobalTemplateOutlet,
  linkedPresentation = { state: "local" },
  linkedActions,
}: ReuseControlsProps): Child {
  const document = toSignal(documentProp);
  const selectedSlot = toSignal(selectedSlotProp);
  const readOnly = computed(() => read(mode) === "preview");
  const diagnostics = memo(() => diagnoseDocument(document.value, manifest).reuseReasons, (left, right) =>
    left.length === right.length && left.every((reason, index) => reason.code === right[index]!.code && reason.message === right[index]!.message));
  const publication = computed(() => document.value.publication);
  const patternReasonId = createDomId();
  const outletReasonId = createDomId();

  const confirmingClear = signal<ClearablePublication | null>(null);
  const busy = signal(false);
  const feedback = signal<string | null>(null);
  const outletDraft = signal<string | null>(null);
  const outletLabel = signal("");
  const outletError = signal<string | null>(null);

  const isGlobalTemplate = computed(() => publication.value?.kind === "global-template");
  const patternReason = computed(() => (readOnly.value ? "Reuse actions are unavailable in preview." : patternDisabledReason(document.value)));
  const outletReason = computed(() => outletDisabledReason({
    readOnly: readOnly.value,
    document: document.value,
    canPublish: onSetGlobalTemplateOutlet !== undefined,
    selectedSlot: selectedSlot.value,
  }));

  async function clearPublication(): Promise<void> {
    const clearing = confirmingClear.value;
    if (clearing === null) return;
    busy.value = true;
    feedback.value = null;
    try {
      const result = await onClearPublication();
      feedback.value =
        result.status === "applied"
          ? `${clearing === "pattern" ? "Pattern" : "Global template"} unpublished. Check the save status for persistence.`
          : result.message;
    } catch (reason) {
      feedback.value = reason instanceof Error ? reason.message : "Publication could not be removed.";
    } finally {
      busy.value = false;
      confirmingClear.value = null;
    }
  }

  async function saveOutlet(): Promise<void> {
    const slot = selectedSlot.value;
    if (!onSetGlobalTemplateOutlet || slot === null || outletDraft.value === null) return;
    const label = outletLabel.value.trim();
    if (label.length === 0) {
      outletError.value = "Enter an outlet label before publishing.";
      return;
    }
    busy.value = true;
    outletError.value = null;
    try {
      const target: GlobalTemplateOutletTarget = { parentId: slot.parentId, slotId: slot.slotId };
      const result = await onSetGlobalTemplateOutlet(target, label);
      if (result.status === "applied") {
        outletDraft.value = null;
        feedback.value = result.message ?? "Global template outlet published. Check the save status for persistence.";
      } else {
        outletError.value = result.message;
      }
    } finally {
      busy.value = false;
    }
  }

  const statusView = memo(() => ({ publication: document.value.publication, presentation: read(linkedPresentation), actions: read(linkedActions) }));
  const editingOutlet = computed(() => outletDraft.value !== null);
  const clearCopyNow = computed(() => (confirmingClear.value ? clearCopy(confirmingClear.value) : null));

  return (
    <>
      <PaneSection title="Reuse">
        <Rebuild value={statusView}>
          {(view) => <StatusBanner publication={view.publication} presentation={view.presentation} actions={view.actions} />}
        </Rebuild>
      </PaneSection>

      <PaneSection title="Pattern" class="sg-composer-reuse-option">
        <p class="sg-composer-reuse-scope">
          <ContainerIcon size="sm" />
          {PATTERN_SCOPE}
        </p>
        <Show
          when={computed(() => publication.value?.kind === "pattern")}
          fallback={() => (
            <Button
              size="sm"
              disabled={computed(() => patternReason.value !== null)}
              aria-describedby={computed(() => (patternReason.value ? patternReasonId : undefined))}
              on:click={() => onPublishPattern()}
            >
              Publish as Pattern
            </Button>
          )}
        >
          {() => (
            <Button
              variant="danger"
              size="sm"
              disabled={computed(() => readOnly.value || busy.value)}
              aria-describedby={computed(() => (readOnly.value ? patternReasonId : undefined))}
              on:click={() => { confirmingClear.value = "pattern"; }}
            >
              <TrashIcon size="sm" />
              Unpublish Pattern
            </Button>
          )}
        </Show>
        <Show when={computed(() => patternReason.value !== null)}>
          {() => (
            <p id={patternReasonId} class="sg-composer-reuse-reason" data-sg-reuse-pattern-reason>
              {patternReason}
            </p>
          )}
        </Show>
      </PaneSection>

      <PaneSection title="Global template outlet" class="sg-composer-reuse-option">
        <p class="sg-composer-reuse-scope">
          <SlotIcon size="sm" />
          {OUTLET_SCOPE}
        </p>
        <Show when={isGlobalTemplate}>
          {() => (
            <p class="sg-composer-reuse-reason" data-sg-reuse-outlet-status>
              {computed(() => {
                const current = publication.value;
                return current?.kind === "global-template"
                  ? `Current outlet: ${current.outlet.label || "Untitled outlet"} (id ${current.outlet.id}).`
                  : "";
              })}
            </p>
          )}
        </Show>
        <Show
          when={editingOutlet}
          fallback={() => (
            <div class="sg-composer-reuse-actions">
              <Button
                size="sm"
                disabled={computed(() => outletReason.value !== null || busy.value)}
                aria-describedby={computed(() => (outletReason.value ? outletReasonId : undefined))}
                on:click={() => {
                  outletError.value = null;
                  const current = publication.value;
                  const draft = current?.kind === "global-template" ? current.outlet.label : (selectedSlot.value?.label ?? "");
                  outletLabel.value = draft;
                  outletDraft.value = draft;
                }}
              >
                {computed(() => {
                  const slot = selectedSlot.value;
                  return slot === null
                    ? "Select a slot first"
                    : isGlobalTemplate.value
                      ? `Reassign outlet to ${slot.label}`
                      : `Use ${slot.label} as outlet`;
                })}
              </Button>
              <Show when={isGlobalTemplate}>
                {() => (
                  <Button variant="danger" size="sm" disabled={computed(() => readOnly.value || busy.value)} on:click={() => { confirmingClear.value = "global-template"; }}>
                    <TrashIcon size="sm" />
                    Unpublish Global template
                  </Button>
                )}
              </Show>
            </div>
          )}
        >
          {() => (
            <div class="sg-composer-reuse-actions" data-sg-template-outlet-control>
              <Field label="Outlet label" error={outletError}>
                {(field) => (
                  <Input
                    field={field}
                    size="sm"
                    modelValue={outletLabel}
                    disabled={busy}
                    on:input={(event: Event) => {
                      outletError.value = null;
                      outletDraft.value = (event.currentTarget as HTMLInputElement).value;
                    }}
                  />
                )}
              </Field>
              <Button variant="primary" size="sm" disabled={busy} on:click={() => void saveOutlet()}>
                {computed(() => (busy.value ? "Saving outlet…" : isGlobalTemplate.value ? "Save reassignment" : "Publish template"))}
              </Button>
              <Button size="sm" disabled={busy} on:click={() => { outletDraft.value = null; outletError.value = null; }}>
                Cancel
              </Button>
            </div>
          )}
        </Show>
        <Show when={computed(() => outletReason.value !== null && outletDraft.value === null)}>
          {() => (
            <p id={outletReasonId} class="sg-composer-reuse-reason">
              {outletReason}
            </p>
          )}
        </Show>
      </PaneSection>

      <Show when={computed(() => diagnostics.value.length > 0)}>
        {() => (
          <Rebuild value={diagnostics}>
            {(reasons) => (
              <PaneSection title="Reuse needs attention">
                <ul class="sg-composer-reuse-diagnostics" data-sg-reuse-diagnostics>
                  {reasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}
                </ul>
                {reasons.some((reason) => reason.code === "stale-outlet-target") ? (
                  <p class="sg-composer-reuse-reason">Choose another valid empty slot in Structure, or unpublish this composition.</p>
                ) : null}
              </PaneSection>
            )}
          </Rebuild>
        )}
      </Show>

      <p class="sg-composer-reuse-reason" role="status" aria-live="polite" aria-atomic="true" data-sg-reuse-feedback>
        {computed(() => feedback.value ?? read(lastError) ?? "")}
      </p>

      <ConfirmDialog
        open={computed(() => confirmingClear.value !== null)}
        title={computed(() => clearCopyNow.value?.title ?? "")}
        message={computed(() => clearCopyNow.value?.message ?? "")}
        confirmLabel={computed(() => clearCopyNow.value?.label ?? "Confirm")}
        tone="danger"
        busy={busy}
        onConfirm={() => void clearPublication()}
        onClose={() => { confirmingClear.value = null; }}
      />
    </>
  );
}
