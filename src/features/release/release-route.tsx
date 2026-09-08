import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Banner, Button, Checkbox, Chip } from "../../components/ui";
import { LibraryPage } from "../../components/library-page/library-page";
import { PageIcon } from "../../components/icons";
import type { ReleaseController } from "./controller";
import type { ReleaseChange, ReleaseCheck } from "../../site-project/api/types";
import "./styles.css";

/** Break opportunities preserve copied identity bytes; ordinary prose is untouched. */
function Identity({ value }: { value: string }) { return <code>{value.split(/(?<=[/.:,_-])/u).flatMap((part) => /^[a-f0-9]{32,}$/u.test(part) ? part.match(/.{1,8}/gu)! : [part]).map((part, index) => <span key={index}>{part}<wbr /></span>)}</code>; }

function ReleaseCard({ title, children }: { title: string; children: ComponentChildren }) {
  return <section class="cms-release__card"><h2 class="cms-release__card-title">{title}</h2>{children}</section>;
}

export function ReleaseRoute({ controller, href, hostedDemo = false }: { hostedDemo?: boolean; controller: ReleaseController; href(change: ReleaseChange | ReleaseCheck): string | null }) {
  const [state, setState] = useState(controller.getSnapshot);
  useEffect(() => { setState(controller.getSnapshot()); return controller.subscribe(() => setState(controller.getSnapshot())); }, [controller]);
  useEffect(() => { if (!controller.getSnapshot().working) void controller.inspect(); }, [controller]);
  const blocked = state.busy || state.gateBlocked;
  const writeDisabled = blocked || !controller.available;
  const exportWorking = () => { const source = controller.exportProject(); if (!source) return; const url = URL.createObjectURL(new Blob([source], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "working-site-project.json"; anchor.click(); URL.revokeObjectURL(url); };
  // Highlight the phase's step even while blocked; styling never enables an action.
  const primaryStep = { inspect: "review", reviewed: "approve", approved: "apply", staged: "build", built: "activate", activated: "newReview", uncertain: "newReview" }[state.phase];
  return <LibraryPage class="cms-release-route" icon={PageIcon} title="Review & release" purpose={hostedDemo ? "Inspect and export the disposable working project." : "Inspect, stage, build and activate a local release."}><div class="cms-release__body">
    <div class="cms-release__notices">
      <p>{hostedDemo ? "This hosted demo has no release server. Working changes stay in this tab." : "Local release only — activation is not hosted deployment."}</p>
      <Banner tone="info">{state.message} Current step: {state.phase}.</Banner>
      {state.error && <Banner tone="err">{state.error}</Banner>}
      {state.changed && <Banner tone="warn">Working or release state changed. An unstaged approval is invalid; an exact staged build remains separate from newer drafts.</Banner>}
      {!controller.available && <Banner tone="info">{hostedDemo ? "Local release server unavailable." : "Static read-only mode."} Inspect or export the working project; review, staging and activation require a direct loopback connection to the local development server.</Banner>}
      {state.gateBlocked && !state.busy && <Banner tone="warn">Workspace replacement is in progress. Release operations are unavailable until it finishes.</Banner>}
    </div>
    <ReleaseCard title="Current state">
      <dl class="cms-release__facts">
        <div><dt>Activated local build:</dt><dd><Identity value={state.active?.buildId ?? "None inspected"} /></dd></div>
        <div><dt>Exact staged build:</dt><dd><Identity value={state.staged?.buildId ?? "None"} /></dd></div>
      </dl>
      <nav class="cms-release__links" aria-label="Release destinations"><a href="/website-preview">Live working preview</a><a href="/site">{hostedDemo ? "Demo website preview" : "Activated local website (not deployed)"}</a></nav>
      <div class="cms-release__tools">
      <Button disabled={blocked} onClick={() => void controller.inspect()}>Inspect current state</Button>
      <Button disabled={!state.working || blocked} onClick={exportWorking}>Export working JSON</Button>
      </div>
    </ReleaseCard>
    <ReleaseCard title="Retained server stages">
      <p>{hostedDemo ? "No release server is connected to this demo; there are no retained server stages." : "These records come from the local release catalog, including stages created in another tab or through the CLI. Selecting one never replaces working drafts."}</p>
      <ul class="cms-release__stages">{state.retainedStages.map((stage) => <li key={`${stage.projectId}:${stage.buildId}:${stage.stageGeneration}`}><span class="cms-release__stage-identity"><Identity value={`${stage.projectId} / ${stage.buildId}`} /> · incarnation {stage.stageGeneration}</span> <Button disabled={writeDisabled} onClick={() => void controller.selectStage(stage)}>Inspect stage {stage.buildId.slice(0, 8)}</Button></li>)}</ul>
    </ReleaseCard>
    <ReleaseCard title="Select Content changes">
      <p>Selection changes only the candidate. Unselected published entries retain their activated values; unselected new drafts stay private. Unpublish intent is set in the Content editor.</p>
      <div class="cms-release__choices">{state.choices.map((choice) => { const selected = state.selection.some(({ ref }) => ref.providerId === choice.ref.providerId && ref.modelId === choice.ref.modelId && ref.recordId === choice.ref.recordId); return <div key={JSON.stringify(choice.ref)}><Checkbox disabled={writeDisabled || !!state.staged} checked={selected} onCheckedChange={(checked) => controller.select(choice, checked)} label={`${choice.kind}: ${choice.ref.providerId} / ${choice.ref.modelId} / ${choice.ref.recordId}`} /></div>; })}</div>
      {!state.choices.length && <p>No selectable Content changes in the inspected snapshot.</p>}
    </ReleaseCard>
    {state.plan && <>
      <ReleaseCard title="Changes"><ul>{state.plan.changes.map((change) => { const link = href(change); return <li key={JSON.stringify(change)}>{change.kind} · {change.domain} · {link ? <a href={link}>{change.providerId} / {change.recordId}</a> : `${change.providerId} / ${change.recordId}`}</li>; })}</ul></ReleaseCard>
      <ReleaseCard title="Checks"><ul>{state.plan.checks.map((check, index) => { const link = href(check); return <li key={index}><Chip tone={check.severity === "blocking" ? "err" : "neutral"}>{check.severity}</Chip> · {check.code}: {check.message} <Identity value={check.path} />{link && <> <a href={link}>Inspect source</a></>}</li>; })}</ul></ReleaseCard>
      <ReleaseCard title="Affected"><ul>{state.plan.affected.map((item, index) => <li key={index}>{item.kind} · <Identity value={item.identity} /> · {item.reason}</li>)}</ul></ReleaseCard>
      <p class="cms-release__digest">Approval digest: <Identity value={state.plan.planDigest} /></p>
    </>}
    <div class="cms-release__actions" role="group" aria-label="Release pipeline">
      <Button disabled={writeDisabled || !!state.staged} variant={primaryStep === "review" ? "primary" : "default"} onClick={() => void controller.review()}>Run release checks</Button>
      <Button disabled={writeDisabled || state.phase !== "reviewed" || state.changed || !!state.plan?.checks.some(({ severity }) => severity === "blocking")} variant={primaryStep === "approve" ? "primary" : "default"} onClick={() => controller.approve()}>Approve reviewed candidate</Button>
      <Button disabled={writeDisabled || state.phase !== "approved"} variant={primaryStep === "apply" ? "primary" : "default"} onClick={() => void controller.apply()}>Apply / stage exact candidate</Button>
      <Button disabled={writeDisabled || state.phase !== "staged"} variant={primaryStep === "build" ? "primary" : "default"} onClick={() => void controller.build()}>Build staged candidate</Button>
      <Button disabled={writeDisabled || state.phase !== "built"} variant={primaryStep === "activate" ? "primary" : "default"} onClick={() => void controller.activate()}>Activate locally</Button>
      <Button disabled={writeDisabled || state.phase !== "activated"} onClick={() => void controller.reconcile()}>Retry publication reconciliation</Button>
      <Button disabled={writeDisabled || state.phase !== "staged"} variant="danger" onClick={() => void controller.discard()}>Discard unbuilt stage</Button>
      <Button disabled={blocked || state.phase === "uncertain"} variant={primaryStep === "newReview" ? "primary" : "default"} onClick={() => controller.newReview()}>Review remaining working changes</Button>
    </div>
  </div></LibraryPage>;
}
