import { computed, getScope, Show, signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type { ProductionProviderIntegration } from "../../app/provider-integration";
import { read, toSignal, type MaybeSignal } from "../../components/reactive";
import { Rebuild } from "../../components/rebuild";
import { Button, Field, Textarea } from "../../components/ui";
import type { ContentEntryRecord, ContentFieldDefinition } from "../../content";
import { EditorialError, type ContentAiInference, type ContentAiProposal, type EditorialField } from "../../content/editorial";
import { Keyed } from "../../runtime";
import { ContentAiCandidateFrame } from "./ai-candidate-frame";
import { aiProposalStale, type ContentAiSession, type ContentAuthoringController, type ContentAuthoringState } from "./controller";

function text(value: unknown): string {
  return value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);
}

export interface ArticleAiPanelProps {
  controller: ContentAuthoringController;
  state: ReadonlySignal<ContentAuthoringState>;
  /** The open Entry; its id and model are fixed for this panel's lifetime. */
  entry: MaybeSignal<ContentEntryRecord>;
  fields: MaybeSignal<readonly ContentFieldDefinition[]>;
  /** The site project the candidate is rendered in; without it a fresh Apply stays blocked. */
  integration?: ProductionProviderIntegration;
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
export function ArticleAiPanel({ controller, state, entry: suppliedEntry, fields, integration }: ArticleAiPanelProps) {
  const contentAi = controller.contentAi;
  if (!contentAi) return null;
  const scope = getScope();
  const entry = toSignal(suppliedEntry);
  const entryId = entry.value.id;
  const aiScope = signal<{ fields: EditorialField[]; provider: string; canApply: boolean; inference: ContentAiInference } | null>(null);
  const instruction = signal("");
  const error = signal<string | null>(null);
  const busy = signal<"prepare" | "act" | null>(null);

  scope.onActivate(() => {
    void (async () => {
      const status = await contentAi.status();
      if (!status.configured) return;
      const scoped = await contentAi.scope(controller.entryRef(entry.value));
      if (scope.abortSignal.aborted) return;
      // A provider that cannot run now still leaves saved proposals and their committed results readable.
      aiScope.value = { fields: scoped, provider: status.provider, canApply: status.canApply, inference: status.inference };
      await controller.restoreAiProposal();
    })().catch(() => { /* No title/body in this model, or no provider: the panel stays hidden. */ });
  });

  const session = computed(() => { const current = state.value.aiSession; return current?.entryId === entryId ? current : null; });
  const label = (fieldId: string) => read(fields).find((field) => field.id === fieldId)?.label ?? fieldId;
  const act = async (kind: "prepare" | "act", work: () => Promise<unknown>) => {
    busy.value = kind; error.value = null;
    try { await work(); }
    catch (reason) { if (!scope.abortSignal.aborted) error.value = reason instanceof EditorialError || reason instanceof Error ? reason.message : "Content-AI failed."; }
    finally { if (!scope.abortSignal.aborted) busy.value = null; }
  };
  const prepare = () => void act("prepare", () => controller.prepareAiProposal(instruction.value));
  const proposal = computed<ContentAiProposal | null>(() => { const current = session.value; return current?.result.status === "proposed" ? current.result.proposal : null; });
  const phase = computed(() => { const current = session.value, open = proposal.value; return current && open ? phaseOf(current, open, entry.value, busy.value === "prepare", Boolean(integration)) : null; });
  const headingId = `content-ai-${entryId}`;

  return (
    <Show when={computed(() => aiScope.value !== null)}>{() => {
      const loaded = aiScope.value!;
      return (
        <section class="sg-content-group sg-content-ai" aria-labelledby={headingId}>
          <h3 class="sg-content-group__title" id={headingId}>AI proposal</h3>
          <p class="sg-content-ai__note">Edits only {loaded.fields.map((field) => field.label).join(" and ")}. Nothing is written until you apply it, and publishing stays separate. Provider: {loaded.provider}.</p>
          {loaded.inference.state !== "ready" ? <p class="sg-content-history__refusal" role="status" data-ai-inference={loaded.inference.state}>New proposals are unavailable: {loaded.inference.message}</p> : null}
          <Field controlId={`content-ai-instruction-${entryId}`} label="Instruction">
            {(control) => <Textarea field={control} rows={2} modelValue={instruction} />}
          </Field>
          <div class="sg-content-history__actions">
            <Button variant="primary" size="sm" disabled={computed(() => busy.value !== null || !instruction.value.trim() || loaded.inference.state === "unavailable")} on:click={prepare}>{computed(() => phase.value === "stale" || phase.value === "expired" ? "Prepare again" : "Prepare proposal")}</Button>
            <Show when={computed(() => session.value !== null)}>{() => <Button variant="ghost" size="sm" disabled={computed(() => busy.value !== null)} on:click={() => controller.discardAiProposal()}>Discard</Button>}</Show>
          </div>
          <Show when={computed(() => error.value !== null)}>{() => <p class="sg-content-history__refusal" role="alert">{computed(() => error.value ?? "")}</p>}</Show>
          <Rebuild value={computed(() => { const current = session.value; return current?.result.status === "refused" ? current.result.message : null; })}>{(message) => message === null ? null : <p class="sg-content-history__refusal" role="alert">Declined: {message}</p>}</Rebuild>
          <Keyed value={computed(() => phase.value === null ? null : proposal.value)} by={(open) => open?.id ?? ""}>{(open) => {
            const current = open.value;
            if (!current) return null;
            const applied = computed(() => Boolean(session.value?.applied));
            const undone = computed(() => Boolean(session.value?.undone));
            return (
              <div class="sg-content-ai__proposal" data-proposal-id={current.id} data-ai-phase={computed(() => phase.value ?? "")}>
                <p role="status">{computed(() => { const live = session.value, now = phase.value; return live && now ? `${phaseText(now, live)} ${current.summary}` : ""; })}</p>
                <table class="sg-content-history__diff" aria-label="Proposed changes">
                  <thead><tr><th scope="col">Field</th><th scope="col">Current</th><th scope="col">Proposed</th></tr></thead>
                  <tbody>{current.differences.map((difference) => (
                    <tr data-field-id={difference.fieldId}><th scope="row">{label(difference.fieldId)}</th><td>{text(difference.before)}</td><td>{text(difference.after)}</td></tr>
                  ))}</tbody>
                </table>
                {integration ? (
                  <Show when={computed(() => !applied.value)}>{() => (
                    <div aria-label="Rendered candidate" role="group">
                      <ContentAiCandidateFrame controller={controller} proposal={current} integration={integration} />
                    </div>
                  )}</Show>
                ) : null}
                <div class="sg-content-ai__candidate" aria-label="Candidate text" role="group">
                  {loaded.fields.map((field) => (
                    <div data-candidate-field={field.id}>
                      <strong>{field.label}</strong>
                      <pre class="sg-content-ai__value">{text(current.candidate[field.id])}</pre>
                    </div>
                  ))}
                </div>
                <div class="sg-content-history__actions">
                  <Show
                    when={computed(() => !applied.value)}
                    fallback={() => (
                      <Show when={computed(() => !undone.value)}>{() => (
                        <Button variant="default" size="sm" disabled={computed(() => busy.value !== null)} on:click={() => void act("act", () => controller.runAiProposal("undo", current.id))}>Undo AI change</Button>
                      )}</Show>
                    )}
                  >{() => (
                    <Button variant="primary" size="sm" disabled={computed(() => busy.value !== null || !loaded.canApply || phase.value !== "ready")} on:click={() => void act("act", () => controller.runAiProposal("apply", current.id))}>Apply proposal</Button>
                  )}</Show>
                </div>
                {!loaded.canApply ? <p class="sg-content-ai__note">This host permits proposals but not Apply.</p> : null}
              </div>
            );
          }}</Keyed>
        </section>
      );
    }}</Show>
  );
}
