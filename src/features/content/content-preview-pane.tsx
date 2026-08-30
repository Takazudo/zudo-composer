import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { ContentEntryRecord, ContentModelRecord } from "../../content";
import type { ComposerComponentProvider } from "../composer/component-provider";
import { CompositionPreviewHost } from "../composer/preview/composition-preview-host";
import type { ContentPreviewSource, ContentPreviewState } from "./preview-source";

export interface ContentPreviewPaneProps {
  providerId: string;
  model: ContentModelRecord | null;
  entry: ContentEntryRecord | null;
  entryName: string;
  componentProvider?: ComposerComponentProvider;
  createPreviewSource?: () => ContentPreviewSource;
}

export function ContentPreviewPane({ providerId, model, entry, entryName, componentProvider, createPreviewSource }: ContentPreviewPaneProps): JSX.Element {
  const source = useMemo(() => createPreviewSource?.() ?? null, [createPreviewSource]);
  const [preview, setPreview] = useState<ContentPreviewState | null>(() => source?.state ?? null);

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

  if (!model || !entry) return <div class="sg-content-empty"><h3>No Entry selected</h3><p>Choose an Entry to evaluate its current draft.</p></div>;
  if (!source || !componentProvider || !preview) return <div class="sg-content-empty"><h3>Preview dependencies unavailable</h3><p>The Entry can still be authored and saved safely.</p></div>;

  const selected = preview.candidates.find(({ ref }) => ref.providerId === preview.selectedRef?.providerId && ref.recordId === preview.selectedRef?.recordId);
  const diagnostics = preview.context?.diagnostics ?? [];
  const blockedDiagnostics = preview.candidates.flatMap((candidate) => candidate.status === "broken" ? candidate.diagnostics.map((diagnostic) => ({ candidate, diagnostic })) : []);
  const openMapping = preview.selectedRef ? `/mapping?provider=${encodeURIComponent(preview.selectedRef.providerId)}&mapping=${encodeURIComponent(preview.selectedRef.recordId)}` : null;

  return <div class="sg-content-preview-pane">
    <div class="sg-content-preview-context">
      <div><span>Entry</span><strong>{entryName}</strong><code>{providerId} / {entry.id}</code></div>
      <label>Compatible Mapping
        <select value={preview.selectedRef ? `${preview.selectedRef.providerId}\u0000${preview.selectedRef.recordId}` : ""} onChange={(event) => {
          const [nextProviderId, recordId] = event.currentTarget.value.split("\u0000");
          if (nextProviderId && recordId) source.select({ providerId: nextProviderId, recordId }, entry);
        }}>
          {!preview.selectedRef && <option value="">No ready Mapping</option>}
          {preview.candidates.map((candidate) => <option key={`${candidate.ref.providerId}/${candidate.ref.recordId}`} value={`${candidate.ref.providerId}\u0000${candidate.ref.recordId}`} disabled={candidate.status === "broken"}>{candidate.providerLabel} · {candidate.summary.name}{candidate.status === "broken" ? " — blocked" : ""}</option>)}
        </select>
      </label>
      {openMapping && <a class="sg-content-open-mapping" href={openMapping}>Open Mapping</a>}
    </div>

    <div class="sg-content-preview-status" role="status">
      <strong>{preview.message}</strong>
      {preview.context && <span>Mapping: {selected?.providerLabel ?? preview.context.mapping.ref.providerId} / {preview.context.mapping.name} · Composition: {preview.context.composition.providerId} / {preview.context.composition.name} · {preview.context.appliedBindingCount} binding{preview.context.appliedBindingCount === 1 ? "" : "s"} applied</span>}
    </div>

    {(diagnostics.length > 0 || blockedDiagnostics.length > 0 || preview.failures.length > 0) && <section class="sg-content-preview-diagnostics" aria-labelledby="content-preview-diagnostics">
      <h3 id="content-preview-diagnostics">Preview diagnostics</h3>
      <ul>
        {diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}><code>{diagnostic.code}</code> {diagnostic.message}</li>)}
        {blockedDiagnostics.map(({ candidate, diagnostic }, index) => <li key={`${candidate.ref.providerId}-${candidate.ref.recordId}-${diagnostic.code}-${index}`}><code>{candidate.providerLabel} / {candidate.ref.recordId} · {diagnostic.code}</code> {diagnostic.message}</li>)}
        {preview.failures.map((failure, index) => <li key={`${failure.scope}-${index}`}><code>{failure.scope}</code> {failure.providerId ? `${failure.providerId}: ` : ""}{failure.message}</li>)}
      </ul>
    </section>}

    <CompositionPreviewHost
      componentProvider={componentProvider}
      document={preview.document}
      title={`${entryName} preview`}
      loading={preview.phase === "loading"}
      emptyTitle={preview.phase === "loading" ? "Loading preview" : "Preview unavailable"}
      emptyMessage={preview.message}
      enlargeable
    />
  </div>;
}
