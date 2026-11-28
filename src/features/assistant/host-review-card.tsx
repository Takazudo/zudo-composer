import { batch, computed, getScope, Show, signal } from "@takazudo/zfb/zudo-react";
import { Rebuild } from "../../components/rebuild";
import { read, type MaybeSignal } from "../../components/reactive";
import { assistantRequest } from "../native-editing/session";
import { LiveSelect, when } from "../native-editing/live";
import { hostReviewRecoveryKey } from "./host-review-recovery";
import { HostReviewFrame } from "./host-review-frame";
import type { HostReviewCard as Card, HostReviewPreview, HostReviewAcknowledgement } from "../../shared/host-review-types";
import type { ProductionProviderIntegration } from "../../app/provider-integration";

export function HostReviewCard({ reviewId, workspaceId, integration, blocked }: { reviewId: string; workspaceId: string; integration: ProductionProviderIntegration; blocked: MaybeSignal<boolean> }) {
  const scope = getScope();
  const alive = () => !scope.abortSignal.aborted;
  const card = signal<Card | null>(null), preview = signal<HostReviewPreview | null>(null), ack = signal<HostReviewAcknowledgement | null>(null);
  const error = signal<string | null>(null), busy = signal(false), pending = signal(false);
  let acting = false;
  let frameCurrent: (() => boolean) | undefined;
  const storageKey = hostReviewRecoveryKey(workspaceId, reviewId);
  const isBlocked = computed(() => read(blocked));
  const load = async () => { try { const value = await assistantRequest<Card>("hostReview", workspaceId, { reviewId }); if (alive()) card.value = { ...value }; } catch (cause) { if (alive()) error.value = cause instanceof Error ? cause.message : "Review unavailable."; } };
  scope.onActivate(() => { void load(); try { pending.value = localStorage.getItem(storageKey) !== null; } catch { /* Apply reports storage failure before send. */ } });
  const show = async (pathname: string) => {
    batch(() => { busy.value = true; ack.value = null; preview.value = null; error.value = null; });
    try { const value = await assistantRequest<HostReviewPreview>("previewHostReview", workspaceId, { reviewId, pathname }); if (alive()) preview.value = value; }
    catch (cause) { if (alive()) error.value = cause instanceof Error ? cause.message : "Candidate could not render."; }
    finally { if (alive()) busy.value = false; }
  };
  const act = async (undo = false, recover = false) => {
    if (busy.value || isBlocked.value || acting) return;
    acting = true;
    batch(() => { busy.value = true; error.value = null; });
    try {
      let rendered = ack.value;
      if (!undo) {
        if (recover) { const raw = localStorage.getItem(storageKey); if (!raw) throw new Error("No retained Apply request."); rendered = JSON.parse(raw); }
        if (!rendered || (!recover && !frameCurrent?.())) throw new Error("Render this exact candidate before Apply.");
        localStorage.setItem(storageKey, JSON.stringify(rendered)); pending.value = true;
      }
      await assistantRequest(undo ? "undoHostReview" : "applyHostReview", workspaceId, { reviewId, ...(!undo ? { rendered } : {}) }, true);
      if (!alive()) return;
      if (!undo) { localStorage.removeItem(storageKey); pending.value = false; }
      batch(() => { ack.value = null; preview.value = null; });
      await load();
    } catch (cause) { if (alive()) error.value = `${cause instanceof Error ? cause.message : "Response unavailable."} Review recovery remains available; do not assume a failed response means nothing committed.`; }
    finally { acting = false; if (alive()) busy.value = false; }
  };
  const domain = computed(() => card.value?.operation.domain ?? "Domain");
  const locked = computed(() => busy.value || isBlocked.value);
  return <section class="cms-host-review-card" aria-label={computed(() => `${domain.value} review`)}><h3>{computed(() => card.value?.ownerLabel ?? "Loading owner review…")}</h3><Show when={when(() => error.value)}>{() => <p role="alert">{computed(() => error.value ?? "")}</p>}</Show><Rebuild value={card}>{current => current && <>
    <p>{current.operation.domain === "content" ? "Shared Content record" : "Local Composition"}: {current.summary}</p><p>Status: {current.status}{current.reason ? ` — ${current.reason}` : ""}</p>
    <p>This card changes only its named domain. Other cards require separate review and Apply.</p><ul aria-label="Affected uses">{current.affectedUses.map(use => <li>{use.pathname} · {use.target.recordId}/{use.target.nodeId} · {use.prop}</li>)}</ul>
    {current.status === "open" && <><label>Candidate route <LiveSelect disabled={locked} options={[{ value: "", label: "Choose route to review" }, ...current.routes.map(route => ({ value: route.pathname, label: `${route.title} · ${route.pathname}` }))]} value={computed(() => preview.value?.preview.identity.pathname ?? "")} onChange={value => { if (value) void show(value); }} /></label><button class="cms-btn" disabled={computed(() => locked.value || !current.routes.length)} on:click={() => void show(preview.value?.preview.identity.pathname ?? current.routes[0]!.pathname)}>Render candidate</button><button class="cms-btn" disabled={computed(() => !ack.value || locked.value || pending.value)} on:click={() => void act()}>Apply {current.operation.domain}</button><p role="status">{computed(() => ack.value ? "Exact candidate rendered. Review the changes before Apply." : "Candidate acknowledgement required. Refresh after navigation or canonical changes.")}</p></>}
    <Show when={pending}>{() => <button class="cms-btn" disabled={locked} on:click={() => void act(false, true)}>Recover retained Apply</button>}</Show>
    {current.status === "applied" && <button class="cms-btn" disabled={locked} on:click={() => void act(true)}>Undo {current.operation.domain}</button>}
    <Rebuild value={preview}>{value => value && <HostReviewFrame value={value} integration={integration} onReady={(next, isCurrent) => { frameCurrent = isCurrent; if (alive()) ack.value = next; }} />}</Rebuild>
  </>}</Rebuild></section>;
}
