/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { JSX, Ref } from "preact";
import type { ComponentCatalog, CompositionDocument } from "../../../../composer/browser";
import { diagnoseDocument } from "../../../../composer/browser";
import { PlusIcon, TrashIcon, XMarkIcon } from "../../../../components/icons";
import type { ComposerMode } from "../../chrome/controller-model";
import type { ReuseAuthoringActionResult } from "../shared/reuse-authoring-contract";

export interface ReuseControlsProps {
  document: CompositionDocument;
  manifest: ComponentCatalog;
  mode: ComposerMode;
  /** Latest synchronous controller rejection, kept visible beside the reuse controls. */
  lastError?: string | null;
  onPublishPattern: () => void;
  /** Must wait for the provider-owned dependent query before invoking the command. */
  onClearPublication: () => Promise<ReuseAuthoringActionResult>;
}

type ClearablePublication = "pattern" | "global-template";
type FocusTarget = "publish-pattern" | "unpublish-pattern" | "unpublish-global-template";

const PATTERN_SCOPE_COPY =
  "Whole-Composition scope: publishing immediately makes this entire Composition, including every root component, a reusable Pattern. It does not publish the selected subtree.";
const PATTERN_PUBLISHED_COPY =
  "Available as a reusable Pattern in this document. The Composer save status reports whether this change is durably saved.";
const GLOBAL_TEMPLATE_COPY =
  "Global templates are published from Structure by choosing a real empty component slot. That named outlet and its consumers are managed there; it is not an alternative Pattern radio choice.";

function patternDisabledReasons(document: CompositionDocument): string[] {
  const reasons: string[] = [];
  if (document.binding !== undefined) {
    reasons.push("This Composition is bound to a Global template. Remove its binding before publishing it as a Pattern.");
  } else if (document.root.length === 0) {
    reasons.push("Add at least one root component before publishing a Pattern.");
  } else if (document.publication?.kind === "global-template") {
    reasons.push("This Composition is currently a Global template. Unpublish the Global template before publishing it as a Pattern.");
  }
  return reasons;
}

function clearConfirmationCopy(kind: ClearablePublication): { heading: string; message: string; label: string } {
  if (kind === "pattern") {
    return {
      heading: "Unpublish Pattern?",
      message: "This immediately removes this Composition’s reusable Pattern status. It does not delete the Composition.",
      label: "Unpublish Pattern",
    };
  }
  return {
    heading: "Unpublish Global template?",
    message: "This immediately removes this Composition’s Global template status. It does not delete the Composition.",
    label: "Unpublish Global template",
  };
}

function mutationMessage(kind: ClearablePublication, action: "published" | "unpublished"): string {
  const subject = kind === "pattern" ? "Pattern" : "Global template";
  return `${subject} ${action} in this document. Check the Composer save status for persistence.`;
}

export function ReuseControls({
  document,
  manifest,
  mode,
  lastError = null,
  onPublishPattern,
  onClearPublication,
}: ReuseControlsProps): JSX.Element {
  const readOnly = mode === "preview";
  const diagnostics = diagnoseDocument(document, manifest);
  const publication = document.publication;
  const patternScopeId = useId();
  const patternReasonId = useId();
  const patternPublishedCopyId = useId();
  const globalTemplateCopyId = useId();
  const previewReasonId = useId();
  // Publication clears are history barriers by design, so their confirmation remains necessary.
  const [confirmingClear, setConfirmingClear] = useState<ClearablePublication | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveFeedback, setLiveFeedback] = useState<string | null>(null);
  const [patternPublicationRequested, setPatternPublicationRequested] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const publishPatternRef = useRef<HTMLButtonElement | null>(null);
  const unpublishPatternRef = useRef<HTMLButtonElement | null>(null);
  const unpublishGlobalTemplateRef = useRef<HTMLButtonElement | null>(null);
  const cancelConfirmRef = useRef<HTMLButtonElement | null>(null);
  const disabledPatternReasons = patternDisabledReasons(document);
  const patternDisabled = readOnly || disabledPatternReasons.length > 0;
  const globalTemplateDisabledReason = readOnly ? "Reuse actions are unavailable in preview." : null;

  useEffect(() => {
    if (!patternPublicationRequested) return;
    if (publication?.kind === "pattern") {
      setLiveFeedback(mutationMessage("pattern", "published"));
      setPatternPublicationRequested(false);
    } else if (lastError) {
      setFocusTarget(null);
      setPatternPublicationRequested(false);
    }
  }, [lastError, patternPublicationRequested, publication?.kind]);

  useEffect(() => {
    if (confirmingClear !== null) cancelConfirmRef.current?.focus();
  }, [confirmingClear]);

  useEffect(() => {
    if (busy || confirmingClear !== null || focusTarget === null) return;
    if (focusTarget === "publish-pattern" && publication === undefined) {
      publishPatternRef.current?.focus();
      setFocusTarget(null);
    } else if (focusTarget === "unpublish-pattern" && publication?.kind === "pattern") {
      unpublishPatternRef.current?.focus();
      setFocusTarget(null);
    } else if (focusTarget === "unpublish-global-template" && publication?.kind === "global-template") {
      unpublishGlobalTemplateRef.current?.focus();
      setFocusTarget(null);
    }
  }, [busy, confirmingClear, focusTarget, publication?.kind]);

  function publishPattern(): void {
    setLiveFeedback(null);
    setFocusTarget("unpublish-pattern");
    setPatternPublicationRequested(true);
    onPublishPattern();
  }

  function cancelClear(): void {
    const cancelled = confirmingClear;
    setConfirmingClear(null);
    if (cancelled === "pattern") setFocusTarget("unpublish-pattern");
    if (cancelled === "global-template") setFocusTarget("unpublish-global-template");
  }

  async function clearPublication(): Promise<void> {
    const clearing = confirmingClear;
    if (clearing === null) return;
    setBusy(true);
    setLiveFeedback(null);
    try {
      const result = await onClearPublication();
      if (result.status === "applied") {
        setLiveFeedback(mutationMessage(clearing, "unpublished"));
        setFocusTarget("publish-pattern");
      } else {
        setLiveFeedback(result.message);
        setFocusTarget(clearing === "pattern" ? "unpublish-pattern" : "unpublish-global-template");
      }
    } catch (reason) {
      setLiveFeedback(reason instanceof Error ? reason.message : "Publication could not be removed.");
      setFocusTarget(clearing === "pattern" ? "unpublish-pattern" : "unpublish-global-template");
    } finally {
      setBusy(false);
      setConfirmingClear(null);
    }
  }

  const patternDescription = [
    patternScopeId,
    disabledPatternReasons.length > 0 ? patternReasonId : null,
    globalTemplateDisabledReason ? previewReasonId : null,
  ].filter(Boolean).join(" ");
  const globalDescription = [globalTemplateCopyId, globalTemplateDisabledReason ? previewReasonId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <section class="sg-composer-inspector-section flex min-w-0 flex-col gap-vsp-xs" aria-labelledby="sg-composer-reuse-title">
      <div class="flex min-w-0 flex-col gap-vsp-3xs">
        <h2 id="sg-composer-reuse-title" class="text-small font-semibold text-fg">Reuse</h2>
        <p class="text-caption text-muted">
          Choose how this Composition can be reused. Reuse changes apply to this Composition record.
        </p>
      </div>

      <section class="flex min-w-0 flex-col gap-vsp-3xs rounded-md border border-border p-hsp-sm" aria-labelledby="sg-composer-pattern-title">
        <h3 id="sg-composer-pattern-title" class="text-small font-semibold text-fg">Pattern</h3>
        <p id={patternScopeId} class="min-w-0 text-caption text-muted">{PATTERN_SCOPE_COPY}</p>

        {publication?.kind === "pattern" ? (
          <>
            <p class="text-small font-semibold text-fg">Published as Pattern</p>
            <p id={patternPublishedCopyId} class="min-w-0 text-caption text-muted">{PATTERN_PUBLISHED_COPY}</p>
            {confirmingClear === "pattern" ? (
              <PublicationClearConfirmation
                kind="pattern"
                busy={busy}
                cancelRef={cancelConfirmRef}
                onCancel={cancelClear}
                onConfirm={() => void clearPublication()}
              />
            ) : (
              <button
                ref={unpublishPatternRef}
                type="button"
                class="sg-composer-toolbar-button sg-composer-inspector-remove w-full justify-center"
                disabled={readOnly}
                aria-describedby={[patternPublishedCopyId, globalTemplateDisabledReason ? previewReasonId : null].filter(Boolean).join(" ")}
                onClick={() => {
                  setLiveFeedback(null);
                  setConfirmingClear("pattern");
                }}
              >
                <TrashIcon size="sm" class="sg-composer-button-icon" />
                Unpublish Pattern
              </button>
            )}
          </>
        ) : (
          <>
            <button
              ref={publishPatternRef}
              type="button"
              class="sg-composer-toolbar-button w-full justify-center"
              disabled={patternDisabled}
              aria-describedby={patternDescription}
              onClick={publishPattern}
            >
              <PlusIcon size="sm" class="sg-composer-button-icon" />
              Publish as Pattern
            </button>
            {disabledPatternReasons.length > 0 && (
              <p id={patternReasonId} class="min-w-0 text-caption text-muted" data-sg-reuse-pattern-reason>
                {disabledPatternReasons.map((reason) => <span key={reason} class="block">{reason}</span>)}
                {document.binding !== undefined && (
                  <span class="block">This Composition is a consumer and cannot republish itself.</span>
                )}
              </p>
            )}
          </>
        )}
      </section>

      <section class="flex min-w-0 flex-col gap-vsp-3xs rounded-md border border-border p-hsp-sm" aria-labelledby="sg-composer-global-template-title">
        <h3 id="sg-composer-global-template-title" class="text-small font-semibold text-fg">Global template</h3>
        <p id={globalTemplateCopyId} class="min-w-0 text-caption text-muted">{GLOBAL_TEMPLATE_COPY}</p>

        {publication?.kind === "global-template" && (
          <>
            <p class="text-small font-semibold text-fg">Published as Global template</p>
            <p class="min-w-0 text-caption text-muted" data-sg-reuse-outlet-status>
              Template outlet: {publication.outlet.label || "Untitled outlet"}. Managed from Structure.
            </p>
            <p class="min-w-0 text-caption text-muted">
              Outlet ID: {publication.outlet.id}. Renaming or reassigning its target keeps this consumer-facing identity.
            </p>
            {confirmingClear === "global-template" ? (
              <PublicationClearConfirmation
                kind="global-template"
                busy={busy}
                cancelRef={cancelConfirmRef}
                onCancel={cancelClear}
                onConfirm={() => void clearPublication()}
              />
            ) : (
              <button
                ref={unpublishGlobalTemplateRef}
                type="button"
                class="sg-composer-toolbar-button sg-composer-inspector-remove w-full justify-center"
                disabled={readOnly}
                aria-describedby={globalDescription}
                onClick={() => {
                  setLiveFeedback(null);
                  setConfirmingClear("global-template");
                }}
              >
                <TrashIcon size="sm" class="sg-composer-button-icon" />
                Unpublish Global template
              </button>
            )}
          </>
        )}
      </section>

      {globalTemplateDisabledReason && (
        <p id={previewReasonId} class="text-caption text-muted">{globalTemplateDisabledReason}</p>
      )}

      {diagnostics.reuseReasons.length > 0 && (
        <div class="sg-composer-inspector-diagnostics" role="alert" data-sg-reuse-diagnostics>
          <p class="sg-composer-inspector-diagnostics-title">Reuse needs attention.</p>
          <ul class="list-disc pl-hsp-md">
            {diagnostics.reuseReasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}
          </ul>
          {diagnostics.reuseReasons.some((reason) => reason.code === "stale-outlet-target") && (
            <p class="mt-vsp-3xs">Choose another valid empty slot in Structure, or unpublish this Composition.</p>
          )}
        </div>
      )}

      <p class="text-caption text-muted" role="status" aria-live="polite" aria-atomic="true" data-sg-reuse-feedback>
        {liveFeedback ?? lastError ?? ""}
      </p>
    </section>
  );
}

function PublicationClearConfirmation({
  kind,
  busy,
  cancelRef,
  onCancel,
  onConfirm,
}: {
  kind: ClearablePublication;
  busy: boolean;
  cancelRef: Ref<HTMLButtonElement>;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const copy = clearConfirmationCopy(kind);
  return (
    <div class="flex min-w-0 flex-col gap-vsp-3xs rounded-md bg-surface-2 p-hsp-sm" role="group" aria-labelledby={`sg-composer-${kind}-clear-title`}>
      <p id={`sg-composer-${kind}-clear-title`} class="text-small font-semibold text-fg">{copy.heading}</p>
      <p class="min-w-0 text-caption text-muted">{copy.message}</p>
      <div class="flex min-w-0 flex-col gap-hsp-2xs">
        <button ref={cancelRef} type="button" class="sg-composer-toolbar-button w-full justify-center" disabled={busy} onClick={onCancel}>
          <XMarkIcon size="sm" class="sg-composer-button-icon" />
          Cancel
        </button>
        <button
          type="button"
          class="sg-composer-toolbar-button sg-composer-inspector-remove w-full justify-center"
          disabled={busy}
          onClick={onConfirm}
        >
          <TrashIcon size="sm" class="sg-composer-button-icon" />
          {copy.label}
        </button>
      </div>
    </div>
  );
}
