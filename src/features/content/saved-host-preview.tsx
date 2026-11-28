import { computed, getScope, Show, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import type { ContentEntryRecord } from "../../content/model";
import type { ContentSaveStatus } from "./controller";
import type { HostContentContext, HostContentDocument } from "../../shared/host-content-preview";
import type { ProductionProviderIntegration } from "../../app/provider-integration";
import { Button, Field, Select, type FieldControl } from "../../components/ui";
import { Rebuild } from "../../components/rebuild";
import { toSignal, type MaybeSignal } from "../../components/reactive";
import { nativeContentRead } from "../native-editing/session";
import { acceptHostDocumentMessage, matchesHostDocumentFrame } from "../host-document/protocol";
import { canonicalStringifyJson } from "../../site-project/model/canonical";
import type { JsonValue } from "@zudo-composer/component-contract";
const recordJson = (entry: ContentEntryRecord) => canonicalStringifyJson(entry as unknown as JsonValue);

export interface SavedHostContentPreviewProps {
  providerId: string;
  entry: MaybeSignal<ContentEntryRecord>;
  saveStatus: MaybeSignal<ContentSaveStatus>;
  /** The mounted workspace's provider graph (`services.workspace.integration`); absent outside a native workspace. */
  integration?: ProductionProviderIntegration;
}

/** A saved route document; never an in-memory draft or a fragment renderer. */
export function SavedHostContentPreview({ providerId, entry: entryProp, saveStatus: saveStatusProp, integration }: SavedHostContentPreviewProps): Child {
  const scope = getScope();
  const entry = toSignal(entryProp);
  const saveStatus = toSignal(saveStatusProp);
  const workspaceId = integration?.workspace.id;
  const context = signal<HostContentContext | null>(null);
  const document = signal<HostContentDocument | null>(null);
  const error = signal<string | null>(null);
  const busy = signal(false), current = signal(false);
  const selection = signal("");
  let sequence = 0, invalid = false, acknowledged: Document | null = null;
  const frame: Ref<HTMLIFrameElement> = { current: null };
  const ownerRef = () => { const value = entry.value; return { providerId, modelId: value.modelId, recordId: value.id }; };
  const clear = () => { sequence++; invalid = true; acknowledged = null; current.value = false; document.value = null; context.value = null; busy.value = false; };
  const refresh = async () => {
    clear(); if (!workspaceId) { error.value = "Open a native workspace to preview saved Content."; return; }
    invalid = false; const request = sequence; const ref = ownerRef(); busy.value = true; error.value = null;
    try {
      const value = await nativeContentRead<HostContentContext>("content-preview-context", { workspaceId, entry: ref });
      if (request !== sequence || scope.abortSignal.aborted) return;
      if (value.workspaceId !== workspaceId || (value.entry.providerId !== ref.providerId || value.entry.modelId !== ref.modelId || value.entry.recordId !== ref.recordId) || value.mode !== "saved-page") throw new Error("Saved Content context belongs to a different owner.");
      context.value = value;
    } catch (cause) { if (request === sequence && !scope.abortSignal.aborted) error.value = cause instanceof Error ? cause.message : "Saved Content context unavailable."; }
    finally { if (request === sequence && !scope.abortSignal.aborted) busy.value = false; }
  };
  const ownerKey = computed(() => JSON.stringify([entry.value.modelId, entry.value.id]));
  let loadedOwner: string | null = null;
  scope.onCleanup(() => { sequence++; });
  scope.effect(() => {
    const key = ownerKey.value;
    if (key === loadedOwner) return;
    loadedOwner = key;
    void refresh();
  });
  scope.onActivate(() => {
    const invalidate = () => { clear(); error.value = "Saved workspace changed. Refresh affected pages."; };
    window.addEventListener("native-authoring-invalidated", invalidate); window.addEventListener("native-authoring-stale", invalidate); window.addEventListener("native-authoring-disconnected", invalidate);
    const stop = integration?.subscribeChanges((channel) => { if (channel !== "sessions") invalidate(); });
    return () => { stop?.(); window.removeEventListener("native-authoring-invalidated", invalidate); window.removeEventListener("native-authoring-stale", invalidate); window.removeEventListener("native-authoring-disconnected", invalidate); };
  });
  const choose = async (index: string) => {
    document.value = null; current.value = false; acknowledged = null; const request = ++sequence;
    const captured = context.value;
    const use = captured?.uses[Number(index)]; if (!captured || index === "" || !use || !workspaceId) return;
    busy.value = true; error.value = null; invalid = false;
    try {
      const value = await nativeContentRead<HostContentDocument>("content-document-preview", { workspaceId, entry: ownerRef(), revision: captured.revision, sitemapProviderId: use.sitemapProviderId, sitemapId: use.sitemapId, pageId: use.pageId, pathname: use.pathname });
      if (request !== sequence || scope.abortSignal.aborted) return;
      if (value.identity.workspaceId !== workspaceId || value.identity.revision !== captured.revision || value.identity.pathname !== use.pathname
        || value.identity.packId !== captured.pack.packId || value.identity.packVersion !== captured.pack.packVersion || value.identity.rendererId !== captured.renderer.id
        || value.identity.rendererVersion !== captured.renderer.version || value.identity.rendererDigest !== captured.renderer.digest
        || value.content.workspaceId !== captured.workspaceId || value.content.revision !== captured.revision
        || value.content.entry.providerId !== captured.entry.providerId || value.content.entry.modelId !== captured.entry.modelId || value.content.entry.recordId !== captured.entry.recordId
        || recordJson(value.content.record) !== recordJson(captured.record)) throw new Error("Saved preview identity differs from the selected Content context.");
      document.value = value;
    } catch (cause) { if (request === sequence && !scope.abortSignal.aborted) error.value = cause instanceof Error ? cause.message : "Saved page unavailable."; }
    finally { if (request === sequence && !scope.abortSignal.aborted) busy.value = false; }
  };
  scope.effect(() => {
    const shown = document.value;
    if (!shown) return undefined;
    const message = (event: MessageEvent) => {
      const accepted = acceptHostDocumentMessage(event, frame.current?.contentWindow ?? null, window.location.origin, shown);
      if (accepted?.type === "ready" && !invalid && matchesHostDocumentFrame(frame.current, shown, window.location.origin)) { acknowledged = frame.current?.contentDocument ?? null; current.value = true; }
      else if (accepted?.type === "navigate" || accepted?.type === "leaving") { clear(); error.value = "Saved preview left the selected use. Refresh affected pages."; }
    };
    window.addEventListener("message", message); return () => window.removeEventListener("message", message);
  });
  scope.effect(() => {
    const captured = context.value, shown = document.value;
    selection.value = captured && shown ? String(captured.uses.findIndex((use) => use.pathname === shown.identity.pathname)) : "";
  });
  const excluded = computed(() => {
    const captured = context.value;
    return ["dirty", "saving", "error"].includes(saveStatus.value) || !captured || recordJson(captured.record) !== recordJson(entry.value);
  });
  const hasError = computed(() => error.value !== null);
  const status = computed(() => (busy.value ? "Reading saved Content…" : current.value ? "Saved snapshot rendered" : document.value ? "Waiting for the exact saved document…" : "Choose a captured affected page."));
  return <section aria-label="Saved affected-page preview" class="sg-content-inspector__pad sg-content-host-preview">
    <h3 class="sg-content-host-preview__heading">Saved page preview</h3>
    <p class="sg-content-note">Saved authoring workspace only. This is not the activated release or a preview of unsaved input.</p>
    <Show when={excluded}>{() => <p class="sg-content-note" role="note">Unsaved or newer Content changes are not included. Refresh after saving to inspect the saved state.</p>}</Show>
    <p class="sg-content-note">Unsaved Content drafts and standalone Mapping fragments are unsupported by this host renderer.</p>
    <Button disabled={busy} on:click={() => void refresh()}>Refresh affected pages</Button>
    <Show when={hasError}>{() => <p class="sg-content-note" role="alert">{computed(() => error.value ?? "")}</p>}</Show>
    <p class="sg-content-note" role="status">{status}</p>
    <Rebuild value={context}>{(captured) => captured ? <>
      <p class="sg-content-note">{captured.entry.providerId} / {captured.entry.modelId} / {captured.entry.recordId}</p>
      <p class="sg-content-note">Compiled bound uses only. Host-only metadata dependencies are not inferred.</p>
      {!captured.uses.length ? <p class="sg-content-note">No saved page has a proven compiled binding to this entry.</p> : <Field label="Saved affected page" class="sg-content-host-preview__field">{(field: FieldControl) => <Select field={field} size="sm" class="sg-content-host-preview__select" aria-label="Saved affected page" disabled={busy} modelValue={selection} on:change={(event: Event) => void choose((event.currentTarget as HTMLSelectElement).value)}>
        <option value="">Choose a saved affected page</option>{captured.uses.map((use, index) => <option value={String(index)}>{`${use.title} · ${use.pathname} · ${use.sitemapProviderId}/${use.sitemapId}/${use.pageId}`}</option>)}
      </Select>}</Field>}
      <Rebuild value={document}>{(shown) => shown ? <><ul class="sg-content-diagnostics" aria-label="Saved Content affected targets">{(captured.uses.find((use) => use.pathname === shown.identity.pathname)?.targets ?? []).map((use) => <li>{use.fieldLabel} → {use.target.providerId}/{use.target.recordId}/{use.target.nodeId}.{use.prop}</li>)}</ul><p class="sg-content-note">Captured revision: <code>{shown.identity.revision}</code></p><iframe class="sg-content-host-preview-frame" ref={frame} title="Saved Content affected page" sandbox="allow-scripts allow-same-origin" src={shown.documentUrl} on:load={() => {
        if (acknowledged !== frame.current?.contentDocument || !matchesHostDocumentFrame(frame.current, shown, window.location.origin)) { acknowledged = null; current.value = false; }
      }} /></> : null}</Rebuild>
    </> : null}</Rebuild>
  </section>;
}
