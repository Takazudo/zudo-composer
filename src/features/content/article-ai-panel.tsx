import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Button, Field, Textarea } from "../../components/ui";
import type { ContentEntryRecord, ContentFieldDefinition } from "../../content";
import { EditorialError, type EditorialField } from "../../content/editorial";
import type { ContentAuthoringController, ContentAuthoringState } from "./controller";

function text(value: unknown): string {
  return value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);
}

export interface ArticleAiPanelProps {
  controller: ContentAuthoringController;
  state: ContentAuthoringState;
  entry: ContentEntryRecord;
  fields: readonly ContentFieldDefinition[];
}

/**
 * Bounded AI help for an Article's title and body. A proposal is prepared and
 * validated without writing; the author sees every changed field and the
 * exact candidate before Apply. Apply and Undo each append one revision.
 */
export function ArticleAiPanel({ controller, state, entry, fields }: ArticleAiPanelProps): JSX.Element | null {
  const contentAi = controller.contentAi;
  const [scope, setScope] = useState<{ fields: EditorialField[]; provider: string; canApply: boolean } | null>(null);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!contentAi) return;
    let current = true;
    setScope(null);
    void (async () => {
      const status = await contentAi.status();
      if (!status.available) return;
      const scoped = await contentAi.scope(controller.entryRef(entry));
      if (current) setScope({ fields: scoped, provider: status.provider, canApply: status.canApply });
    })().catch(() => { /* No title/body in this model, or no provider: the panel stays hidden. */ });
    return () => { current = false; };
  }, [contentAi, entry.id, entry.modelId]);

  if (!contentAi || !scope) return null;
  const session = state.aiSession?.entryId === entry.id ? state.aiSession : null;
  const label = (fieldId: string) => fields.find((field) => field.id === fieldId)?.label ?? fieldId;
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await work(); }
    catch (reason) { setError(reason instanceof EditorialError || reason instanceof Error ? reason.message : "Content-AI failed."); }
    finally { setBusy(false); }
  };
  const proposal = session?.result.status === "proposed" ? session.result.proposal : null;

  return (
    <section class="sg-content-group sg-content-ai" aria-labelledby={`content-ai-${entry.id}`}>
      <h3 class="sg-content-group__title" id={`content-ai-${entry.id}`}>AI proposal</h3>
      <p class="sg-content-ai__note">Edits only {scope.fields.map((field) => field.label).join(" and ")}. Nothing is written until you apply it, and publishing stays separate. Provider: {scope.provider}.</p>
      <Field controlId={`content-ai-instruction-${entry.id}`} label="Instruction">
        <Textarea rows={2} value={instruction} onInput={(event) => setInstruction(event.currentTarget.value)} />
      </Field>
      <div class="sg-content-history__actions">
        <Button variant="primary" size="sm" disabled={busy || !instruction.trim()} onClick={() => void act(() => controller.prepareAiProposal(instruction))}>Prepare proposal</Button>
        {session ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => controller.discardAiProposal()}>Discard</Button> : null}
      </div>
      {error ? <p class="sg-content-history__refusal" role="alert">{error}</p> : null}
      {session?.result.status === "refused" ? <p class="sg-content-history__refusal" role="alert">Declined: {session.result.message}</p> : null}
      {proposal ? (
        <div class="sg-content-ai__proposal" data-proposal-id={proposal.id}>
          <p role="status">{session!.undone ? "Undone; the previous values were restored as a new revision." : session!.receipt ? "Applied as a new revision." : "Proposal ready — not applied."} {proposal.summary}</p>
          <table class="sg-content-history__diff" aria-label="Proposed changes">
            <thead><tr><th scope="col">Field</th><th scope="col">Current</th><th scope="col">Proposed</th></tr></thead>
            <tbody>{proposal.differences.map((difference) => (
              <tr key={difference.fieldId} data-field-id={difference.fieldId}><th scope="row">{label(difference.fieldId)}</th><td>{text(difference.before)}</td><td>{text(difference.after)}</td></tr>
            ))}</tbody>
          </table>
          <div class="sg-content-ai__candidate" aria-label="Candidate preview" role="group">
            {scope.fields.map((field) => (
              <div key={field.id} data-candidate-field={field.id}>
                <strong>{field.label}</strong>
                <pre class="sg-content-ai__value">{text(proposal.candidate[field.id])}</pre>
              </div>
            ))}
          </div>
          <div class="sg-content-history__actions">
            {!session!.receipt ? (
              <Button variant="primary" size="sm" disabled={busy || !scope.canApply} onClick={() => void act(() => controller.runAiProposal("apply", proposal.id))}>Apply proposal</Button>
            ) : !session!.undone ? (
              <Button variant="default" size="sm" disabled={busy} onClick={() => void act(() => controller.runAiProposal("undo", proposal.id))}>Undo AI change</Button>
            ) : null}
          </div>
          {!scope.canApply ? <p class="sg-content-ai__note">This host permits proposals but not Apply.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
