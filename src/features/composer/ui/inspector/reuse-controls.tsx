/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The inspector's Reuse tab: one banner saying what this composition is right
// now, then one card per reusable role.
//
// The essays this surface used to carry are gone. Reuse used to sit above the
// props an author actually came to edit, and three paragraphs of scope rules
// pushed them below the fold; each card now states its scope in one line and
// keeps its own action, and the guidance that only matters when an action is
// unavailable is attached to the disabled control instead.

import type { JSX } from "preact";
import { useId, useState } from "preact/hooks";
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
import { Banner, Button, Field, Input, PaneSection } from "../../../../components/ui";
import type { ComposerMode } from "../../chrome/controller-model";
import type { SelectedSlot } from "../tree/structure-pane";
import type { ReuseAuthoringActionResult } from "../shared/reuse-authoring-contract";

export interface ReuseControlsProps {
  document: CompositionDocument;
  manifest: ComponentCatalog;
  mode: ComposerMode;
  /** Latest synchronous controller rejection, kept visible beside the controls. */
  lastError?: string | null;
  onPublishPattern: () => void;
  /** Must wait for the provider-owned dependent query before invoking the command. */
  onClearPublication: () => Promise<ReuseAuthoringActionResult>;
  /**
   * The slot selected in Structure, which is what a Global template outlet is
   * published from. Null disables the outlet action with a reason.
   */
  selectedSlot?: (SelectedSlot & { label: string; empty: boolean }) | null;
  /** Provider-checked publish/reassign for one real empty component slot. */
  onSetGlobalTemplateOutlet?: (
    target: GlobalTemplateOutletTarget,
    label: string,
  ) => Promise<ReuseAuthoringActionResult>;
  /** Document-level link state; selection and fields remain local-only. */
  linkedPresentation?: LinkedEditorPresentation;
  linkedActions?: LinkedEditorLifecycleActions;
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
  document,
  presentation,
  actions,
}: {
  document: CompositionDocument;
  presentation: LinkedEditorPresentation;
  actions?: LinkedEditorLifecycleActions;
}): JSX.Element {
  if (presentation.state === "blocked") {
    return (
      <Banner
        tone="err"
        title="Linked template unavailable"
        action={
          <>
            {actions?.onRetry && (
              <Button size="sm" onClick={() => actions.onRetry?.()}>
                <RefreshIcon size="sm" />
                Retry
              </Button>
            )}
            {actions?.onRemoveBrokenBinding && (
              <Button size="sm" variant="danger" onClick={() => actions.onRemoveBrokenBinding?.()}>
                <TrashIcon size="sm" />
                Remove broken binding
              </Button>
            )}
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
            {actions?.onOpenSource && (
              <Button size="sm" onClick={() => actions.onOpenSource?.(presentation.sourceRecordId)}>
                <ArrowRightIcon size="sm" />
                Open source
              </Button>
            )}
            {actions?.onDetach && (
              <Button size="sm" onClick={() => actions.onDetach?.()}>
                <XMarkIcon size="sm" />
                Detach
              </Button>
            )}
          </>
        }
      >
        {presentation.sourceName} · Outlet: {presentation.outletLabel || presentation.outletId} · Locked
      </Banner>
    );
  }

  const publication = document.publication;
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
  document,
  manifest,
  mode,
  lastError = null,
  onPublishPattern,
  onClearPublication,
  selectedSlot = null,
  onSetGlobalTemplateOutlet,
  linkedPresentation = { state: "local" },
  linkedActions,
}: ReuseControlsProps): JSX.Element {
  const readOnly = mode === "preview";
  const diagnostics = diagnoseDocument(document, manifest);
  const publication = document.publication;
  const patternReasonId = useId();
  const outletReasonId = useId();

  const [confirmingClear, setConfirmingClear] = useState<ClearablePublication | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [outletDraft, setOutletDraft] = useState<string | null>(null);
  const [outletError, setOutletError] = useState<string | null>(null);

  const isGlobalTemplate = publication?.kind === "global-template";
  const patternReason = readOnly ? "Reuse actions are unavailable in preview." : patternDisabledReason(document);
  // Ordered by what an author most needs to know: a document-level conflict
  // outranks a missing capability, which outranks "you have not picked a slot".
  const outletReason = readOnly
    ? "Reuse actions are unavailable in preview."
    : document.binding !== undefined
      ? "A bound composition cannot publish an outlet of its own."
      : publication?.kind === "pattern"
        ? "This composition is a Pattern. Unpublish it before choosing an outlet."
        : !onSetGlobalTemplateOutlet
          ? "This editor cannot change the outlet."
          : selectedSlot === null
            ? "Select a slot in Structure first."
            : !selectedSlot.empty
              ? `${selectedSlot.label} already has a component. Choose an empty slot.`
              : null;

  async function clearPublication(): Promise<void> {
    const clearing = confirmingClear;
    if (clearing === null) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await onClearPublication();
      setFeedback(
        result.status === "applied"
          ? `${clearing === "pattern" ? "Pattern" : "Global template"} unpublished. Check the save status for persistence.`
          : result.message,
      );
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : "Publication could not be removed.");
    } finally {
      setBusy(false);
      setConfirmingClear(null);
    }
  }

  async function saveOutlet(): Promise<void> {
    if (!onSetGlobalTemplateOutlet || selectedSlot === null || outletDraft === null) return;
    const label = outletDraft.trim();
    if (label.length === 0) {
      setOutletError("Enter an outlet label before publishing.");
      return;
    }
    setBusy(true);
    setOutletError(null);
    try {
      const target: GlobalTemplateOutletTarget = { parentId: selectedSlot.parentId, slotId: selectedSlot.slotId };
      const result = await onSetGlobalTemplateOutlet(target, label);
      if (result.status === "applied") {
        setOutletDraft(null);
        setFeedback(result.message ?? "Global template outlet published. Check the save status for persistence.");
      } else {
        setOutletError(result.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PaneSection title="Reuse">
        <StatusBanner document={document} presentation={linkedPresentation} actions={linkedActions} />
      </PaneSection>

      <PaneSection title="Pattern" class="sg-composer-reuse-option">
        <p class="sg-composer-reuse-scope">
          <ContainerIcon size="sm" />
          {PATTERN_SCOPE}
        </p>
        {publication?.kind === "pattern" ? (
          <Button
            variant="danger"
            size="sm"
            disabled={readOnly || busy}
            aria-describedby={readOnly ? patternReasonId : undefined}
            onClick={() => setConfirmingClear("pattern")}
          >
            <TrashIcon size="sm" />
            Unpublish Pattern
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={patternReason !== null}
            aria-describedby={patternReason ? patternReasonId : undefined}
            onClick={onPublishPattern}
          >
            Publish as Pattern
          </Button>
        )}
        {patternReason && (
          <p id={patternReasonId} class="sg-composer-reuse-reason" data-sg-reuse-pattern-reason>
            {patternReason}
          </p>
        )}
      </PaneSection>

      <PaneSection title="Global template outlet" class="sg-composer-reuse-option">
        <p class="sg-composer-reuse-scope">
          <SlotIcon size="sm" />
          {OUTLET_SCOPE}
        </p>
        {isGlobalTemplate && (
          <p class="sg-composer-reuse-reason" data-sg-reuse-outlet-status>
            Current outlet: {publication.outlet.label || "Untitled outlet"} (id {publication.outlet.id}).
          </p>
        )}
        {outletDraft === null ? (
          <div class="sg-composer-reuse-actions">
            <Button
              size="sm"
              disabled={outletReason !== null || busy}
              aria-describedby={outletReason ? outletReasonId : undefined}
              onClick={() => {
                setOutletError(null);
                setOutletDraft(isGlobalTemplate ? publication.outlet.label : (selectedSlot?.label ?? ""));
              }}
            >
              {selectedSlot === null
                ? "Select a slot first"
                : isGlobalTemplate
                  ? `Reassign outlet to ${selectedSlot.label}`
                  : `Use ${selectedSlot.label} as outlet`}
            </Button>
            {isGlobalTemplate && (
              <Button variant="danger" size="sm" disabled={readOnly || busy} onClick={() => setConfirmingClear("global-template")}>
                <TrashIcon size="sm" />
                Unpublish Global template
              </Button>
            )}
          </div>
        ) : (
          <div class="sg-composer-reuse-actions" data-sg-template-outlet-control>
            <Field label="Outlet label" error={outletError ?? undefined}>
              <Input
                size="sm"
                value={outletDraft}
                disabled={busy}
                onInput={(event) => {
                  setOutletError(null);
                  setOutletDraft(event.currentTarget.value);
                }}
              />
            </Field>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void saveOutlet()}>
              {busy ? "Saving outlet…" : isGlobalTemplate ? "Save reassignment" : "Publish template"}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => { setOutletDraft(null); setOutletError(null); }}>
              Cancel
            </Button>
          </div>
        )}
        {outletReason && outletDraft === null && (
          <p id={outletReasonId} class="sg-composer-reuse-reason">
            {outletReason}
          </p>
        )}
      </PaneSection>

      {diagnostics.reuseReasons.length > 0 && (
        <PaneSection title="Reuse needs attention">
          <ul class="sg-composer-reuse-diagnostics" data-sg-reuse-diagnostics>
            {diagnostics.reuseReasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}
          </ul>
          {diagnostics.reuseReasons.some((reason) => reason.code === "stale-outlet-target") && (
            <p class="sg-composer-reuse-reason">Choose another valid empty slot in Structure, or unpublish this composition.</p>
          )}
        </PaneSection>
      )}

      <p class="sg-composer-reuse-reason" role="status" aria-live="polite" aria-atomic="true" data-sg-reuse-feedback>
        {feedback ?? lastError ?? ""}
      </p>

      <ConfirmDialog
        open={confirmingClear !== null}
        title={confirmingClear ? clearCopy(confirmingClear).title : ""}
        message={confirmingClear ? clearCopy(confirmingClear).message : ""}
        confirmLabel={confirmingClear ? clearCopy(confirmingClear).label : "Confirm"}
        tone="danger"
        busy={busy}
        onConfirm={() => void clearPublication()}
        onClose={() => setConfirmingClear(null)}
      />
    </>
  );
}
