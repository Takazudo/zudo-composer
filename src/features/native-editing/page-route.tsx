import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useWorkspace } from "../../app/workspace-context";
import { formatIntent, notifyRouteSelection } from "../../app/route-intents";
import type { SitemapNode } from "../../sitemapper/model/types";
import type { NativeInspection, NativePlan, NativeReceipts } from "./types";
import { NativePageFrame } from "./page-frame";
import { nativeEditingAvailable, nativeEditRequest } from "./session";
import { exactInsertion, isCompositionEnter } from "./request";
import { subscribePersistenceChanges } from "../../shared/persistence-generation";
import "./page-route.css";

interface Pending { text: string; alt: string; assetId: string; kind: "text" | "image" | "table"; target: string; emptyAlt?: boolean; planId?: string }
const empty: Pending = { text: "", alt: "", assetId: "", kind: "text", target: "" };
const retained = (key: string): Pending => { try { const value = JSON.parse(sessionStorage.getItem(key) ?? "null"); return value && typeof value.text === "string" && ["text", "image", "table"].includes(value.kind) && typeof value.target === "string" ? { ...empty, ...value } : empty; } catch { return empty; } };

export function NativePageRoute() {
  const workspace = useWorkspace()!;
  const integration = workspace.integration;
  const [pages, setPages] = useState<{ sitemapId: string; pageId: string; name: string }[]>([]);
  const [pageKey, setPageKey] = useState("");
  const page = pages.find(value => `${value.sitemapId}/${value.pageId}` === pageKey);
  const storageKey = `zudo-native-input-v1:${integration.workspace.id}:${pageKey}`;
  const [input, setInput] = useState<Pending>(empty);
  const [inspection, setInspection] = useState<NativeInspection | null>(null);
  const [plan, setPlan] = useState<NativePlan | null>(null);
  const [receipts, setReceipts] = useState<NativeReceipts | null>(null);
  const [proposed, setProposed] = useState(false);
  const [selecting, setSelecting] = useState(true);
  const [invalidated, setInvalidated] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const busyOwner = useRef(false);
  const [images, setImages] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"page" | "edit">("page");
  const sequence = useRef(0);
  const active = useRef({ pageKey, storageKey }); active.current = { pageKey, storageKey };
  const editPanel = useRef<HTMLElement>(null);
  const save = (value: Pending) => { setInput(value); sessionStorage.setItem(storageKey, JSON.stringify(value)); };
  const refresh = () => {
    if (!page || !nativeEditingAvailable) return;
    const current = ++sequence.current;
    setInspection(null); setEvidence(false); setError(null);
    void nativeEditRequest<NativeInspection>("inspect", { workspaceId: integration.workspace.id, sitemapId: page.sitemapId, page: page.pageId }).then(value => { if (sequence.current === current) setInspection(value); }, cause => { if (sequence.current === current) setError(cause.message); });
  };
  useEffect(() => {
    let current = true;
    void integration.getCurrentSiteProject({ flushSessions: false }).then(result => {
      if (!current) return;
      if (result.status !== "ready") { setError(result.error.message); return; }
      const flatten = (nodes: SitemapNode[]): SitemapNode[] => nodes.flatMap(node => [node, ...flatten(node.children)]);
      const values = result.project.providers.sitemaps.flatMap(provider => provider.records.flatMap(record => flatten(record.document.root).map(node => ({ sitemapId: record.id, pageId: node.id, name: `${record.document.name} · ${node.title || node.id}` }))));
      setPages(values);
      const params = new URLSearchParams(window.location.search);
      const requested = `${params.get("sitemap")}/${params.get("page")}`;
      setPageKey(values.some(value => `${value.sitemapId}/${value.pageId}` === requested) ? requested : values[0] ? `${values[0].sitemapId}/${values[0].pageId}` : "");
    }).catch(cause => { if (current) setError(cause.message); });
    return () => { current = false; };
  }, [integration]);
  useEffect(() => {
    const pending = retained(storageKey); setInput(pending); setPlan(null); setReceipts(null); setProposed(false); setEvidence(false); setInvalidated(false); refresh();
    if (!pending.planId) return;
    const selectedKey = pageKey;
    void Promise.all([nativeEditRequest<NativePlan>("review", { planId: pending.planId }), nativeEditRequest<NativeReceipts>("receipt", { planId: pending.planId })]).then(([value, receipt]) => {
      if (active.current.pageKey !== selectedKey) return;
      setPlan(value); setReceipts(receipt); setProposed(!receipt.applied);
    }, cause => { if (active.current.pageKey === selectedKey) setError(cause.message); });
  }, [pageKey, storageKey]);
  const run = async (action: () => Promise<void>) => {
    if (busyOwner.current) return; busyOwner.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setEvidence(false); setError(cause instanceof Error ? cause.message : "Operation unavailable. Recover the retained receipt before retrying."); }
    finally { busyOwner.current = false; setBusy(false); }
  };
  useEffect(() => {
    let current = true;
    void integration.assetProvider?.store?.list().then(values => { if (current) setImages(values.filter(value => value.state === "active" && value.mimeType.startsWith("image/")).map(value => ({ id: value.id, name: value.fileName }))); }).catch(() => {});
    return () => { current = false; };
  }, [integration]);
  useEffect(() => { if (tab === "edit") editPanel.current?.focus(); }, [tab]);
  useEffect(() => {
    const invalidate = () => { setInvalidated(true); setEvidence(false); setError("Draft or dependencies changed. Inspect the page and review again. Source changes require restarting the server."); };
    window.addEventListener("native-authoring-invalidated", invalidate);
    const unsubscribe = subscribePersistenceChanges(invalidate);
    return () => { window.removeEventListener("native-authoring-invalidated", invalidate); unsubscribe(); };
  }, []);
  const samePage = !!plan && !!inspection && JSON.stringify(plan.identity) === JSON.stringify(inspection.identity);
  const snapshot = useMemo(() => {
    if (!inspection) return null;
    const record = samePage && plan && !receipts?.applied ? proposed ? plan.candidate : plan.before : inspection.record;
    return { document: record.document, localRecordId: record.id, ...(samePage && plan?.linked ? { linked: plan.linked } : inspection.linked ? { linked: inspection.linked } : {}) };
  }, [inspection, plan, proposed, receipts, samePage]);
  const review = useMemo(() => samePage && proposed && plan && !receipts?.applied && !invalidated ? { planId: plan.id, digest: plan.digest, identity: plan.identity, dependencyDigest: plan.dependencyDigest } : undefined, [samePage, proposed, plan, receipts, invalidated]);
  if (!nativeEditingAvailable) return <main><h1>Page editing unavailable</h1><p>This requires a configured local dev server and a direct loopback authoring session. Hosted and static editors have no native writer.</p><a href="/composer">Structure</a></main>;
  return <main class="cms-native-page" data-mobile-tab={tab}>
    <header class="cms-native-header">
      <label>Page <select aria-label="Page" value={pageKey} disabled={busy} onChange={event => { const next = event.currentTarget.value; setPageKey(next); const [sitemapId, pageId] = next.split("/"); const url = formatIntent({ route: "composer", mode: "page", sitemapId, pageId }); history.replaceState(null, "", url); notifyRouteSelection("replace"); }}><option value="" disabled>Choose a page</option>{pages.map(value => <option value={`${value.sitemapId}/${value.pageId}`}>{value.name}</option>)}</select></label>
      <button type="button" aria-pressed={selecting} onClick={() => { setEvidence(false); setSelecting(!selecting); }}>{selecting ? "Select targets" : "Browse page"}</button>
      <a href={inspection ? formatIntent({ route: "composer", providerId: inspection.identity.providerId, compositionId: inspection.identity.recordId }) : "/composer"}>Structure</a>
    </header>
    <div class="cms-native-tabs" role="tablist" aria-label="Page editing view"><button type="button" role="tab" aria-selected={tab === "page"} onClick={() => setTab("page")}>Page</button><button type="button" role="tab" aria-selected={tab === "edit"} onClick={() => { setTab("edit"); editPanel.current?.focus(); }}>Edit</button></div>
    <section class="cms-native-canvas" aria-label="Rendered page">{snapshot && inspection ? <NativePageFrame provider={integration.componentProvider} snapshot={snapshot} review={review} selecting={selecting && !plan} identity={inspection.identity} draftRevision={inspection.revision}
      onSelect={nodeId => {
        if (!inspection.targets.some(target => target.nodeId === nodeId)) { setError(inspection.allTargets.find(target => target.nodeId === nodeId)?.reason ?? "This target is unsupported. Use its owning source."); return; }
        save({ ...input, target: nodeId }); setTab("edit"); editPanel.current?.focus();
      }} onEvidence={setEvidence} onError={setError} /> : <p role="status">{error ? "This page cannot be rendered for native editing." : "Opening page…"}</p>}</section>
    <aside class="cms-native-edit" ref={editPanel} tabIndex={-1} aria-label="Exact native insertion">
      <h1>Edit this page</h1><p>Supply exact content. No generation provider is connected.</p>
      {error && <p role="alert">{error}</p>}
      {inspection?.writeBlockers.map(reason => <p role="status">{reason}</p>)}
      <p class="cms-native-target" aria-label="Selected target">Target: {plan ? `${plan.identity.workspaceId}/${plan.identity.sitemapId}/${plan.identity.pageId} · ${plan.identity.providerId}/${plan.identity.recordId} · ${plan.request.after.nodeId}` : inspection && input.target ? `${inspection.identity.workspaceId}/${inspection.identity.sitemapId}/${inspection.identity.pageId} · ${inspection.identity.providerId}/${inspection.identity.recordId} · ${input.target}` : "Select a standalone native node"}</p>
      {!plan && <fieldset disabled={busy || !inspection || !!inspection.writeBlockers.length}>
        <label>Insertion <select value={input.kind} onChange={event => save({ ...input, kind: event.currentTarget.value as Pending["kind"] })}><option value="text">Exact text</option><option value="image">Managed image</option><option value="table">Supplied table</option></select></label>
        {input.kind === "image" ? <><label>Existing managed image <select value={input.assetId} onChange={event => save({ ...input, assetId: event.currentTarget.value })}><option value="">Choose a managed image</option>{images.map(image => <option value={image.id}>{image.name}</option>)}</select></label><label>Alternative text (empty is intentional) <textarea disabled={input.emptyAlt} value={input.alt} onInput={event => save({ ...input, alt: event.currentTarget.value })} /></label><label><input type="checkbox" checked={input.emptyAlt ?? false} onChange={event => save({ ...input, emptyAlt: event.currentTarget.checked })} />Intentionally empty alternative text</label></> : <label>{input.kind === "text" ? "Exact text" : "Table JSON: columns and rows"}<textarea value={input.text} onKeyDown={event => { if (isCompositionEnter(event)) event.stopPropagation(); }} onInput={event => save({ ...input, text: event.currentTarget.value })} /></label>}
        <button type="button" disabled={!input.target || busy || (input.kind === "image" && (!input.assetId || (!input.emptyAlt && !input.alt)))} onClick={() => void run(async () => {
          const owner = active.current.pageKey;
          const value = await nativeEditRequest<NativePlan>("plan", { workspaceId: inspection!.identity.workspaceId, sitemapId: inspection!.identity.sitemapId, page: inspection!.identity.pageId, after: { nodeId: input.target }, insert: exactInsertion(input.kind, input.text, input.assetId, input.emptyAlt ? "" : input.alt) }, false, { identity: inspection!.identity, revision: inspection!.revision });
          const pending = { ...input, planId: value.id }; sessionStorage.setItem(storageKey, JSON.stringify(pending));
          if (active.current.pageKey !== owner) return;
          setInput(pending); setPlan(value); setInvalidated(false); setProposed(true); setTab("page");
        })}>Review insertion</button>
      </fieldset>}
      {plan && !receipts?.applied && <section class="cms-native-review" aria-label="Review insertion"><h2>Review exact insertion</h2>{!samePage && <button type="button" onClick={() => setPageKey(`${plan.identity.sitemapId}/${plan.identity.pageId}`)}>Return to plan page</button>}<p>{plan.identity.pageId} · {plan.id}</p><div><button type="button" aria-pressed={!proposed} onClick={() => { setEvidence(false); setProposed(false); }}>Original</button><button type="button" aria-pressed={proposed} onClick={() => { setEvidence(false); setProposed(true); }}>Proposed</button></div><p role="status">{evidence ? "Exact Proposed render confirmed. Ready for explicit approval." : "Apply waits for this exact Proposed candidate to render successfully."}</p>
        <button type="button" disabled={busy || invalidated || !evidence || !proposed || !samePage} onClick={() => void run(async () => {
          // Resolve durable state first on every retry of a possibly lost response.
          const recovered = await nativeEditRequest<NativeReceipts>("receipt", { planId: plan.id });
          if (recovered.applied) { setReceipts(recovered); return; }
          await nativeEditRequest("apply", { planId: plan.id, approve: plan.digest }, true);
          setReceipts(await nativeEditRequest<NativeReceipts>("receipt", { planId: plan.id })); refresh();
        })}>Apply to draft</button>
        <button type="button" disabled={busy} onClick={() => void run(async () => { await nativeEditRequest("discard", { planId: plan.id }); save({ ...input, planId: undefined }); setPlan(null); setProposed(false); refresh(); })}>Discard</button>
        <button type="button" disabled={busy} onClick={() => void run(async () => { setReceipts(await nativeEditRequest<NativeReceipts>("receipt", { planId: plan.id })); })}>Recover receipt</button>
      </section>}
      {receipts?.applied && plan && <section class="cms-native-review" aria-label="Durable receipt"><h2>{receipts.undone ? "Undo committed" : "Applied to draft"}</h2><p role="status">Durable receipt: {receipts.undone?.operationId ?? receipts.applied.operationId}</p><p>{receipts.undone?.committedAt ?? receipts.applied.committedAt}</p>
        <button type="button" disabled={busy || !!receipts.undone} onClick={() => void run(async () => { await nativeEditRequest("undo", { planId: plan.id, approve: plan.digest }, true); setReceipts(await nativeEditRequest<NativeReceipts>("receipt", { planId: plan.id })); refresh(); })}>Guarded Undo</button>
        <button type="button" disabled={busy} onClick={() => { save({ ...empty }); setPlan(null); setReceipts(null); refresh(); }}>New insertion</button>
      </section>}
      <button type="button" disabled={busy} onClick={refresh}>Inspect current page</button>
    </aside>
  </main>;
}
