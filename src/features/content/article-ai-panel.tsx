import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Button, Field, Textarea } from "../../components/ui";
import type { ContentEntryRecord, ContentFieldDefinition } from "../../content";
import { EditorialError, type ContentAiProposal, type EditorialField } from "../../content/editorial";
import { useWorkspace } from "../../app/workspace-context";
import { ContentAiCandidateFrame } from "./ai-candidate-frame";
import { aiProposalStale, type ContentAiSession, type ContentAuthoringController, type ContentAuthoringState } from "./controller";

function text(value: unknown): string {
  return value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);
}

export interface ArticleAiPanelProps {
  controller: ContentAuthoringController;
  state: ContentAuthoringState;
  entry: ContentEntryRecord;
  fields: readonly ContentFieldDefinition[];
}

type AiPhase = "preparing" | "rendering" | "ready" | "stale" | "expired" | "render-failed" | "blocked" | "applying" | "undoing" | "applied" | "undone";

function phaseOf(session: ContentAiSession, proposal: ContentAiProposal, entry: ContentEntryRecord, preparing: boolean, hasPreview: boolean): AiPhase {
  if (preparing) return "preparing";
  if (session.pending) return session.pending;
  if (session.undone) return "undone";
  if (session.applied) return "applied";
  if (Date.now() > Date.parse(proposal.expiresAt)) return "expired";
  if (aiProposalStale(entry, proposal)) return "stale";
  if (!hasPreview) return "blocked";
  return session.render.status === "ready" ? "ready" : session.render.status === "failed" ? "render-failed" : session.render.status;
}

function phaseText(phase: AiPhase, session: ContentAiSession): string {
  switch (phase) {
    case "preparing": return "Preparing a proposal…";
    case "rendering": return "Rendering the candidate with this site's components — Apply is available once it has rendered.";
    case "ready": return "Ready for review — not applied.";
    case "stale": return "Stale — the Entry changed after this proposal was prepared. Prepare it again.";
    case "expired": return "Expired — this proposal was never applied. Prepare it again.";
    case "render-failed": return `Render failed — Apply stays unavailable. ${session.render.message}`;
    case "blocked": return `Preview blocked — Apply stays unavailable. ${session.render.message || "This editor has no renderer for the candidate."}`;
    case "applying": return session.restored ? "Recovering the Apply…" : "Applying…";
    case "undoing": return "Undoing…";
    case "applied": return session.recovered === "apply" ? "Applied as a new revision (recovered the committed Apply)." : "Applied as a new revision.";
    case "undone": return session.recovered === "undo" ? "Undone; the previous values were restored as a new revision (recovered the committed Undo)." : "Undone; the previous values were restored as a new revision.";
  }
}

/**
 * Bounded AI help for an Article's title and body. A proposal is prepared,
 * validated and stored without writing Content; the author sees every
 * changed field, the raw candidate and the candidate rendered by the host's
 * own components before Apply. Apply and Undo each append one revision, and
 * a reload reads back what the backend committed.
 */
export function ArticleAiPanel({ controller, state, entry, fields }: ArticleAiPanelProps): JSX.Element | null {
  const contentAi = controller.contentAi;
  // The site project the candidate is rendered in; without it a fresh Apply stays blocked.
  const integration = useWorkspace()?.integration;
  const [scope, setScope] = useState<{ fields: EditorialField[]; provider: string; canApply: boolean } | null>(null);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"prepare" | "act" | null>(null);

  useEffect(() => {
    if (!contentAi) return;
    let current = true;
    setScope(null);
    void (async () => {
      const status = await contentAi.status();
      if (!status.available) return;
      const scoped = await contentAi.scope(controller.entryRef(entry));
      if (!current) return;
      setScope({ fields: scoped, provider: status.provider, canApply: status.canApply });
      await controller.restoreAiProposal();
    })().catch(() => { /* No title/body in this model, or no provider: the panel stays hidden. */ });
    return () => { current = false; };
  }, [contentAi, entry.id, entry.modelId]);

  if (!contentAi || !scope) return null;
  const session = state.aiSession?.entryId === entry.id ? state.aiSession : null;
  const label = (fieldId: string) => fields.find((field) => field.id === fieldId)?.label ?? fieldId;
  const act = async (kind: "prepare" | "act", work: () => Promise<unknown>) => {
    setBusy(kind); setError(null);
    try { await work(); }
    catch (reason) { setError(reason instanceof EditorialError || reason instanceof Error ? reason.message : "Content-AI failed."); }
    finally { setBusy(null); }
  };
  const prepare = () => void act("prepare", () => controller.prepareAiProposal(instruction));
  const proposal = session?.result.status === "proposed" ? session.result.proposal : null;
  const phase = session && proposal ? phaseOf(session, proposal, entry, busy === "prepare", Boolean(integration)) : null;

  return (
    <section class="sg-content-group sg-content-ai" aria-labelledby={`content-ai-${entry.id}`}>
      <h3 class="sg-content-group__title" id={`content-ai-${entry.id}`}>AI proposal</h3>
      <p class="sg-content-ai__note">Edits only {scope.fields.map((field) => field.label).join(" and ")}. Nothing is written until you apply it, and publishing stays separate. Provider: {scope.provider}.</p>
      <Field controlId={`content-ai-instruction-${entry.id}`} label="Instruction">
        <Textarea rows={2} value={instruction} onInput={(event) => setInstruction(event.currentTarget.value)} />
      </Field>
      <div class="sg-content-history__actions">
        <Button variant="primary" size="sm" disabled={busy !== null || !instruction.trim()} onClick={prepare}>{phase === "stale" || phase === "expired" ? "Prepare again" : "Prepare proposal"}</Button>
        {session ? <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => controller.discardAiProposal()}>Discard</Button> : null}
      </div>
      {error ? <p class="sg-content-history__refusal" role="alert">{error}</p> : null}
      {session?.result.status === "refused" ? <p class="sg-content-history__refusal" role="alert">Declined: {session.result.message}</p> : null}
      {proposal && session && phase ? (
        <div class="sg-content-ai__proposal" data-proposal-id={proposal.id} data-ai-phase={phase}>
          <p role="status">{phaseText(phase, session)} {proposal.summary}</p>
          <table class="sg-content-history__diff" aria-label="Proposed changes">
            <thead><tr><th scope="col">Field</th><th scope="col">Current</th><th scope="col">Proposed</th></tr></thead>
            <tbody>{proposal.differences.map((difference) => (
              <tr key={difference.fieldId} data-field-id={difference.fieldId}><th scope="row">{label(difference.fieldId)}</th><td>{text(difference.before)}</td><td>{text(difference.after)}</td></tr>
            ))}</tbody>
          </table>
          {!session.applied && integration ? (
            <div aria-label="Rendered candidate" role="group">
              <ContentAiCandidateFrame key={proposal.id} controller={controller} proposal={proposal} integration={integration} />
            </div>
          ) : null}
          <div class="sg-content-ai__candidate" aria-label="Candidate text" role="group">
            {scope.fields.map((field) => (
              <div key={field.id} data-candidate-field={field.id}>
                <strong>{field.label}</strong>
                <pre class="sg-content-ai__value">{text(proposal.candidate[field.id])}</pre>
              </div>
            ))}
          </div>
          <div class="sg-content-history__actions">
            {!session.applied ? (
              <Button variant="primary" size="sm" disabled={busy !== null || !scope.canApply || phase !== "ready"} onClick={() => void act("act", () => controller.runAiProposal("apply", proposal.id))}>Apply proposal</Button>
            ) : !session.undone ? (
              <Button variant="default" size="sm" disabled={busy !== null} onClick={() => void act("act", () => controller.runAiProposal("undo", proposal.id))}>Undo AI change</Button>
            ) : null}
          </div>
          {!scope.canApply ? <p class="sg-content-ai__note">This host permits proposals but not Apply.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
