/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { RailCollapseButton } from "../../components/editor-chrome";
import { CheckCircleIcon, ComposerIcon, EntryIcon } from "../../components/icons";
import { Banner, EmptyState, Pane, PaneBody, PaneHeader, PaneSection, PaneTabs, StatusChip } from "../../components/ui";
import type { MappingDefinitionDiagnostic, MappingEntryDiagnostic } from "../../mapping";
import type { ComposerComponentProvider } from "../composer/component-provider";
import type { MappingEditorState } from "./controller";
import { MappingPreviewHost } from "./preview-host";
import { entryLabel } from "./presentation";

// The inspector: what the current sample Entry renders as, and everything the
// resolver has to say about the Mapping. Diagnostics used to be drawn in three
// places — a per-binding line, a preview-pane list and a modal — so the same
// message could disagree with itself. They live here and inline on the row now.

export type MappingInspectorTab = "preview" | "diagnostics";

export interface InspectorPaneProps {
  state: MappingEditorState;
  componentProvider: ComposerComponentProvider;
  tab: MappingInspectorTab;
  onTabChange: (tab: MappingInspectorTab) => void;
  onPreviewCurrent: () => void;
  onPreviewError: (message: string) => void;
}

type AnyDiagnostic = MappingDefinitionDiagnostic | MappingEntryDiagnostic;

function previewStatus(state: MappingEditorState): { label: string; tone: "ok" | "warn" | "err" | "neutral" } {
  switch (state.previewStatus) {
    case "current": {
      const applied = state.evaluation
        ? ` · ${state.evaluation.appliedBindingCount} of ${state.mapping?.document.bindings.length ?? 0} applied`
        : "";
      return { label: `Preview is current${applied}`, tone: "ok" };
    }
    case "loading": return { label: "Updating preview…", tone: "neutral" };
    case "error": return { label: state.message || "Preview unavailable", tone: "err" };
    default: return { label: "Waiting for a valid Composition and Entry", tone: "warn" };
  }
}

export function InspectorPane({
  state,
  componentProvider,
  tab,
  onTabChange,
  onPreviewCurrent,
  onPreviewError,
}: InspectorPaneProps): JSX.Element {
  const mapping = state.mapping!;
  const model = state.definition?.contentModel ?? null;
  const compositionEntry = state.compositions.find(
    (entry) => entry.ref.providerId === mapping.document.composition.providerId
      && entry.ref.recordId === mapping.document.composition.recordId,
  );
  const compositionName = state.definition?.composition?.document.name
    ?? compositionEntry?.summary.name
    ?? mapping.document.composition.recordId;
  const compositionProvider = compositionEntry?.providerLabel ?? mapping.document.composition.providerId;

  const diagnostics: readonly AnyDiagnostic[] = [
    ...(state.definition?.diagnostics ?? []),
    ...(state.evaluation?.entryDiagnostics ?? []),
  ];
  const previewFailure = state.previewStatus === "error" && state.message ? state.message : null;
  const count = diagnostics.length + (state.entryFailure ? 1 : 0) + (previewFailure ? 1 : 0);
  const status = previewStatus(state);

  return (
    <Pane label="Inspector" class="cms-mapping-insp">
      <PaneHeader title="Inspector" actions={<RailCollapseButton rail="insp" />} />
      <PaneTabs
        label="Inspector"
        activeId={tab}
        onSelect={onTabChange}
        tabs={[
          { id: "preview", label: "Preview" },
          { id: "diagnostics", label: "Diagnostics", count },
        ]}
      />
      <PaneBody>
        {/*
         * Both panels stay mounted and the inactive one is `hidden`, which is
         * what keeps the preview iframe alive: unmounting it on every tab
         * switch would tear down the bridge and reload the frame, and Test
         * switches tabs by design. `hidden` also takes the inactive panel out
         * of the accessibility tree, which is what an inactive tab wants.
         */}
        <div hidden={tab !== "preview"}>
          <PaneSection title="Preview">
            <dl class="cms-mapping-context">
              <div>
                <dt>
                  <EntryIcon size="xs" /> Entry
                </dt>
                <dd>
                  <strong>{state.entry ? entryLabel(state.entry, model) : "No sample Entry selected"}</strong>
                  <span>{state.entry?.id ?? "Choose one in Source fields"}</span>
                </dd>
              </div>
              <div>
                <dt>
                  <ComposerIcon size="xs" /> Composition
                </dt>
                <dd>
                  <strong>{compositionName}</strong>
                  <span>{compositionProvider} · {mapping.document.composition.recordId}</span>
                </dd>
              </div>
            </dl>
            <StatusChip
              state="custom"
              label={status.label}
              tone={status.tone}
              icon={status.tone === "ok" ? CheckCircleIcon : undefined}
              class="cms-mapping-preview-status"
            />
            <MappingPreviewHost
              componentProvider={componentProvider}
              document={state.previewDocument}
              loading={state.previewStatus === "loading"}
              onCurrent={onPreviewCurrent}
              onError={onPreviewError}
            />
          </PaneSection>
        </div>
        <div hidden={tab !== "diagnostics"}>
          <PaneSection title="Diagnostics">
            {count === 0 ? (
              <EmptyState
                inline
                icon={CheckCircleIcon}
                title="No diagnostics"
                description="Nothing blocks this Mapping and nothing needs attention."
              />
            ) : null}
            {state.entryFailure ? (
              <Banner tone="err" title="Entry provider unavailable.">{state.entryFailure}</Banner>
            ) : null}
            {previewFailure ? <Banner tone="err" title="Preview host failure.">{previewFailure}</Banner> : null}
            {diagnostics.map((diagnostic, index) => (
              <Banner
                key={`${diagnostic.scope}:${diagnostic.code}:${index}`}
                tone={diagnostic.severity === "blocking" ? "err" : "warn"}
                title={`${diagnostic.scope === "definition" ? "Definition" : "Entry"} · ${diagnostic.severity}`}
              >
                {diagnostic.message}
              </Banner>
            ))}
          </PaneSection>
        </div>
      </PaneBody>
    </Pane>
  );
}
