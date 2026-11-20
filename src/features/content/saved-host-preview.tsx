import { useEffect, useRef, useState } from "preact/hooks";
import type { ContentEntryRecord } from "../../content/model";
import type { ContentSaveStatus } from "./controller";
import type { HostContentContext, HostContentDocument } from "../../shared/host-content-preview";
import { Button, Field, Select } from "../../components/ui";
import { useWorkspace } from "../../app/workspace-context";
import { nativeContentRead } from "../native-editing/session";
import { acceptHostDocumentMessage, matchesHostDocumentFrame } from "../host-document/protocol";
import { canonicalStringifyJson } from "../../site-project/model/canonical";
import type { JsonValue } from "@zudo-composer/component-contract";
const recordJson = (entry: ContentEntryRecord) => canonicalStringifyJson(entry as unknown as JsonValue);

/** A saved route document; never an in-memory draft or a fragment renderer. */
export function SavedHostContentPreview({ providerId, entry, saveStatus }: { providerId: string; entry: ContentEntryRecord; saveStatus: ContentSaveStatus }) {
  const integration = useWorkspace()?.integration;
  const workspaceId = integration?.workspace.id;
  const [context, setContext] = useState<HostContentContext | null>(null);
  const [document, setDocument] = useState<HostContentDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [current, setCurrent] = useState(false);
  const sequence = useRef(0), invalid = useRef(false), frame = useRef<HTMLIFrameElement>(null), acknowledged = useRef<Document | null>(null);
  const ref = { providerId, modelId: entry.modelId, recordId: entry.id };
  const clear = () => { sequence.current++; invalid.current = true; acknowledged.current = null; setCurrent(false); setDocument(null); setContext(null); setBusy(false); };
  const refresh = async () => {
    clear(); if (!workspaceId) { setError("Open a native workspace to preview saved Content."); return; }
    invalid.current = false; const request = sequence.current; setBusy(true); setError(null);
    try {
      const value = await nativeContentRead<HostContentContext>("content-preview-context", { workspaceId, entry: ref });
      if (request !== sequence.current) return;
      if (value.workspaceId !== workspaceId || (value.entry.providerId !== ref.providerId || value.entry.modelId !== ref.modelId || value.entry.recordId !== ref.recordId) || value.mode !== "saved-page") throw new Error("Saved Content context belongs to a different owner.");
      setContext(value);
    } catch (cause) { if (request === sequence.current) setError(cause instanceof Error ? cause.message : "Saved Content context unavailable."); }
    finally { if (request === sequence.current) setBusy(false); }
  };
  useEffect(() => { void refresh(); return () => { sequence.current++; }; }, [workspaceId, providerId, entry.modelId, entry.id]);
  useEffect(() => {
    const invalidate = () => { clear(); setError("Saved workspace changed. Refresh affected pages."); };
    window.addEventListener("native-authoring-invalidated", invalidate); window.addEventListener("native-authoring-stale", invalidate); window.addEventListener("native-authoring-disconnected", invalidate);
    const stop = integration?.subscribeChanges(channel => { if (channel !== "sessions") invalidate(); });
    return () => { stop?.(); window.removeEventListener("native-authoring-invalidated", invalidate); window.removeEventListener("native-authoring-stale", invalidate); window.removeEventListener("native-authoring-disconnected", invalidate); };
  }, [integration]);
  const choose = async (index: string) => {
    setDocument(null); setCurrent(false); acknowledged.current = null; const request = ++sequence.current;
    const use = context?.uses[Number(index)]; if (!context || index === "" || !use || !workspaceId) return;
    setBusy(true); setError(null); invalid.current = false;
    try {
      const value = await nativeContentRead<HostContentDocument>("content-document-preview", { workspaceId, entry: ref, revision: context.revision, sitemapProviderId: use.sitemapProviderId, sitemapId: use.sitemapId, pageId: use.pageId, pathname: use.pathname });
      if (request !== sequence.current) return;
      if (value.identity.workspaceId !== workspaceId || value.identity.revision !== context.revision || value.identity.pathname !== use.pathname
        || value.identity.packId !== context.pack.packId || value.identity.packVersion !== context.pack.packVersion || value.identity.rendererId !== context.renderer.id
        || value.identity.rendererVersion !== context.renderer.version || value.identity.rendererDigest !== context.renderer.digest
        || value.content.workspaceId !== context.workspaceId || value.content.revision !== context.revision
        || value.content.entry.providerId !== context.entry.providerId || value.content.entry.modelId !== context.entry.modelId || value.content.entry.recordId !== context.entry.recordId
        || recordJson(value.content.record) !== recordJson(context.record)) throw new Error("Saved preview identity differs from the selected Content context.");
      setDocument(value);
    } catch (cause) { if (request === sequence.current) setError(cause instanceof Error ? cause.message : "Saved page unavailable."); }
    finally { if (request === sequence.current) setBusy(false); }
  };
  useEffect(() => {
    if (!document) return;
    const message = (event: MessageEvent) => {
      const accepted = acceptHostDocumentMessage(event, frame.current?.contentWindow ?? null, window.location.origin, document);
      if (accepted?.type === "ready" && !invalid.current && matchesHostDocumentFrame(frame.current, document, window.location.origin)) { acknowledged.current = frame.current?.contentDocument ?? null; setCurrent(true); }
      else if (accepted?.type === "navigate" || accepted?.type === "leaving") { clear(); setError("Saved preview left the selected use. Refresh affected pages."); }
    };
    window.addEventListener("message", message); return () => window.removeEventListener("message", message);
  }, [document]);
  const differs = !context || recordJson(context.record) !== recordJson(entry);
  const pending = ["dirty", "saving", "error"].includes(saveStatus);
  return <section aria-label="Saved affected-page preview" class="sg-content-inspector__pad sg-content-host-preview">
    <h3 class="sg-content-host-preview__heading">Saved page preview</h3>
    <p class="sg-content-note">Saved authoring workspace only. This is not the activated release or a preview of unsaved input.</p>
    {(pending || differs) && <p class="sg-content-note" role="note">Unsaved or newer Content changes are not included. Refresh after saving to inspect the saved state.</p>}
    <p class="sg-content-note">Unsaved Content drafts and standalone Mapping fragments are unsupported by this host renderer.</p>
    <Button disabled={busy} onClick={() => void refresh()}>Refresh affected pages</Button>
    {error && <p class="sg-content-note" role="alert">{error}</p>}
    <p class="sg-content-note" role="status">{busy ? "Reading saved Content…" : current ? "Saved snapshot rendered" : document ? "Waiting for the exact saved document…" : "Choose a captured affected page."}</p>
    {context && <>
      <p class="sg-content-note">{context.entry.providerId} / {context.entry.modelId} / {context.entry.recordId}</p>
      <p class="sg-content-note">Compiled bound uses only. Host-only metadata dependencies are not inferred.</p>
      {!context.uses.length ? <p class="sg-content-note">No saved page has a proven compiled binding to this entry.</p> : <Field label="Saved affected page" class="sg-content-host-preview__field"><Select size="sm" class="sg-content-host-preview__select" aria-label="Saved affected page" disabled={busy} value={document ? String(context.uses.findIndex(use => use.pathname === document.identity.pathname)) : ""} onChange={event => void choose(event.currentTarget.value)}>
        <option value="">Choose a saved affected page</option>{context.uses.map((use, index) => <option value={String(index)} key={`${use.sitemapProviderId}/${use.sitemapId}/${use.pageId}/${use.pathname}`}>{use.title} · {use.pathname} · {use.sitemapProviderId}/{use.sitemapId}/{use.pageId}</option>)}
      </Select></Field>}
      {document && <><ul class="sg-content-diagnostics" aria-label="Saved Content affected targets">{context.uses.find(use => use.pathname === document.identity.pathname)?.targets.map(use => <li key={JSON.stringify(use)}>{use.fieldLabel} → {use.target.providerId}/{use.target.recordId}/{use.target.nodeId}.{use.prop}</li>)}</ul><p class="sg-content-note">Captured revision: <code>{document.identity.revision}</code></p><iframe class="sg-content-host-preview-frame" ref={frame} title="Saved Content affected page" sandbox="allow-scripts allow-same-origin" src={document.documentUrl} onLoad={() => {
        if (acknowledged.current !== frame.current?.contentDocument || !matchesHostDocumentFrame(frame.current, document, window.location.origin)) { acknowledged.current = null; setCurrent(false); }
      }} /></>}
    </>}
  </section>;
}
