import { useEffect, useRef, useState } from "preact/hooks";
import { assistantRequest } from "../native-editing/session";
import { hostReviewRecoveryKey } from "./host-review-recovery";
import { HostReviewFrame } from "./host-review-frame";
import type { HostReviewCard as Card, HostReviewPreview, HostReviewAcknowledgement } from "./host-review-types";
import type { ProductionProviderIntegration } from "../../app/provider-integration";

export function HostReviewCard({ reviewId, workspaceId, integration, blocked }: { reviewId: string; workspaceId: string; integration: ProductionProviderIntegration; blocked: boolean }) {
  const [card, setCard] = useState<Card | null>(null), [preview, setPreview] = useState<HostReviewPreview | null>(null), [ack, setAck] = useState<HostReviewAcknowledgement | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const acting = useRef(false);
  const frameCurrent = useRef<(() => boolean) | undefined>(undefined);
  const epoch = useRef(0), storageKey = hostReviewRecoveryKey(workspaceId, reviewId);
  const read = async () => { const ticket = epoch.current; try { const value = await assistantRequest<Card>("hostReview", workspaceId, { reviewId }); if (ticket === epoch.current) setCard(value); } catch (cause) { if (ticket === epoch.current) setError(cause instanceof Error ? cause.message : "Review unavailable."); } };
  useEffect(() => { epoch.current++; void read(); try { setPending(localStorage.getItem(storageKey) !== null); } catch { /* Apply reports storage failure before send. */ } return () => { epoch.current++; }; }, [reviewId, workspaceId]);
  const show = async (pathname: string) => { setBusy(true); setAck(null); setPreview(null); setError(null); const ticket = epoch.current; try { const value = await assistantRequest<HostReviewPreview>("previewHostReview", workspaceId, { reviewId, pathname }); if (ticket === epoch.current) setPreview(value); } catch (cause) { if (ticket === epoch.current) setError(cause instanceof Error ? cause.message : "Candidate could not render."); } finally { if (ticket === epoch.current) setBusy(false); } };
  const act = async (undo = false, recover = false) => {
    if (busy || blocked || acting.current) return;
    acting.current = true;
    const ticket = epoch.current; setBusy(true); setError(null);
    try {
      let rendered = ack;
      if (!undo) {
        if (recover) { const raw = localStorage.getItem(storageKey); if (!raw) throw new Error("No retained Apply request."); rendered = JSON.parse(raw); }
        if (!rendered || (!recover && !frameCurrent.current?.())) throw new Error("Render this exact candidate before Apply.");
        localStorage.setItem(storageKey, JSON.stringify(rendered)); setPending(true);
      }
      await assistantRequest(undo ? "undoHostReview" : "applyHostReview", workspaceId, { reviewId, ...(!undo ? { rendered } : {}) }, true);
      if (ticket !== epoch.current) return;
      if (!undo) { localStorage.removeItem(storageKey); setPending(false); }
      setAck(null); setPreview(null); await read();
    } catch (cause) { if (ticket === epoch.current) setError(`${cause instanceof Error ? cause.message : "Response unavailable."} Review recovery remains available; do not assume a failed response means nothing committed.`); }
    finally { acting.current = false; if (ticket === epoch.current) setBusy(false); }
  };
  return <section class="cms-host-review-card" aria-label={`${card?.operation.domain ?? "Domain"} review`}><h3>{card?.ownerLabel ?? "Loading owner review…"}</h3>{error && <p role="alert">{error}</p>}{card && <>
    <p>{card.operation.domain === "content" ? "Shared Content record" : "Local Composition"}: {card.summary}</p><p>Status: {card.status}{card.reason ? ` — ${card.reason}` : ""}</p>
    <p>This card changes only its named domain. Other cards require separate review and Apply.</p><ul aria-label="Affected uses">{card.affectedUses.map((use, index) => <li key={index}>{use.pathname} · {use.target.recordId}/{use.target.nodeId} · {use.prop}</li>)}</ul>
    {card.status === "open" && <><label>Candidate route <select disabled={busy || blocked} value={preview?.preview.identity.pathname ?? ""} onChange={event => { if (event.currentTarget.value) void show(event.currentTarget.value); }}><option value="">Choose route to review</option>{card.routes.map(route => <option key={route.pathname} value={route.pathname}>{route.title} · {route.pathname}</option>)}</select></label><button class="cms-btn" disabled={busy || blocked || !card.routes.length} onClick={() => void show(preview?.preview.identity.pathname ?? card.routes[0]!.pathname)}>Render candidate</button><button class="cms-btn" disabled={!ack || busy || blocked || pending} onClick={() => void act()}>Apply {card.operation.domain}</button><p role="status">{ack ? "Exact candidate rendered. Review the changes before Apply." : "Candidate acknowledgement required. Refresh after navigation or canonical changes."}</p></>}
    {pending && <button class="cms-btn" disabled={busy || blocked} onClick={() => void act(false, true)}>Recover retained Apply</button>}
    {card.status === "applied" && <button class="cms-btn" disabled={busy || blocked} onClick={() => void act(true)}>Undo {card.operation.domain}</button>}
    {preview && <HostReviewFrame value={preview} integration={integration} onReady={(value, current) => { frameCurrent.current = current; setAck(value); }} />}
  </>}</section>;
}
