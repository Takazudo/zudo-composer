import { computed, Show, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { createEditorRails, RailCollapseButton, type EditorRailsController } from "../../components/editor-chrome";
import { memo, toSignal, type MaybeSignal } from "../../components/reactive";
import { Rebuild } from "../../components/rebuild";
import { CheckCircleIcon, ComposerIcon, EntryIcon } from "../../components/icons";
import { Banner, EmptyState, Pane, PaneBody, PaneHeader, PaneSection, PaneTabs, StatusChip } from "../../components/ui";
import type { MappingDefinitionDiagnostic, MappingEntryDiagnostic } from "../../mapping";
import type { ComposerComponentProvider } from "../composer/component-provider";
import type { MappingEditorState } from "./controller";
import type { MappingEditorController } from "./controller";
import { MappingPreviewHost } from "./preview-host";
import { diagnosticPath, entryLabel } from "./presentation";
import { MappingAttachmentPane } from "./attachment-pane";

// The inspector: what the current sample Entry renders as, and everything the
// resolver has to say about the Mapping. Diagnostics used to be drawn in three
// places — a per-binding line, a preview-pane list and a modal — so the same
// message could disagree with itself. They live here and inline on the row now.

export type MappingInspectorTab = "preview" | "diagnostics";

export interface InspectorPaneProps {
  state: ReadonlySignal<MappingEditorState>;
  componentProvider: ComposerComponentProvider;
  /** The editor body's rails controller, for the collapse control. */
  rails?: EditorRailsController;
  tab: MaybeSignal<MappingInspectorTab>;
  onTabChange: (tab: MappingInspectorTab) => void;
  onPreviewCurrent: () => void;
  onPreviewError: (message: string) => void;
  controller: MappingEditorController;
  run: (action: () => void | Promise<void>) => void;
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
  rails = createEditorRails(),
  tab,
  onTabChange,
  onPreviewCurrent,
  onPreviewError,
  controller,
  run,
}: InspectorPaneProps): Child {
  const activeTab = toSignal(tab);
  const mapping = computed(() => state.value.mapping!);
  const model = computed(() => state.value.definition?.contentModel ?? null);
  const composition = computed(() => {
    const current = state.value;
    const ref = mapping.value.document.composition;
    const entry = current.compositions.find((candidate) => candidate.ref.providerId === ref.providerId && candidate.ref.recordId === ref.recordId);
    return {
      name: current.definition?.composition?.document.name ?? entry?.summary.name ?? ref.recordId,
      provider: entry?.providerLabel ?? ref.providerId,
      recordId: ref.recordId,
    };
  });
  const diagnostics = memo(() => [...(state.value.definition?.diagnostics ?? []), ...(state.value.evaluation?.entryDiagnostics ?? [])] as readonly AnyDiagnostic[]);
  const previewFailure = computed(() => state.value.previewStatus === "error" && state.value.message ? state.value.message : null);
  const count = computed(() => diagnostics.value.length + (state.value.collectionEvaluation?.diagnostics.length ?? 0) + (state.value.entryFailure ? 1 : 0) + (previewFailure.value ? 1 : 0));
  const status = memo(() => { const next = previewStatus(state.value); return [next.label, next.tone] as const; });

  return (
    <Pane label="Inspector" class="cms-mapping-insp">
      <PaneHeader title="Inspector" actions={<RailCollapseButton rail="insp" rails={rails} />} />
      <PaneTabs
        label="Inspector"
        activeId={activeTab}
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
        <div hidden={computed(() => activeTab.value !== "preview")}>
          <PaneSection title="Preview">
            <dl class="cms-mapping-context">
              <div>
                <dt>
                  <EntryIcon size="xs" /> Entry
                </dt>
                <dd>
                  <strong>{computed(() => state.value.entry ? entryLabel(state.value.entry, model.value) : "No sample Entry selected")}</strong>
                  <span>{computed(() => state.value.entry?.id ?? "Choose one in Source fields")}</span>
                </dd>
              </div>
              <div>
                <dt>
                  <ComposerIcon size="xs" /> Composition
                </dt>
                <dd>
                  <strong>{computed(() => composition.value.name)}</strong>
                  <span>{computed(() => `${composition.value.provider} · ${composition.value.recordId}`)}</span>
                </dd>
              </div>
            </dl>
            <Rebuild value={status}>{([label, tone]) => (
              <StatusChip
                state="custom"
                label={label}
                tone={tone}
                icon={tone === "ok" ? CheckCircleIcon : undefined}
                class="cms-mapping-preview-status"
              />
            )}</Rebuild>
            <MappingPreviewHost
              componentProvider={componentProvider}
              document={computed(() => state.value.previewDocument)}
              loading={computed(() => state.value.previewStatus === "loading")}
              onCurrent={onPreviewCurrent}
              onError={onPreviewError}
            />
            <MappingAttachmentPane state={state} controller={controller} componentProvider={componentProvider} run={run} />
          </PaneSection>
        </div>
        <div hidden={computed(() => activeTab.value !== "diagnostics")}>
          <PaneSection title="Diagnostics">
            <Show when={computed(() => count.value === 0)}>{() => (
              <EmptyState
                inline
                icon={CheckCircleIcon}
                title="No diagnostics"
                description="Nothing blocks this Mapping and nothing needs attention."
              />
            )}</Show>
            <Show when={computed(() => Boolean(state.value.entryFailure))}>{() => (
              <Banner tone="err" title="Entry provider unavailable.">{computed(() => state.value.entryFailure ?? "")}</Banner>
            )}</Show>
            <Show when={computed(() => previewFailure.value !== null)}>{() => <Banner tone="err" title="Preview host failure.">{computed(() => previewFailure.value ?? "")}</Banner>}</Show>
            <Rebuild value={memo(() => [state.value.collectionEvaluation?.diagnostics, diagnostics.value] as const)}>{([queryDiagnostics, current]) => <>
              {queryDiagnostics?.map((diagnostic, index) => (
                <Banner
                  key={`query:${diagnostic.code}:${index}`}
                  tone={diagnostic.severity === "blocking" ? "err" : "warn"}
                  title={`Query · ${diagnostic.severity}`}
                >
                  <span class="cms-mapping-diagnostic__path">{diagnosticPath(diagnostic) ?? "query"}</span>
                  {diagnostic.message}
                </Banner>
              ))}
              {current.map((diagnostic, index) => (
                <Banner
                  key={`${diagnostic.scope}:${diagnostic.code}:${index}`}
                  tone={diagnostic.severity === "blocking" ? "err" : "warn"}
                  title={`${diagnostic.scope === "definition" ? "Definition" : "Entry"} · ${diagnostic.severity}`}
                >
                  {diagnosticPath(diagnostic) ? <span class="cms-mapping-diagnostic__path">{diagnosticPath(diagnostic)}</span> : null}
                  {diagnostic.message}
                </Banner>
              ))}
            </>}</Rebuild>
          </PaneSection>
        </div>
      </PaneBody>
    </Pane>
  );
}
