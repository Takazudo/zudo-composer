import { batch, computed, For, getScope, Show, signal, type Ref } from "@takazudo/zfb/zudo-react";
import type { RouteServicesProps } from "../../app/services";
import { formatIntent, notifyRouteSelection } from "../../app/route-intents";
import type { SitemapNode } from "../../sitemapper/model/types";
import type { NativeInspection, NativePlan, NativeReceipts } from "./types";
import { NativePageFrame } from "./page-frame";
import { nativeEditingAvailable, nativeEditRequest } from "./session";
import { exactInsertion, isCompositionEnter } from "./request";
import { subscribePersistenceChanges } from "../../shared/persistence-generation";
import { LiveSelect, watch, when } from "./live";
import { Rebuild } from "../../components/rebuild";
import "./page-route.css";

interface Pending { text: string; alt: string; assetId: string; kind: "text" | "image" | "table"; target: string; emptyAlt?: boolean; planId?: string }
const empty: Pending = { text: "", alt: "", assetId: "", kind: "text", target: "" };
const retained = (key: string): Pending => { try { const value = JSON.parse(sessionStorage.getItem(key) ?? "null"); return value && typeof value.text === "string" && ["text", "image", "table"].includes(value.kind) && typeof value.target === "string" ? { ...empty, ...value } : empty; } catch { return empty; } };

export function NativePageRoute({ services }: RouteServicesProps) {
  const integration = services.workspace.integration;
  const scope = getScope();
  const pages = signal<{ sitemapId: string; pageId: string; name: string }[]>([]);
  const pageKey = signal("");
  const page = computed(() => pages.value.find(value => `${value.sitemapId}/${value.pageId}` === pageKey.value));
  const storageKey = computed(() => `zudo-native-input-v1:${integration.workspace.id}:${pageKey.value}`);
  const input = signal<Pending>(empty);
  // Text controls bind models; `save` mirrors them into `input` and the retained draft.
  const text = signal(""), alt = signal(""), emptyAlt = signal(false), kind = signal<string>("text");
  const inspection = signal<NativeInspection | null>(null);
  const plan = signal<NativePlan | null>(null);
  const receipts = signal<NativeReceipts | null>(null);
  const proposed = signal(false);
  const selecting = signal(true);
  const invalidated = signal(false);
  const evidence = signal(false);
  let busyOwner = false;
  const images = signal<{ id: string; name: string }[]>([]);
  const busy = signal(false);
  const error = signal<string | null>(null);
  const tab = signal<"page" | "edit">("page");
  let sequence = 0;
  const editPanel: Ref<HTMLElement> = { current: null };
  const save = (value: Pending) => {
    batch(() => { input.value = value; text.value = value.text; alt.value = value.alt; emptyAlt.value = value.emptyAlt ?? false; kind.value = value.kind; });
    sessionStorage.setItem(storageKey.value, JSON.stringify(value));
  };
  const refresh = () => {
    const current = page.value;
    if (!current || !nativeEditingAvailable) return;
    const ticket = ++sequence;
    batch(() => { inspection.value = null; evidence.value = false; error.value = null; });
    void nativeEditRequest<NativeInspection>("inspect", { workspaceId: integration.workspace.id, sitemapId: current.sitemapId, page: current.pageId }).then(value => { if (sequence === ticket && !scope.abortSignal.aborted) inspection.value = value; }, cause => { if (sequence === ticket && !scope.abortSignal.aborted) error.value = cause.message; });
  };
  scope.onActivate(() => {
    void integration.getCurrentSiteProject({ flushSessions: false }).then(result => {
      if (scope.abortSignal.aborted) return;
      if (result.status !== "ready") { error.value = result.error.message; return; }
      const flatten = (nodes: SitemapNode[]): SitemapNode[] => nodes.flatMap(node => [node, ...flatten(node.children)]);
      const values = result.project.providers.sitemaps.flatMap(provider => provider.records.flatMap(record => flatten(record.document.root).map(node => ({ sitemapId: record.id, pageId: node.id, name: `${record.document.name} · ${node.title || node.id}` }))));
      const params = new URLSearchParams(window.location.search);
      const requested = `${params.get("sitemap")}/${params.get("page")}`;
      batch(() => { pages.value = values; pageKey.value = values.some(value => `${value.sitemapId}/${value.pageId}` === requested) ? requested : values[0] ? `${values[0].sitemapId}/${values[0].pageId}` : ""; });
    }).catch(cause => { if (!scope.abortSignal.aborted) error.value = cause.message; });
    void integration.assetProvider?.store?.list().then(values => { if (!scope.abortSignal.aborted) images.value = values.filter(value => value.state === "active" && value.mimeType.startsWith("image/")).map(value => ({ id: value.id, name: value.fileName })); }).catch(() => {});
    const invalidate = () => batch(() => { invalidated.value = true; evidence.value = false; error.value = "Draft or dependencies changed. Inspect the page and review again. Source changes require restarting the server."; });
    window.addEventListener("native-authoring-invalidated", invalidate);
    const unsubscribe = subscribePersistenceChanges(invalidate);
    return () => { window.removeEventListener("native-authoring-invalidated", invalidate); unsubscribe(); };
  });
  watch(scope, () => [pageKey.value, storageKey.value] as const, ([selectedKey, key]) => {
    const pending = retained(key);
    save(pending);
    batch(() => { plan.value = null; receipts.value = null; proposed.value = false; evidence.value = false; invalidated.value = false; });
    refresh();
    if (!pending.planId) return;
    void Promise.all([nativeEditRequest<NativePlan>("review", { planId: pending.planId }), nativeEditRequest<NativeReceipts>("receipt", { planId: pending.planId })]).then(([value, receipt]) => {
      if (scope.abortSignal.aborted || pageKey.value !== selectedKey) return;
      batch(() => { plan.value = value; receipts.value = receipt; proposed.value = !receipt.applied; });
    }, cause => { if (!scope.abortSignal.aborted && pageKey.value === selectedKey) error.value = cause.message; });
  });
  const run = async (action: () => Promise<void>) => {
    if (busyOwner) return; busyOwner = true; batch(() => { busy.value = true; error.value = null; });
    try { await action(); } catch (cause) { if (!scope.abortSignal.aborted) batch(() => { evidence.value = false; error.value = cause instanceof Error ? cause.message : "Operation unavailable. Recover the retained receipt before retrying."; }); }
    finally { busyOwner = false; if (!scope.abortSignal.aborted) busy.value = false; }
  };
  watch(scope, () => [tab.value] as const, ([value]) => { if (value === "edit") editPanel.current?.focus(); });
  const samePage = computed(() => !!plan.value && !!inspection.value && JSON.stringify(plan.value.identity) === JSON.stringify(inspection.value.identity));
  const snapshot = computed(() => {
    const current = inspection.value, draft = plan.value;
    if (!current) return null;
    const record = samePage.value && draft && !receipts.value?.applied ? proposed.value ? draft.candidate : draft.before : current.record;
    return { document: record.document, localRecordId: record.id, ...(samePage.value && draft?.linked ? { linked: draft.linked } : current.linked ? { linked: current.linked } : {}) };
  });
  const review = computed(() => samePage.value && proposed.value && plan.value && !receipts.value?.applied && !invalidated.value ? { planId: plan.value.id, digest: plan.value.digest, identity: plan.value.identity, dependencyDigest: plan.value.dependencyDigest } : undefined);
  if (!nativeEditingAvailable) return <main><h1>Page editing unavailable</h1><p>This requires a configured local dev server and a direct loopback authoring session. Hosted and static editors have no native writer.</p><a href="/composer">Structure</a></main>;
  const pageOptions = computed(() => [{ value: "", label: "Choose a page", disabled: true }, ...pages.value.map(value => ({ value: `${value.sitemapId}/${value.pageId}`, label: value.name }))]);
  const imageOptions = computed(() => [{ value: "", label: "Choose a managed image" }, ...images.value.map(image => ({ value: image.id, label: image.name }))]);
  const update = (patch: Partial<Pending>) => save({ ...input.value, ...patch });
  const targetText = computed(() => {
    const draft = plan.value, current = inspection.value, target = input.value.target;
    return `Target: ${draft ? `${draft.identity.workspaceId}/${draft.identity.sitemapId}/${draft.identity.pageId} · ${draft.identity.providerId}/${draft.identity.recordId} · ${draft.request.after.nodeId}` : current && target ? `${current.identity.workspaceId}/${current.identity.sitemapId}/${current.identity.pageId} · ${current.identity.providerId}/${current.identity.recordId} · ${target}` : "Select a standalone native node"}`;
  });
  const reviewCopy = computed(() => evidence.value ? "Exact Proposed render confirmed. Ready for explicit approval." : "Apply waits for this exact Proposed candidate to render successfully.");
  return <main class="cms-native-page" data-mobile-tab={tab}>
    <header class="cms-native-header">
      <label>Page <LiveSelect aria-label="Page" options={pageOptions} value={pageKey} disabled={busy} onChange={next => { pageKey.value = next; const [sitemapId, pageId] = next.split("/"); const url = formatIntent({ route: "composer", mode: "page", sitemapId, pageId }); history.replaceState(null, "", url); notifyRouteSelection("replace"); }} /></label>
      <button type="button" aria-pressed={selecting} on:click={() => batch(() => { evidence.value = false; selecting.value = !selecting.value; })}>{computed(() => selecting.value ? "Select targets" : "Browse page")}</button>
      <a href={computed(() => inspection.value ? formatIntent({ route: "composer", providerId: inspection.value.identity.providerId, compositionId: inspection.value.identity.recordId }) : "/composer")}>Structure</a>
    </header>
    <div class="cms-native-tabs" role="tablist" aria-label="Page editing view"><button type="button" role="tab" aria-selected={computed(() => tab.value === "page")} on:click={() => { tab.value = "page"; }}>Page</button><button type="button" role="tab" aria-selected={computed(() => tab.value === "edit")} on:click={() => { tab.value = "edit"; editPanel.current?.focus(); }}>Edit</button></div>
    <section class="cms-native-canvas" aria-label="Rendered page"><Show when={when(() => snapshot.value && inspection.value)} fallback={() => <p role="status">{computed(() => error.value ? "This page cannot be rendered for native editing." : "Opening page…")}</p>}>{() => <NativePageFrame provider={integration.componentProvider} snapshot={snapshot} review={review} selecting={computed(() => selecting.value && !plan.value)} identity={computed(() => inspection.value?.identity ?? null)} draftRevision={computed(() => inspection.value?.revision ?? "")}
      onSelect={nodeId => {
        const current = inspection.value;
        if (!current) return;
        if (!current.targets.some(target => target.nodeId === nodeId)) { error.value = current.allTargets.find(target => target.nodeId === nodeId)?.reason ?? "This target is unsupported. Use its owning source."; return; }
        update({ target: nodeId }); tab.value = "edit"; editPanel.current?.focus();
      }} onEvidence={value => { evidence.value = value; }} onError={message => { error.value = message; }} />}</Show></section>
    <aside class="cms-native-edit" ref={editPanel} tabindex={-1} aria-label="Exact native insertion">
      <h1>Edit this page</h1><p>Supply exact content. No generation provider is connected.</p>
      <Show when={when(() => error.value)}>{() => <p role="alert">{computed(() => error.value ?? "")}</p>}</Show>
      <For each={computed(() => inspection.value?.writeBlockers ?? [])} by={reason => reason}>{reason => <p role="status">{reason}</p>}</For>
      <p class="cms-native-target" aria-label="Selected target">{targetText}</p>
      <Show when={when(() => !plan.value)}>{() => <fieldset disabled={computed(() => busy.value || !inspection.value || !!inspection.value.writeBlockers.length)}>
        <label>Insertion <select aria-label="Insertion" modelValue={kind} on:change={event => update({ kind: event.currentTarget.value as Pending["kind"] })}><option value="text">Exact text</option><option value="image">Managed image</option><option value="table">Supplied table</option></select></label>
        <Show when={when(() => input.value.kind === "image")} fallback={() => <label>{computed(() => input.value.kind === "text" ? "Exact text" : "Table JSON: columns and rows")}<textarea modelValue={text} on:keydown={event => { if (isCompositionEnter(event)) event.stopPropagation(); }} on:input={event => update({ text: event.currentTarget.value })} /></label>}>{() => <>
          <label>Existing managed image <LiveSelect aria-label="Existing managed image" options={imageOptions} value={computed(() => input.value.assetId)} onChange={assetId => update({ assetId })} /></label>
          <label>Alternative text (empty is intentional) <textarea disabled={emptyAlt} modelValue={alt} on:input={event => update({ alt: event.currentTarget.value })} /></label>
          <label><input type="checkbox" modelChecked={emptyAlt} on:change={event => update({ emptyAlt: event.currentTarget.checked })} />Intentionally empty alternative text</label>
        </>}</Show>
        <button type="button" disabled={computed(() => { const value = input.value; return !value.target || busy.value || (value.kind === "image" && (!value.assetId || (!value.emptyAlt && !value.alt))); })} on:click={() => void run(async () => {
          const owner = pageKey.value, key = storageKey.value, current = inspection.value!, value = input.value;
          const planned = await nativeEditRequest<NativePlan>("plan", { workspaceId: current.identity.workspaceId, sitemapId: current.identity.sitemapId, page: current.identity.pageId, after: { nodeId: value.target }, insert: exactInsertion(value.kind, value.text, value.assetId, value.emptyAlt ? "" : value.alt) }, false, { identity: current.identity, revision: current.revision });
          const pending = { ...value, planId: planned.id }; sessionStorage.setItem(key, JSON.stringify(pending));
          if (scope.abortSignal.aborted || pageKey.value !== owner) return;
          batch(() => { input.value = pending; plan.value = planned; invalidated.value = false; proposed.value = true; tab.value = "page"; });
        })}>Review insertion</button>
      </fieldset>}</Show>
      <Rebuild value={computed(() => !receipts.value?.applied ? plan.value : null)}>{current => {
        if (!current) return null;
        return <section class="cms-native-review" aria-label="Review insertion"><h2>Review exact insertion</h2><Show when={when(() => !samePage.value)}>{() => <button type="button" on:click={() => { pageKey.value = `${current.identity.sitemapId}/${current.identity.pageId}`; }}>Return to plan page</button>}</Show><p>{current.identity.pageId} · {current.id}</p><div><button type="button" aria-pressed={computed(() => !proposed.value)} on:click={() => batch(() => { evidence.value = false; proposed.value = false; })}>Original</button><button type="button" aria-pressed={proposed} on:click={() => batch(() => { evidence.value = false; proposed.value = true; })}>Proposed</button></div><p role="status">{reviewCopy}</p>
          <button type="button" disabled={computed(() => busy.value || invalidated.value || !evidence.value || !proposed.value || !samePage.value)} on:click={() => void run(async () => {
            // Resolve durable state first on every retry of a possibly lost response.
            const recovered = await nativeEditRequest<NativeReceipts>("receipt", { planId: current.id });
            if (recovered.applied) { receipts.value = recovered; return; }
            await nativeEditRequest("apply", { planId: current.id, approve: current.digest }, true);
            receipts.value = await nativeEditRequest<NativeReceipts>("receipt", { planId: current.id }); refresh();
          })}>Apply to draft</button>
          <button type="button" disabled={busy} on:click={() => void run(async () => { await nativeEditRequest("discard", { planId: current.id }); update({ planId: undefined }); batch(() => { plan.value = null; proposed.value = false; }); refresh(); })}>Discard</button>
          <button type="button" disabled={busy} on:click={() => void run(async () => { receipts.value = await nativeEditRequest<NativeReceipts>("receipt", { planId: current.id }); })}>Recover receipt</button>
        </section>;
      }}</Rebuild>
      <Rebuild value={computed(() => receipts.value?.applied ? plan.value : null)}>{current => {
        if (!current) return null;
        const done = computed(() => receipts.value?.undone ?? receipts.value?.applied ?? null);
        return <section class="cms-native-review" aria-label="Durable receipt"><h2>{computed(() => receipts.value?.undone ? "Undo committed" : "Applied to draft")}</h2><p role="status">{computed(() => `Durable receipt: ${done.value?.operationId ?? ""}`)}</p><p>{computed(() => done.value?.committedAt ?? "")}</p>
          <button type="button" disabled={computed(() => busy.value || !!receipts.value?.undone)} on:click={() => void run(async () => { await nativeEditRequest("undo", { planId: current.id, approve: current.digest }, true); receipts.value = await nativeEditRequest<NativeReceipts>("receipt", { planId: current.id }); refresh(); })}>Guarded Undo</button>
          <button type="button" disabled={busy} on:click={() => { save({ ...empty }); batch(() => { plan.value = null; receipts.value = null; }); refresh(); }}>New insertion</button>
        </section>;
      }}</Rebuild>
      <button type="button" disabled={busy} on:click={refresh}>Inspect current page</button>
    </aside>
  </main>;
}
