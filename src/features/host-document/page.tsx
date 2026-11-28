import { batch, computed, For, getScope, Show, signal, type Ref } from "@takazudo/zfb/zudo-react";
import type { RouteServicesProps } from "../../app/services";
import { formatIntent } from "../../app/route-intents";
import { holdPageLoadingWhile } from "../../app/page-loading/page-loading";
import { Keyed } from "../../runtime";
import { Rebuild } from "../../components/rebuild";
import { holdNativeAuthoringReload, nativeEditRequest } from "../native-editing/session";
import { LiveSelect, watch, when } from "../native-editing/live";
import type { HostDocumentPreview, HostDocumentTarget } from "../../../server/host-document/types";
import { acceptHostDocumentMessage, confirmedFirstAttemptRefusal, matchesHostDocumentFrame } from "./protocol";
import { assertHostEditReceipt } from "./receipt";
import { createHostEditRecovery, type PendingHostEdit } from "./recovery";
import { HostComponentTree, componentTitle } from "./component-tree";
import { HostInspector } from "./inspector";
import type { WorkspaceSaveRegistry } from "../../app/workspace-sessions";
import { writeHostSelection } from "../assistant/host-selection";
import "./page.css";

const refusalNotice = "The saved workspace changed before this page edit was accepted. Review the saved page before making a new edit.";
const setRefusalNotice = (workspaceId: string | null) => window.history.replaceState({ ...window.history.state, hostDocumentRefusal: workspaceId }, "");
const targetKey = (target: HostDocumentTarget) => `${target.providerId}/${target.recordId}/${target.nodeId}/${target.renderedNodeId}`;

type Preview = HostDocumentPreview & { editAuthority?: string; documentUrl: string; routes: { pathname: string; title: string; pageId: string }[] };
export function HostDocumentPage({ services }: RouteServicesProps) {
  const scope = getScope();
  const alive = () => !scope.abortSignal.aborted;
  const integration = services.workspace.integration;
  const titles = new Map((integration.componentProvider?.manifest.components ?? []).map(component => [component.id, component.title]));
  const preview = signal<Preview | null>(null);
  const selected = signal<HostDocumentTarget | null>(null);
  let dirty = false;
  let explicitSave = false;
  let submittedOperation: string | null = null;
  let registration: ReturnType<WorkspaceSaveRegistry["register"]> | null = null;
  scope.onActivate(() => {
    const handle = integration.sessions.register({ feature: "Host component draft", providerId: "files", workspaceId: integration.workspace.id }, { flush: async () => {
      if (dirty && !explicitSave) throw new Error("Save or discard the local component draft before continuing.");
    } });
    registration = handle;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty && !explicitSave) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("beforeunload", beforeUnload); handle.detach(); registration = null; };
  });
  const markDirty = (value: boolean) => {
    const wasDirty = dirty;
    dirty = value;
    if (value) registration?.changed();
    else if (wasDirty) return registration?.retry();
  };
  const loading = signal(true);
  const busy = signal(false);
  const recovery = (() => { try { return { store: createHostEditRecovery(localStorage, sessionStorage, window.location.origin), error: null }; } catch (cause) { return { store: null, error: cause instanceof Error ? cause.message : "Durable recovery storage is unavailable." }; } })();
  const recoveryBlocked = signal(false);
  const pending = signal<PendingHostEdit | null>(null);
  const error = signal<string | null>(null);
  const refusal = signal(window.history.state?.hostDocumentRefusal === integration.workspace.id);
  const current = signal(false);
  const selecting = signal(true);
  const frame: Ref<HTMLIFrameElement> = { current: null };
  let sequence = 0;
  let readyDocument: Document | null = null;
  let invalidated = false;
  const readPending = (identity: HostDocumentPreview["identity"]) => {
    try { batch(() => { pending.value = recovery.store?.list(identity)[0] ?? null; recoveryBlocked.value = false; }); }
    catch (cause) { batch(() => { recoveryBlocked.value = true; error.value = cause instanceof Error ? cause.message : "Recovery storage cannot be read. Saving is disabled."; }); }
  };
  const rememberVisitorUrl = (value: string) => { const editorUrl = new URL(window.location.href); editorUrl.searchParams.set("visitor", value); window.history.replaceState(window.history.state, "", editorUrl); };
  const chooseTarget = (target: HostDocumentTarget) => {
    if (dirty && selected.value?.renderedNodeId !== target.renderedNodeId) { error.value = "Save or discard the local field draft before changing selection."; return; }
    selected.value = target;
  };
  const refresh = async (visitorUrl?: string) => {
    if (dirty) { error.value = "Save or discard the local field draft before changing or refreshing the page."; return; }
    const initialHandoff = visitorUrl === undefined;
    if (!initialHandoff) { const url = new URL(window.location.href); for (const key of ["sitemapProvider", "sitemap", "page"]) url.searchParams.delete(key); window.history.replaceState(window.history.state, "", url); }
    const params = new URLSearchParams(window.location.search);
    const handoff = initialHandoff ? { ...(params.get("sitemapProvider") ? { sitemapProviderId: params.get("sitemapProvider") } : {}), ...(params.get("sitemap") ? { sitemapId: params.get("sitemap") } : {}), ...(params.get("page") ? { pageId: params.get("page") } : {}) } : {};
    visitorUrl ??= new URLSearchParams(window.location.search).get("visitor") ?? undefined;
    const pathname = visitorUrl ? new URL(visitorUrl, window.location.origin).pathname : undefined;
    const request = ++sequence;
    invalidated = false; readyDocument = null;
    batch(() => { loading.value = true; current.value = false; error.value = null; preview.value = null; selected.value = null; });
    try {
      const value = await nativeEditRequest<Preview>("document-preview", { workspaceId: integration.workspace.id, ...handoff, ...(pathname ? { pathname, visitorUrl } : {}) });
      if (request === sequence && alive()) { preview.value = value; readPending(value.identity); if (value.navigation) rememberVisitorUrl(value.navigation.url); }
    } catch (cause) { if (request === sequence && alive()) error.value = cause instanceof Error ? cause.message : "Page preview unavailable."; }
    finally { if (request === sequence && alive()) loading.value = false; }
  };
  scope.onActivate(() => { void refresh(); return () => { sequence++; }; });
  holdPageLoadingWhile(scope, services.pageLoading, loading);
  scope.onActivate(() => {
    const onMessage = (event: MessageEvent) => {
      const shown = preview.value;
      if (!shown) return;
      const message = acceptHostDocumentMessage(event, frame.current?.contentWindow ?? null, window.location.origin, shown);
      if (message?.type === "ready" && !invalidated && matchesHostDocumentFrame(frame.current, shown, window.location.origin)) { readyDocument = frame.current?.contentDocument ?? null; current.value = true; }
      if (message?.type === "select" && !invalidated && matchesHostDocumentFrame(frame.current, shown, window.location.origin)) chooseTarget(message.target);
      if (message?.type === "leaving") { invalidated = true; batch(() => { current.value = false; if (!dirty) selected.value = null; error.value = "Preview left the captured page. Refresh the saved page before editing."; }); }
      if (message?.type === "navigate") {
        if (message.url.split("#")[0] === shown.navigation?.url.split("#")[0]) { rememberVisitorUrl(message.url); if (shown.navigation) preview.value = { ...shown, navigation: { ...shown.navigation, url: message.url } }; }
        else { void refresh(message.url); }
      }
    };
    const invalidate = () => { if (!preview.value) return; invalidated = true; batch(() => { current.value = false; error.value = "Workspace changed. Refresh the saved page before editing its selected owner."; }); };
    window.addEventListener("message", onMessage);
    window.addEventListener("native-authoring-invalidated", invalidate);
    // Session generation tracks unsaved input, not a change to the captured
    // canonical snapshot. Its flush guard still blocks unrelated operations;
    // invalidating here would disable the draft's own explicit Save action.
    const stop = integration.subscribeChanges(channel => { if (channel !== "sessions") invalidate(); });
    const changed = () => { const shown = preview.value; if (shown && recovery.store) readPending(shown.identity); };
    window.addEventListener("storage", changed);
    return () => { window.removeEventListener("message", onMessage); window.removeEventListener("native-authoring-invalidated", invalidate); window.removeEventListener("storage", changed); stop(); };
  });
  watch(scope, () => [preview.value, selected.value, selecting.value, current.value] as const, ([shown, target, mode, rendered]) => {
    if (!shown || !rendered) return;
    const send = (value: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ protocol: "zudo-host-document-v1", frameId: shown.frameId, ...value }, window.location.origin);
    send({ type: "mode", selecting: mode });
    send({ type: "highlight", renderedNodeId: target?.renderedNodeId ?? null });
  });
  const submit = async (retained: PendingHostEdit, recovering = true) => {
    const shown = preview.value;
    if (busy.value || !recovery.store) return;
    const request = retained.request;
    if (dirty && recovering && submittedOperation !== request.operationId) { error.value = "Save or discard this local draft before recovering a different retained operation."; return; }
    if (retained.identity.workspaceId !== integration.workspace.id || !shown || retained.identity.packId !== shown.identity.packId || retained.identity.rendererId !== shown.identity.rendererId) { error.value = "This retained operation belongs to a different authoring workspace or renderer. Open its original workspace to recover it."; return; }
    explicitSave = true;
    batch(() => { busy.value = true; error.value = null; });
    const releaseReload = holdNativeAuthoringReload();
    let refreshAfterSave = false;
    try {
      let receipt: unknown;
      let accepted = false;
      let definitiveStale = false;
      try {
        receipt = await nativeEditRequest("document-edit", request, true);
        accepted = true;
      } catch (cause) {
        const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
        definitiveStale = code === "document-edit-not-accepted";
        if (definitiveStale) receipt = cause && typeof cause === "object" && "receipt" in cause ? cause.receipt : undefined;
        else {
          const refused = confirmedFirstAttemptRefusal(recovering, code);
          error.value = `${cause instanceof Error ? cause.message : "Response unavailable."}${refused ? " No change was accepted." : " The original outcome remains uncertain. The exact operation is retained; finish saving in other tabs, then recover it before another edit."}`;
          if (!refused) return;
        }
      }
      if (accepted || definitiveStale) await assertHostEditReceipt(request, receipt, definitiveStale);
      recovery.store.complete(retained, receipt);
      readPending(shown.identity);
      if (accepted) {
        await markDirty(false);
        refreshAfterSave = true;
      } else if (definitiveStale) {
        invalidated = true;
        batch(() => { current.value = false; refusal.value = true; });
        setRefusalNotice(integration.workspace.id);
      }
    } catch {
      readPending(shown.identity);
      error.value = "The browser could not record the page edit result. Preserve its recovery data and reopen the saved page to check its status.";
    } finally {
      explicitSave = false;
      if (dirty) registration?.changed();
      busy.value = false;
      if (!releaseReload() && refreshAfterSave && alive()) await refresh(shown.navigation?.url ?? String(request.pathname));
    }
  };
  const apply = async (change: unknown) => {
    const shown = preview.value, target = selected.value;
    if (!shown?.editAuthority || !target || !current.value || busy.value || pending.value || recoveryBlocked.value || !recovery.store) return;
    if (!matchesHostDocumentFrame(frame.current, shown, window.location.origin, true)) { invalidated = true; batch(() => { current.value = false; if (!dirty) selected.value = null; error.value = "Preview URL changed. Refresh the saved page before editing."; }); return; }
    if (refusal.value) { refusal.value = false; setRefusalNotice(null); }
    const { renderedNodeId, providerId, recordId, nodeId } = target;
    const request = { workspaceId: shown.identity.workspaceId, authority: shown.editAuthority, revision: shown.identity.revision, pathname: shown.identity.pathname, operationId: crypto.randomUUID(), target: { renderedNodeId, providerId, recordId, nodeId }, change };
    let retained: PendingHostEdit;
    try { retained = recovery.store.save(shown.identity, request); }
    catch (cause) { error.value = cause instanceof Error ? cause.message : "Durable recovery storage failed. Nothing was sent."; return; }
    pending.value = retained; submittedOperation = request.operationId;
    await submit(retained, false);
  };
  const hasPreview = when(() => preview.value);
  const routeOptions = computed(() => preview.value?.routes.map(route => ({ value: route.pathname, label: `${route.title} · ${route.pathname}` })) ?? []);
  const statusText = computed(() => loading.value ? "Opening saved page…" : current.value ? "Saved snapshot rendered" : "Preview not current");
  const editLocked = computed(() => !current.value || busy.value || !!pending.value || recoveryBlocked.value || !recovery.store || !preview.value?.editAuthority);
  const selection = computed(() => selected.value ? [selected.value] : []);
  return <main class="cms-host-document">
    <header><h1>Page authoring</h1><label>Page <LiveSelect class="cms-select" disabled={computed(() => !preview.value)} options={routeOptions} value={computed(() => preview.value?.identity.pathname ?? "")} onChange={value => void refresh(value)} /></label><button class="cms-btn" type="button" on:click={() => void refresh(preview.value?.navigation?.url ?? preview.value?.identity.pathname)}>Refresh saved page</button><button class="cms-btn" type="button" aria-pressed={selecting} on:click={() => { selecting.value = !selecting.value; }}>{computed(() => selecting.value ? "Select components" : "Browse page")}</button><p role="status">{statusText}</p><Show when={refusal}>{() => <p aria-live="polite">{refusalNotice}</p>}</Show><Show when={when(() => error.value)}>{() => <p role="alert">{computed(() => error.value ?? "")}</p>}</Show>{recovery.error && <p role="alert">{recovery.error} Saving is disabled.</p>}<Show when={when(() => preview.value && !preview.value.editAuthority)}>{() => <p>Saved store identity is unavailable. New page edits are disabled.</p>}</Show><Rebuild value={pending}>{retained => retained && <button class="cms-btn" type="button" disabled={busy} on:click={() => void submit(retained)}>Recover pending save ({retained.request.pathname}{retained.sessionId !== recovery.store?.sessionId ? ", previous session" : ""})</button>}</Rebuild></header>
    <nav aria-label="Page component tree"><h2>Components</h2><Rebuild value={computed(() => preview.value?.targets ?? null)}>{targets => targets && <HostComponentTree targets={targets} titles={titles} selectedId={computed(() => selected.value?.renderedNodeId)} disabled={computed(() => !current.value)} onSelect={chooseTarget} />}</Rebuild></nav>
    <section aria-label="Rendered page"><Show when={hasPreview}>{() => <iframe ref={frame} title="Host rendered page" sandbox="allow-scripts allow-same-origin" src={computed(() => preview.value?.documentUrl ?? null)} on:load={() => {
      const shown = preview.value;
      if (!shown) return;
      current.value = !invalidated && readyDocument !== null && readyDocument === frame.current?.contentDocument && matchesHostDocumentFrame(frame.current, shown, window.location.origin);
      if (!matchesHostDocumentFrame(frame.current, shown, window.location.origin)) { invalidated = true; batch(() => { if (!dirty) selected.value = null; error.value = "Preview navigation was not captured. Refresh the saved page before editing."; }); }
    }} />}</Show></section>
    <aside aria-label="Selected component inspector"><h2>Inspector</h2><Show when={when(() => selected.value)} fallback={() => <p>Select a component in the page or tree.</p>}>{() => <For each={selection} by={targetKey}>{item => {
      const target = item.value;
      const component = integration.componentProvider?.manifest.components.find(entry => entry.id === target.componentId);
      const assistantProp = signal("");
      return <>
        <h3>{componentTitle(target, titles)}</h3>
        <section aria-label="Assistant selection"><label>Selected property <select modelValue={assistantProp}><option value="">Component arrangement</option>{component?.fields.map(field => <option value={field.prop}>{field.label}</option>)}</select></label><a class="cms-btn" href={formatIntent({ route: "composer", mode: "assistant" })} on:click={event => {
          const shown = preview.value;
          if (!integration.workspace.id || !current.value || dirty || busy.value || pending.value || !shown || !matchesHostDocumentFrame(frame.current, shown, window.location.origin, true)) { event.preventDefault(); error.value = "Save or discard local edits and refresh the selected page before asking the Assistant."; return; }
          try { writeHostSelection(sessionStorage, integration.workspace.id, { revision: shown.identity.revision, pathname: shown.identity.pathname, target: { renderedNodeId: target.renderedNodeId, providerId: target.providerId, recordId: target.recordId, nodeId: target.nodeId }, ...(assistantProp.value ? { prop: assistantProp.value } : {}) }); } catch (cause) { event.preventDefault(); error.value = cause instanceof Error ? cause.message : "Selection handoff unavailable."; }
        }}>Ask Assistant</a></section>
        <details><summary>Component and owner</summary><p>Component: <code>{target.componentId}</code></p><p>Owner: <code>{target.providerId}/{target.recordId}/{target.nodeId}</code></p></details>
        <Keyed value={computed(() => targetKey(target))} by={key => key}>{() => <HostInspector target={target} component={component} disabled={editLocked} saving={busy} onDirty={markDirty} onSave={apply} />}</Keyed>
        {target.capabilities && <section aria-label="Arrangement owner uses"><h3>Arrangement owner uses</h3>{target.capabilities.uses.length ? <ul>{target.capabilities.uses.map(path => <li>{path}</li>)}</ul> : <p>No route uses were resolved in this capture.</p>}</section>}
        <Show when={current}>{() => <a href={formatIntent({ route: "composer", providerId: target.providerId, compositionId: target.recordId })}>Edit owning composition</a>}</Show>
        {target.entries.length > 0 && <><h3>Shared Content sources</h3>{target.entries.map(entry => <p><a href={formatIntent({ route: "content", providerId: entry.providerId, modelId: entry.modelId, entryId: entry.recordId })}>{entry.modelId}/{entry.recordId}</a></p>)}<p>Bound values belong to these shared records. Editing them affects every live use.</p></>}
      </>;
    }}</For>}</Show></aside>
  </main>;
}
