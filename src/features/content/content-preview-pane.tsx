import { hostDocumentPreviewConfigured } from "../delivery/host-preview-policy";
import { SavedHostContentPreview } from "./saved-host-preview";
import type { ContentSaveStatus } from "./controller";
import { computed, getScope, Show, signal, type Child, type ReadonlySignal, type Signal } from "@takazudo/zfb/zudo-react";
import type { VersionedAssetStore } from "../../assets/library";
import type { ProductionProviderIntegration } from "../../app/provider-integration";
import { RailCollapseButton, type EditorRailsController } from "../../components/editor-chrome";
import { MappingIcon, PreviewIcon } from "../../components/icons";
import { toSignal, type MaybeSignal } from "../../components/reactive";
import { Rebuild } from "../../components/rebuild";
import { Chip, EmptyState, Field, Pane, PaneBody, PaneHeader, PaneSection, PaneTabs, Select, StatusChip } from "../../components/ui";
import type { FieldControl, StatusChipTone } from "../../components/ui";
import type { ContentEntryRecord, ContentModelRecord } from "../../content";
import { Keyed } from "../../runtime";
import type { ComposerComponentProvider } from "../composer/component-provider";
import { CompositionPreviewHost } from "../composer/preview/composition-preview-host";
import type { ContentPreviewCandidate, ContentPreviewSource, ContentPreviewState } from "./preview-source";

export interface ContentPreviewPaneProps {
  /** Static: the Content route remounts with its provider. */
  providerId: string;
  model: MaybeSignal<ContentModelRecord | null>;
  entry: MaybeSignal<ContentEntryRecord | null>;
  entryName: MaybeSignal<string>;
  saveStatus?: MaybeSignal<ContentSaveStatus>;
  componentProvider?: ComposerComponentProvider;
  /** Called once in setup; the source lives as long as the pane. */
  createPreviewSource?: () => ContentPreviewSource;
  /** The editor's rails controller; the collapse control renders only when given. */
  rails?: EditorRailsController;
  /** `services.workspace.integration`, for the saved host-document preview. */
  integration?: ProductionProviderIntegration;
  assetStore?: VersionedAssetStore;
}

type InspectorTab = "preview" | "mapping" | "usage";

/**
 * A Mapping is addressed by provider *and* record, and a record id may contain
 * anything — so the Render-through options carry the candidate's position and
 * the handler reads the ref back off the list, rather than packing two ids into
 * one string and having to pick a separator that no id can contain.
 */
function candidateLabel(candidate: ContentPreviewCandidate): string {
  return `${candidate.providerLabel} · ${candidate.summary.name}${candidate.status === "broken" ? " — blocked" : ""}`;
}

function refKey(ref: { providerId: string; recordId: string }): string {
  return `${ref.providerId}/${ref.recordId}`;
}

function mappingHref(ref: { providerId: string; recordId: string }): string {
  return `/mapping?provider=${encodeURIComponent(ref.providerId)}&mapping=${encodeURIComponent(ref.recordId)}`;
}

function statusTone(preview: ContentPreviewState): StatusChipTone {
  if (preview.phase === "error") return "err";
  if (preview.phase === "loading") return "neutral";
  return preview.context && preview.context.diagnostics.length === 0 ? "ok" : "warn";
}

function selectedIndexOf(preview: ContentPreviewState): number {
  return preview.selectedRef === null
    ? -1
    : preview.candidates.findIndex((candidate) => refKey(candidate.ref) === refKey(preview.selectedRef!));
}

/** The last non-null value, so a view torn down after its input clears never reads null. */
function retained<T>(value: ReadonlySignal<T | null>, initial: T): ReadonlySignal<T> {
  let last = initial;
  return computed(() => {
    const next = value.value;
    if (next !== null) last = next;
    return last;
  });
}

/**
 * The Content inspector: what this Entry renders as, what bound it, and what
 * else points at its model.
 *
 * The preview evaluates the in-memory draft rather than the stored record, so
 * it answers "what will this look like" while the Entry is still being typed —
 * which is why the Render-through choice is a session selection and writes no
 * Mapping record.
 */
export function ContentPreviewPane({ providerId, model: modelProp, entry: entryProp, entryName: entryNameProp, componentProvider, createPreviewSource, saveStatus: saveStatusProp = "pristine", rails, integration, assetStore }: ContentPreviewPaneProps): Child {
  const scope = getScope();
  const model = toSignal(modelProp);
  const entry = toSignal(entryProp);
  const entryName = toSignal(entryNameProp);
  const saveStatus = toSignal(saveStatusProp);
  const source = createPreviewSource?.() ?? null;
  const preview = signal<ContentPreviewState | null>(source?.state ?? null);
  const tab = signal<InspectorTab>("preview");

  if (source) {
    const unsubscribe = source.subscribe((state) => { preview.value = state; });
    scope.onCleanup(() => { unsubscribe(); source.dispose(); });
  }

  let loadedKey: string | null = null;
  scope.effect(() => {
    const currentModel = model.value, currentEntry = entry.value;
    const key = currentModel && currentEntry ? JSON.stringify([currentModel.id, currentEntry.id]) : null;
    if (key === loadedKey) return;
    loadedKey = key;
    if (!source || !currentModel || !currentEntry) return;
    void source.load({ providerId, recordId: currentModel.id }, currentEntry);
  });

  let evaluatedEntry: ContentEntryRecord | null = null;
  let evaluatedPhase: ContentPreviewState["phase"] | undefined;
  scope.effect(() => {
    const currentEntry = entry.value, phase = preview.value?.phase;
    if (currentEntry === evaluatedEntry && phase === evaluatedPhase) return;
    evaluatedEntry = currentEntry;
    evaluatedPhase = phase;
    if (!source || !currentEntry || phase !== "ready") return;
    source.evaluate(currentEntry);
  });

  const header = () => <PaneHeader title="Preview" actions={rails ? <RailCollapseButton rail="insp" rails={rails} /> : undefined} />;
  const view = computed(() => (!model.value || !entry.value ? "none" : !source || !componentProvider || !preview.value ? "unavailable" : "ready"));

  return (
    <Pane label="Preview">
      {header()}
      <Rebuild value={view}>{(current) => {
        if (current === "none") {
          return (
            <PaneBody padded>
              <EmptyState icon={PreviewIcon} title="No Entry selected" description="Choose an Entry to evaluate its current draft." inline />
            </PaneBody>
          );
        }
        if (current === "unavailable" || !source || !componentProvider) {
          return (
            <PaneBody padded>
              <EmptyState icon={PreviewIcon} title="Preview dependencies unavailable" description="The Entry can still be authored and saved safely." inline />
            </PaneBody>
          );
        }
        return <ReadyInspector
          providerId={providerId}
          source={source}
          componentProvider={componentProvider}
          preview={retained(preview, preview.value!)}
          model={retained(model, model.value!)}
          entry={retained(entry, entry.value!)}
          entryName={entryName}
          saveStatus={saveStatus}
          tab={tab}
          integration={integration}
          assetStore={assetStore}
        />;
      }}</Rebuild>
    </Pane>
  );
}

interface ReadyInspectorProps {
  providerId: string;
  source: ContentPreviewSource;
  componentProvider: ComposerComponentProvider;
  preview: ReadonlySignal<ContentPreviewState>;
  model: ReadonlySignal<ContentModelRecord>;
  entry: ReadonlySignal<ContentEntryRecord>;
  entryName: ReadonlySignal<string>;
  saveStatus: ReadonlySignal<ContentSaveStatus>;
  tab: Signal<InspectorTab>;
  integration?: ProductionProviderIntegration;
  assetStore?: VersionedAssetStore;
}

/** One build per option list; the bound value only ever names an option this build rendered. */
function CandidateSelect({ field, preview, onChoose }: { field: FieldControl; preview: ReadonlySignal<ContentPreviewState>; onChoose: (candidate: ContentPreviewCandidate) => void }): Child {
  const scope = getScope();
  const built = preview.value;
  const hasEmpty = selectedIndexOf(built) === -1;
  const valueOf = (index: number) => (index === -1 ? "" : String(index));
  const selection = signal(valueOf(selectedIndexOf(built)));
  scope.effect(() => {
    const index = selectedIndexOf(preview.value);
    if (index === -1 ? hasEmpty : index < built.candidates.length) selection.value = valueOf(index);
  });
  return (
    <Select
      size="sm"
      field={field}
      modelValue={selection}
      on:change={(event: Event) => {
        const candidate = preview.value.candidates[Number((event.currentTarget as HTMLSelectElement).value)];
        if (candidate) onChoose(candidate);
      }}
    >
      {hasEmpty ? <option value="">No ready Mapping</option> : null}
      {built.candidates.map((candidate, index) => (
        <option value={String(index)} disabled={candidate.status === "broken"}>{candidateLabel(candidate)}</option>
      ))}
    </Select>
  );
}

function ReadyInspector({ providerId, source, componentProvider, preview, model, entry, entryName, saveStatus, tab, integration, assetStore }: ReadyInspectorProps): Child {
  const bindingCount = computed(() => preview.value.context?.appliedBindings.length ?? 0);
  const candidateCount = computed(() => preview.value.candidates.length);
  const showing = (id: InspectorTab) => computed(() => tab.value === id);
  // Options are static per Select; the list's shape keys a rebuild.
  const optionsShape = computed(() => {
    const current = preview.value;
    return JSON.stringify([selectedIndexOf(current) === -1, current.candidates.map((candidate) => [refKey(candidate.ref), candidateLabel(candidate), candidate.status])]);
  });
  const help = computed(() => `${entryName.value} · ${providerId} / ${entry.value.id}`);
  const ownerKey = computed(() => JSON.stringify([providerId, entry.value.modelId, entry.value.id]));

  return (
    <>
      <PaneTabs<InspectorTab>
        label="Inspector"
        activeId={tab}
        onSelect={(id) => { tab.value = id; }}
        panelId={(id) => `sg-content-inspector-${id}`}
        tabs={[
          { id: "preview", label: "Preview" },
          { id: "mapping", label: "Mapping", count: bindingCount },
          { id: "usage", label: "Usage", count: candidateCount },
        ]}
      />
      <PaneBody>
        <Show when={showing("preview")}>{() => (
          <div id="sg-content-inspector-preview" role="tabpanel" aria-label="Preview" class="sg-content-inspector">
            <div class="sg-content-inspector__pad">
              <Field class="sg-content-preview-field" label={hostDocumentPreviewConfigured ? "Mapping definition" : "Render through"} help={help}>
                {(field: FieldControl) => <Rebuild value={optionsShape}>{() => <CandidateSelect field={field} preview={preview} onChoose={(candidate) => source.select(candidate.ref, entry.value)} />}</Rebuild>}
              </Field>
              <Rebuild value={preview}>{(current) => {
                const selected = current.candidates[selectedIndexOf(current)];
                return (
                  <StatusChip
                    class="sg-content-preview-status"
                    state="custom"
                    tone={statusTone(current)}
                    label={hostDocumentPreviewConfigured && selected?.status === "ready" ? "Mapping definition ready (not host rendered)" : current.message}
                    {...(current.context ? { detail: `${current.context.appliedBindingCount} binding${current.context.appliedBindingCount === 1 ? "" : "s"} applied` } : {})}
                  />
                );
              }}</Rebuild>
            </div>
            {hostDocumentPreviewConfigured
              ? <Keyed value={ownerKey} by={(key: string) => key}>{() => <SavedHostContentPreview providerId={providerId} entry={entry} saveStatus={saveStatus} integration={integration} />}</Keyed>
              : <CompositionPreviewHost
                componentProvider={componentProvider}
                document={computed(() => preview.value.document)}
                title={`${entryName.value} preview`}
                loading={computed(() => preview.value.phase === "loading")}
                emptyTitle={computed(() => (preview.value.phase === "loading" ? "Loading preview" : "Preview unavailable"))}
                emptyMessage={computed(() => preview.value.message)}
                enlargeable
                assetStore={assetStore}
              />}
            <Rebuild value={preview}>{(current) => {
              const diagnostics = current.context?.diagnostics ?? [];
              const blockedDiagnostics = current.candidates.flatMap((candidate) => candidate.status === "broken" ? candidate.diagnostics.map((diagnostic) => ({ candidate, diagnostic })) : []);
              if (diagnostics.length === 0 && blockedDiagnostics.length === 0 && current.failures.length === 0) return null;
              return (
                <PaneSection title="Preview diagnostics">
                  <ul class="sg-content-diagnostics">
                    {diagnostics.map((diagnostic) => <li><code>{diagnostic.code}</code> {diagnostic.message}</li>)}
                    {blockedDiagnostics.map(({ candidate, diagnostic }) => <li><code>{`${candidate.providerLabel} / ${candidate.ref.recordId} · ${diagnostic.code}`}</code> {diagnostic.message}</li>)}
                    {current.failures.map((failure) => <li><code>{failure.scope}</code> {failure.providerId ? `${failure.providerId}: ` : ""}{failure.message}</li>)}
                  </ul>
                </PaneSection>
              );
            }}</Rebuild>
          </div>
        )}</Show>

        <Show when={showing("mapping")}>{() => (
          <div id="sg-content-inspector-mapping" role="tabpanel" aria-label="Mapping" class="sg-content-inspector">
            <Rebuild value={preview}>{(current) => {
              const selected = current.candidates[selectedIndexOf(current)];
              const bindings = current.context?.appliedBindings ?? [];
              const fieldLabels = new Map(model.value.document.fields.map((field) => [field.id, field.label]));
              return (
                <PaneSection
                  title="Bindings"
                  action={current.selectedRef ? <a class="sg-content-link" href={mappingHref(current.selectedRef)}>Open Mapping</a> : null}
                >
                  {current.context === null ? (
                    <EmptyState title="Nothing is bound yet" description="Choose a ready Mapping to see which fields it applies." inline />
                  ) : (
                    <>
                      <p class="sg-content-note">
                        {`Mapping: ${selected?.providerLabel ?? current.context.mapping.ref.providerId} / ${current.context.mapping.name} · Composition: ${current.context.composition.providerId} / ${current.context.composition.name}`}
                      </p>
                      <ul class="sg-content-bindings">
                        {bindings.map((binding) => (
                          <li>
                            <span>{`${binding.source ? `Entry identity (${binding.source.providerId}/${binding.source.modelId}/${binding.source.recordId})` : fieldLabels.get(binding.sourceFieldId) ?? binding.sourceFieldId} → ${binding.target.nodeId}.${binding.target.prop}`}</span>
                            <Chip tone="ok">bound</Chip>
                          </li>
                        ))}
                        {current.context.unchangedStaticCount > 0 ? (
                          <li>
                            <span>{`${current.context.unchangedStaticCount} binding${current.context.unchangedStaticCount === 1 ? "" : "s"} left the Composition’s own value in place`}</span>
                            <Chip tone="plain">static</Chip>
                          </li>
                        ) : null}
                      </ul>
                    </>
                  )}
                </PaneSection>
              );
            }}</Rebuild>
          </div>
        )}</Show>

        <Show when={showing("usage")}>{() => (
          <div id="sg-content-inspector-usage" role="tabpanel" aria-label="Usage" class="sg-content-inspector">
            <PaneSection title="Referenced by">
              <Rebuild value={preview}>{(current) => current.candidates.length === 0 ? (
                <EmptyState icon={MappingIcon} title="No Mapping references this model" description="A Mapping naming this Content model appears here." inline />
              ) : (
                <ul class="sg-content-usage">
                  {current.candidates.map((candidate) => (
                    <li>
                      <a class="sg-content-link" href={mappingHref(candidate.ref)}>{candidate.summary.name}</a>
                      <span class="sg-content-note">{candidate.providerLabel}</span>
                      <Chip tone={candidate.status === "ready" ? "ok" : "warn"}>{candidate.status === "ready" ? "ready" : "blocked"}</Chip>
                    </li>
                  ))}
                </ul>
              )}</Rebuild>
            </PaneSection>
          </div>
        )}</Show>
      </PaneBody>
    </>
  );
}
