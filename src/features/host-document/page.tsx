import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useWorkspace } from "../../app/workspace-context";
import { formatIntent } from "../../app/route-intents";
import { nativeEditRequest } from "../native-editing/session";
import type { HostDocumentPreview, HostDocumentTarget } from "../../../server/host-document/types";
import { acceptHostDocumentMessage, confirmedFirstAttemptRefusal, matchesHostDocumentFrame } from "./protocol";
import { createHostEditRecovery, type PendingHostEdit } from "./recovery";
import { HostComponentTree, componentTitle } from "./component-tree";
import "./page.css";

type Preview = HostDocumentPreview & { documentUrl: string; routes: { pathname: string; title: string; pageId: string }[] };
export function HostDocumentPage() {
  const integration = useWorkspace()!.integration;
  const titles = useMemo(() => new Map((integration.componentProvider?.manifest.components ?? []).map(component => [component.id, component.title])), [integration]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<HostDocumentTarget | null>(null);
  const [fieldValue, setFieldValue] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const recovery = useMemo(() => { try { return { store: createHostEditRecovery(localStorage, sessionStorage, window.location.origin), error: null }; } catch (cause) { return { store: null, error: cause instanceof Error ? cause.message : "Durable recovery storage is unavailable." }; } }, [integration]);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [pending, setPending] = useState<PendingHostEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(false);
  const [selecting, setSelecting] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);
  const sequence = useRef(0);
  const readyDocument = useRef<Document | null>(null);
  const invalidated = useRef(false);
  const readPending = (identity: HostDocumentPreview["identity"]) => {
    try { setPending(recovery.store?.list(identity)[0] ?? null); setRecoveryBlocked(false); }
    catch (cause) { setRecoveryBlocked(true); setError(cause instanceof Error ? cause.message : "Recovery storage cannot be read. Saving is disabled."); }
  };
  const rememberVisitorUrl = (value: string) => { const editorUrl = new URL(window.location.href); editorUrl.searchParams.set("visitor", value); window.history.replaceState(window.history.state, "", editorUrl); };
  const refresh = async (visitorUrl?: string) => {
    visitorUrl ??= new URLSearchParams(window.location.search).get("visitor") ?? undefined;
    const pathname = visitorUrl ? new URL(visitorUrl, window.location.origin).pathname : undefined;
    const request = ++sequence.current;
    invalidated.current = false; readyDocument.current = null;
    setLoading(true); setCurrent(false); setError(null); setPreview(null); setSelected(null);
    try {
      const value = await nativeEditRequest<Preview>("document-preview", { workspaceId: integration.workspace.id, ...(pathname ? { pathname, visitorUrl } : new URLSearchParams(window.location.search).get("page") ? { pageId: new URLSearchParams(window.location.search).get("page") } : {}) });
      if (request === sequence.current) { setPreview(value); readPending(value.identity); if (value.navigation) rememberVisitorUrl(value.navigation.url); }
    } catch (cause) { if (request === sequence.current) setError(cause instanceof Error ? cause.message : "Page preview unavailable."); }
    finally { if (request === sequence.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); return () => { sequence.current++; }; }, [integration]);
  useEffect(() => {
    if (!preview) return;
    const onMessage = (event: MessageEvent) => {
      const message = acceptHostDocumentMessage(event, frame.current?.contentWindow ?? null, window.location.origin, preview);
      if (message?.type === "ready" && !invalidated.current && matchesHostDocumentFrame(frame.current, preview, window.location.origin)) { readyDocument.current = frame.current?.contentDocument ?? null; setCurrent(true); }
      if (message?.type === "select" && !invalidated.current && matchesHostDocumentFrame(frame.current, preview, window.location.origin)) setSelected(message.target);
      if (message?.type === "leaving") { invalidated.current = true; setCurrent(false); setSelected(null); setError("Preview left the captured page. Refresh the saved page before editing."); }
      if (message?.type === "navigate") {
        if (message.url.split("#")[0] === preview.navigation?.url.split("#")[0]) { rememberVisitorUrl(message.url); setPreview(previous => previous && previous.navigation ? { ...previous, navigation: { ...previous.navigation, url: message.url } } : previous); }
        else { invalidated.current = true; setCurrent(false); setSelected(null); void refresh(message.url); }
      }
    };
    const invalidate = () => { invalidated.current = true; setCurrent(false); setError("Workspace changed. Refresh the saved page before editing its selected owner."); };
    window.addEventListener("message", onMessage);
    window.addEventListener("native-authoring-invalidated", invalidate);
    const stop = integration.subscribeChanges(invalidate);
    return () => { window.removeEventListener("message", onMessage); window.removeEventListener("native-authoring-invalidated", invalidate); stop(); };
  }, [preview, integration]);
  useEffect(() => {
    if (!preview || !current) return;
    const send = (value: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ protocol: "zudo-host-document-v1", frameId: preview.frameId, ...value }, window.location.origin);
    send({ type: "mode", selecting });
    send({ type: "highlight", renderedNodeId: selected?.renderedNodeId ?? null });
  }, [preview, selected, selecting, current]);
  useEffect(() => {
    if (!preview || !recovery.store) return;
    const changed = () => readPending(preview.identity);
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [preview, recovery.store]);
  const submit = async (retained: PendingHostEdit, recovering = true) => {
    if (busy || !recovery.store) return;
    const request = retained.request;
    if (retained.identity.workspaceId !== integration.workspace.id || !preview || retained.identity.packId !== preview.identity.packId || retained.identity.rendererId !== preview.identity.rendererId) { setError("This retained operation belongs to a different authoring workspace or renderer. Open its original workspace to recover it."); return; }
    setBusy(true); setError(null);
    try {
      const receipt = await nativeEditRequest("document-edit", request, true);
      recovery.store.complete(retained, receipt); setPending(null);
      await refresh(preview.navigation?.url ?? String(request.pathname));
    } catch (cause) {
      const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
      const refused = confirmedFirstAttemptRefusal(recovering, code);
      if (refused) { recovery.store.complete(retained); setPending(null); }
      setError(`${cause instanceof Error ? cause.message : "Response unavailable."}${refused ? " No change was accepted." : " The original outcome remains uncertain. The exact operation is retained; recover it before another edit."}`);
    }
    finally { setBusy(false); }
  };
  const apply = async (change: unknown) => {
    if (!preview || !selected || !current || busy || pending || recoveryBlocked || !recovery.store) return;
    if (!matchesHostDocumentFrame(frame.current, preview, window.location.origin, true)) { invalidated.current = true; setCurrent(false); setSelected(null); setError("Preview URL changed. Refresh the saved page before editing."); return; }
    const { renderedNodeId, providerId, recordId, nodeId } = selected;
    const request = { workspaceId: preview.identity.workspaceId, revision: preview.identity.revision, pathname: preview.identity.pathname, operationId: crypto.randomUUID(), target: { renderedNodeId, providerId, recordId, nodeId }, change };
    try { const retained = recovery.store.save(preview.identity, request); setPending(retained); await submit(retained, false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Durable recovery storage failed. Nothing was sent."); }
  };
  useEffect(() => { setFieldName(""); setFieldValue(""); }, [selected?.renderedNodeId]);
  return <main class="cms-host-document">
    <header><h1>Page authoring</h1><label>Page <select disabled={!preview} value={preview?.identity.pathname ?? ""} onChange={event => void refresh(event.currentTarget.value)}>{preview?.routes.map(route => <option key={route.pathname} value={route.pathname}>{route.title} · {route.pathname}</option>)}</select></label><button type="button" onClick={() => void refresh(preview?.navigation?.url ?? preview?.identity.pathname)}>Refresh saved page</button><button type="button" aria-pressed={selecting} onClick={() => setSelecting(!selecting)}>{selecting ? "Select components" : "Browse page"}</button><p role="status">{loading ? "Opening saved page…" : current ? "Saved snapshot rendered" : "Preview not current"}</p>{error && <p role="alert">{error}</p>}{recovery.error && <p role="alert">{recovery.error} Saving is disabled.</p>}{pending && <button type="button" disabled={busy} onClick={() => void submit(pending)}>Recover pending save ({pending.request.pathname}{pending.sessionId !== recovery.store?.sessionId ? ", previous session" : ""})</button>}</header>
    <nav aria-label="Page component tree"><h2>Components</h2>{preview && <HostComponentTree targets={preview.targets} titles={titles} selectedId={selected?.renderedNodeId} disabled={!current} onSelect={setSelected} />}</nav>
    <section aria-label="Rendered page">{preview && <iframe ref={frame} title="Host rendered page" sandbox="allow-scripts allow-same-origin" src={preview.documentUrl} onLoad={() => { setCurrent(!invalidated.current && readyDocument.current !== null && readyDocument.current === frame.current?.contentDocument && matchesHostDocumentFrame(frame.current, preview, window.location.origin)); if (!matchesHostDocumentFrame(frame.current, preview, window.location.origin)) { invalidated.current = true; setSelected(null); setError("Preview navigation was not captured. Refresh the saved page before editing."); } }} />}</section>
    <aside aria-label="Selected component inspector"><h2>Inspector</h2>{selected ? <><h3>{componentTitle(selected, titles)}</h3><details><summary>Component and owner</summary><p>Component: <code>{selected.componentId}</code></p><p>Owner: <code>{selected.providerId}/{selected.recordId}/{selected.nodeId}</code></p></details><dl>{Object.entries(selected.props).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}</dl>{current && <fieldset disabled={busy || !!pending || recoveryBlocked || !recovery.store}><legend>Local component properties</legend><label>Property <select value={fieldName} onChange={event => { const prop = event.currentTarget.value; setFieldName(prop); setFieldValue(typeof selected.props[prop] === "string" ? selected.props[prop] as string : JSON.stringify(selected.props[prop])); }}><option value="">Choose property</option>{Object.keys(selected.props).map(prop => <option key={prop} value={prop}>{prop}</option>)}</select></label><label>Value {typeof selected.props[fieldName] === "number" ? <input type="number" value={fieldValue} onInput={event => setFieldValue(event.currentTarget.value)} /> : typeof selected.props[fieldName] === "boolean" ? <select value={fieldValue} onChange={event => setFieldValue(event.currentTarget.value)}><option value="true">Yes</option><option value="false">No</option></select> : <textarea value={fieldValue} onInput={event => setFieldValue(event.currentTarget.value)} />}</label><button type="button" disabled={!fieldName} onClick={() => { try { void apply({ kind: "field", prop: fieldName, value: typeof selected.props[fieldName] === "string" ? fieldValue : JSON.parse(fieldValue) }); } catch { setError("Enter a valid JSON value."); } }}>Save property</button><button type="button" onClick={() => void apply({ kind: "reorder", direction: "up" })}>Move up</button><button type="button" onClick={() => void apply({ kind: "reorder", direction: "down" })}>Move down</button>{selected.placement && <><p>Page placement: <code>{selected.placement.recordId}/{selected.placement.nodeId}</code> (moves the complete local placeholder)</p><button type="button" onClick={() => void apply({ kind: "reorder-placement", direction: "up" })}>Move page placement up</button><button type="button" onClick={() => void apply({ kind: "reorder-placement", direction: "down" })}>Move page placement down</button></>}<p>Shared bound fields and linked template structure are refused here; use their owning source.</p></fieldset>}{current && <a href={formatIntent({ route: "composer", providerId: selected.providerId, compositionId: selected.recordId })}>Edit owning composition</a>}{selected.entries.length > 0 && <><h3>Shared Content sources</h3>{selected.entries.map(entry => <p key={`${entry.providerId}/${entry.recordId}`}><a href={formatIntent({ route: "content", providerId: entry.providerId, modelId: entry.modelId, entryId: entry.recordId })}>{entry.modelId}/{entry.recordId}</a></p>)}<p>Bound values belong to these shared records. Editing them affects every live use.</p></>}</> : <p>Select a component in the page or tree.</p>}</aside>
  </main>;
}
