import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { RailCollapseButton } from "../../components/editor-chrome";
import { MappingIcon, PreviewIcon } from "../../components/icons";
import { Chip, EmptyState, Field, Pane, PaneBody, PaneHeader, PaneSection, PaneTabs, Select, StatusChip } from "../../components/ui";
import type { StatusChipTone } from "../../components/ui";
import type { ContentEntryRecord, ContentModelRecord } from "../../content";
import type { ComposerComponentProvider } from "../composer/component-provider";
import { CompositionPreviewHost } from "../composer/preview/composition-preview-host";
import type { ContentPreviewCandidate, ContentPreviewSource, ContentPreviewState } from "./preview-source";

export interface ContentPreviewPaneProps {
  providerId: string;
  model: ContentModelRecord | null;
  entry: ContentEntryRecord | null;
  entryName: string;
  componentProvider?: ComposerComponentProvider;
  createPreviewSource?: () => ContentPreviewSource;
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

/**
 * The Content inspector: what this Entry renders as, what bound it, and what
 * else points at its model.
 *
 * The preview evaluates the in-memory draft rather than the stored record, so
 * it answers "what will this look like" while the Entry is still being typed —
 * which is why the Render-through choice is a session selection and writes no
 * Mapping record.
 */
export function ContentPreviewPane({ providerId, model, entry, entryName, componentProvider, createPreviewSource }: ContentPreviewPaneProps): JSX.Element {
  const source = useMemo(() => createPreviewSource?.() ?? null, [createPreviewSource]);
  const [preview, setPreview] = useState<ContentPreviewState | null>(() => source?.state ?? null);
  const [tab, setTab] = useState<InspectorTab>("preview");

  useEffect(() => {
    if (!source) return;
    const unsubscribe = source.subscribe(setPreview);
    return () => { unsubscribe(); source.dispose(); };
  }, [source]);

  useEffect(() => {
    if (!source || !model || !entry) return;
    void source.load({ providerId, recordId: model.id }, entry);
  }, [source, providerId, model?.id, entry?.id]);

  useEffect(() => {
    if (!source || !entry || preview?.phase !== "ready") return;
    source.evaluate(entry);
  }, [source, entry, preview?.phase]);

  const header = <PaneHeader title="Preview" actions={<RailCollapseButton rail="insp" />} />;

  if (!model || !entry) {
    return (
      <Pane label="Preview">
        {header}
        <PaneBody padded>
          <EmptyState icon={PreviewIcon} title="No Entry selected" description="Choose an Entry to evaluate its current draft." inline />
        </PaneBody>
      </Pane>
    );
  }

  if (!source || !componentProvider || !preview) {
    return (
      <Pane label="Preview">
        {header}
        <PaneBody padded>
          <EmptyState icon={PreviewIcon} title="Preview dependencies unavailable" description="The Entry can still be authored and saved safely." inline />
        </PaneBody>
      </Pane>
    );
  }

  const selectedIndex = preview.selectedRef === null
    ? -1
    : preview.candidates.findIndex((candidate) => refKey(candidate.ref) === refKey(preview.selectedRef!));
  const selected = selectedIndex === -1 ? undefined : preview.candidates[selectedIndex];
  const diagnostics = preview.context?.diagnostics ?? [];
  const blockedDiagnostics = preview.candidates.flatMap((candidate) => candidate.status === "broken" ? candidate.diagnostics.map((diagnostic) => ({ candidate, diagnostic })) : []);
  const bindings = preview.context?.appliedBindings ?? [];
  const fieldLabels = new Map(model.document.fields.map((field) => [field.id, field.label]));

  return (
    <Pane label="Preview">
      {header}
      <PaneTabs<InspectorTab>
        label="Inspector"
        activeId={tab}
        onSelect={setTab}
        panelId={(id) => `sg-content-inspector-${id}`}
        tabs={[
          { id: "preview", label: "Preview" },
          { id: "mapping", label: "Mapping", count: bindings.length },
          { id: "usage", label: "Usage", count: preview.candidates.length },
        ]}
      />
      <PaneBody>
        {tab === "preview" ? (
          <div id="sg-content-inspector-preview" role="tabpanel" class="sg-content-inspector">
            <div class="sg-content-inspector__pad">
              <Field label="Render through" help={`${entryName} · ${providerId} / ${entry.id}`}>
                <Select
                  size="sm"
                  value={selectedIndex === -1 ? "" : String(selectedIndex)}
                  onChange={(event) => {
                    const candidate = preview.candidates[Number(event.currentTarget.value)];
                    if (candidate) source.select(candidate.ref, entry);
                  }}
                >
                  {preview.selectedRef ? null : <option value="">No ready Mapping</option>}
                  {preview.candidates.map((candidate, index) => (
                    <option key={refKey(candidate.ref)} value={String(index)} disabled={candidate.status === "broken"}>
                      {candidateLabel(candidate)}
                    </option>
                  ))}
                </Select>
              </Field>
              <StatusChip
                state="custom"
                tone={statusTone(preview)}
                label={preview.message}
                {...(preview.context ? { detail: `${preview.context.appliedBindingCount} binding${preview.context.appliedBindingCount === 1 ? "" : "s"} applied` } : {})}
              />
            </div>
            <CompositionPreviewHost
              componentProvider={componentProvider}
              document={preview.document}
              title={`${entryName} preview`}
              loading={preview.phase === "loading"}
              emptyTitle={preview.phase === "loading" ? "Loading preview" : "Preview unavailable"}
              emptyMessage={preview.message}
              enlargeable
            />
            {diagnostics.length > 0 || blockedDiagnostics.length > 0 || preview.failures.length > 0 ? (
              <PaneSection title="Preview diagnostics">
                <ul class="sg-content-diagnostics">
                  {diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}><code>{diagnostic.code}</code> {diagnostic.message}</li>)}
                  {blockedDiagnostics.map(({ candidate, diagnostic }, index) => <li key={`${refKey(candidate.ref)}-${diagnostic.code}-${index}`}><code>{candidate.providerLabel} / {candidate.ref.recordId} · {diagnostic.code}</code> {diagnostic.message}</li>)}
                  {preview.failures.map((failure, index) => <li key={`${failure.scope}-${index}`}><code>{failure.scope}</code> {failure.providerId ? `${failure.providerId}: ` : ""}{failure.message}</li>)}
                </ul>
              </PaneSection>
            ) : null}
          </div>
        ) : null}

        {tab === "mapping" ? (
          <div id="sg-content-inspector-mapping" role="tabpanel" class="sg-content-inspector">
            <PaneSection
              title="Bindings"
              action={preview.selectedRef ? <a class="sg-content-link" href={mappingHref(preview.selectedRef)}>Open Mapping</a> : null}
            >
              {preview.context === null ? (
                <EmptyState title="Nothing is bound yet" description="Choose a ready Mapping to see which fields it applies." inline />
              ) : (
                <>
                  <p class="sg-content-note">
                    Mapping: {selected?.providerLabel ?? preview.context.mapping.ref.providerId} / {preview.context.mapping.name} · Composition: {preview.context.composition.providerId} / {preview.context.composition.name}
                  </p>
                  <ul class="sg-content-bindings">
                    {bindings.map((binding) => (
                      <li key={binding.bindingId}>
                        <span>{fieldLabels.get(binding.sourceFieldId) ?? binding.sourceFieldId} → {binding.target.nodeId}.{binding.target.prop}</span>
                        <Chip tone="ok">bound</Chip>
                      </li>
                    ))}
                    {preview.context.unchangedStaticCount > 0 ? (
                      <li>
                        <span>{preview.context.unchangedStaticCount} binding{preview.context.unchangedStaticCount === 1 ? "" : "s"} left the Composition&rsquo;s own value in place</span>
                        <Chip tone="plain">static</Chip>
                      </li>
                    ) : null}
                  </ul>
                </>
              )}
            </PaneSection>
          </div>
        ) : null}

        {tab === "usage" ? (
          <div id="sg-content-inspector-usage" role="tabpanel" class="sg-content-inspector">
            <PaneSection title="Referenced by">
              {preview.candidates.length === 0 ? (
                <EmptyState icon={MappingIcon} title="No Mapping references this model" description="A Mapping naming this Content model appears here." inline />
              ) : (
                <ul class="sg-content-usage">
                  {preview.candidates.map((candidate) => (
                    <li key={refKey(candidate.ref)}>
                      <a class="sg-content-link" href={mappingHref(candidate.ref)}>{candidate.summary.name}</a>
                      <span class="sg-content-note">{candidate.providerLabel}</span>
                      <Chip tone={candidate.status === "ready" ? "ok" : "warn"}>{candidate.status === "ready" ? "ready" : "blocked"}</Chip>
                    </li>
                  ))}
                </ul>
              )}
            </PaneSection>
          </div>
        ) : null}
      </PaneBody>
    </Pane>
  );
}
