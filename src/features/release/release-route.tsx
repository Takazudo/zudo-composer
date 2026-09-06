import { useEffect, useState } from "preact/hooks";
import { Button, Checkbox, Pane, PaneBody, PaneHeader, PaneSection } from "../../components/ui";
import type { ReleaseController } from "./controller";
import type { ReleaseChange, ReleaseCheck } from "../../site-project/api/types";

/** Break opportunities preserve copied identity bytes; ordinary prose is untouched. */
function Identity({ value }: { value: string }) { return <code>{value.split(/(?<=[/.:,_-])/u).flatMap((part) => /^[a-f0-9]{32,}$/u.test(part) ? part.match(/.{1,8}/gu)! : [part]).map((part, index) => <span key={index}>{part}<wbr /></span>)}</code>; }

export function ReleaseRoute({ controller, href }: { controller: ReleaseController; href(change: ReleaseChange | ReleaseCheck): string | null }) {
  const [state, setState] = useState(controller.getSnapshot);
  useEffect(() => { setState(controller.getSnapshot()); return controller.subscribe(() => setState(controller.getSnapshot())); }, [controller]);
  useEffect(() => { if (!controller.getSnapshot().working) void controller.inspect(); }, [controller]);
  const writeDisabled = state.busy || !controller.available;
  const exportWorking = () => { const source = controller.exportProject(); if (!source) return; const url = URL.createObjectURL(new Blob([source], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "working-site-project.json"; anchor.click(); URL.revokeObjectURL(url); };
  return <Pane label="Review and release"><PaneHeader title="Review & release" as="h1" /><PaneBody>
    <p>Local release only — activation is not hosted deployment.</p>
    <p role="status">{state.message} Current step: {state.phase}.</p>
    {state.error && <p role="alert">{state.error}</p>}
    {state.changed && <p role="status">Working or release state changed. An unstaged approval is invalid; an exact staged build remains separate from newer drafts.</p>}
    {!controller.available && <p>Static read-only mode. Inspect or export the working project; review, staging and activation require a direct loopback connection to the local development server.</p>}
    <p>Activated local build: <Identity value={state.active?.buildId ?? "None inspected"} /></p>
    <p>Exact staged build: <Identity value={state.staged?.buildId ?? "None"} /></p>
    <nav aria-label="Release destinations"><a href="/website-preview">Working draft preview</a> · <a href="/site">Activated website</a></nav>
    <Button disabled={state.busy} onClick={() => void controller.inspect()}>Inspect current state</Button>
    <Button disabled={!state.working || state.busy} onClick={exportWorking}>Export working JSON</Button>
    <PaneSection title="Retained server stages">
      <p>These records come from the local release catalog, including stages created in another tab or through the CLI. Selecting one never replaces working drafts.</p>
      <ul>{state.retainedStages.map((stage) => <li key={`${stage.projectId}:${stage.buildId}:${stage.stageGeneration}`}><Identity value={`${stage.projectId} / ${stage.buildId}`} /> · incarnation {stage.stageGeneration} <Button disabled={writeDisabled} onClick={() => void controller.selectStage(stage)}>Inspect stage {stage.buildId.slice(0, 8)}</Button></li>)}</ul>
    </PaneSection>
    <PaneSection title="Select Content changes">
      <p>Selection changes only the candidate. Unselected published entries retain their activated values; unselected new drafts stay private. Unpublish intent is set in the Content editor.</p>
      {state.choices.map((choice) => { const selected = state.selection.some(({ ref }) => ref.providerId === choice.ref.providerId && ref.modelId === choice.ref.modelId && ref.recordId === choice.ref.recordId); return <div key={JSON.stringify(choice.ref)}><Checkbox disabled={writeDisabled || !!state.staged} checked={selected} onCheckedChange={(checked) => controller.select(choice, checked)} label={`${choice.kind}: ${choice.ref.providerId} / ${choice.ref.modelId} / ${choice.ref.recordId}`} /></div>; })}
      {!state.choices.length && <p>No selectable Content changes in the inspected snapshot.</p>}
    </PaneSection>
    <Button disabled={writeDisabled || !!state.staged} onClick={() => void controller.review()}>Run release checks</Button>
    {state.plan && <>
      <PaneSection title="Changes"><ul>{state.plan.changes.map((change) => { const link = href(change); return <li key={JSON.stringify(change)}>{change.kind} · {change.domain} · {link ? <a href={link}>{change.providerId} / {change.recordId}</a> : `${change.providerId} / ${change.recordId}`}</li>; })}</ul></PaneSection>
      <PaneSection title="Checks"><ul>{state.plan.checks.map((check, index) => { const link = href(check); return <li key={index}>{check.severity} · {check.code}: {check.message} <Identity value={check.path} />{link && <> <a href={link}>Inspect source</a></>}</li>; })}</ul></PaneSection>
      <PaneSection title="Affected"><ul>{state.plan.affected.map((item, index) => <li key={index}>{item.kind} · <Identity value={item.identity} /> · {item.reason}</li>)}</ul></PaneSection>
      <p>Approval digest: <Identity value={state.plan.planDigest} /></p>
    </>}
    <Button disabled={writeDisabled || state.phase !== "reviewed" || state.changed || !!state.plan?.checks.some(({ severity }) => severity === "blocking")} onClick={() => controller.approve()}>Approve reviewed candidate</Button>
    <Button disabled={writeDisabled || state.phase !== "approved"} onClick={() => void controller.apply()}>Apply / stage exact candidate</Button>
    <Button disabled={writeDisabled || state.phase !== "staged"} onClick={() => void controller.build()}>Build staged candidate</Button>
    <Button disabled={writeDisabled || state.phase !== "built"} onClick={() => void controller.activate()}>Activate locally</Button>
    <Button disabled={writeDisabled || state.phase !== "activated"} onClick={() => void controller.reconcile()}>Retry publication reconciliation</Button>
    <Button disabled={writeDisabled || state.phase !== "staged"} onClick={() => void controller.discard()}>Discard unbuilt stage</Button>
    <Button disabled={state.busy || state.phase === "uncertain"} onClick={() => controller.newReview()}>Review remaining working changes</Button>
  </PaneBody></Pane>;
}
