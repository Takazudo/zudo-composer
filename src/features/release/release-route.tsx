import { computed, For, getScope, Show, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { hostDocumentPreviewConfigured, savedHostPreviewHref } from "../delivery/host-preview-policy";
import type { AppServices } from "../../app/services";
import { Banner, Button, Checkbox, Chip, cx } from "../../components/ui";
import type { ButtonVariant } from "../../components/ui";
import { LibraryPage } from "../../components/library-page/library-page";
import { PageIcon } from "../../components/icons";
import { Rebuild } from "../../components/rebuild";
import { storeSignal } from "../../runtime";
import type { ReleaseController, ReleaseState } from "./controller";
import type { ReleaseChange, ReleaseCheck } from "../../site-project/api/types";
import "./styles.css";

/** Break opportunities preserve copied identity bytes; ordinary prose is untouched. */
function Identity({ value }: { value: string }) { return <code>{value.split(/(?<=[/.:,_-])/u).flatMap((part) => /^[a-f0-9]{32,}$/u.test(part) ? part.match(/.{1,8}/gu)! : [part]).map((part, index) => <span key={index}>{part}<wbr /></span>)}</code>; }

/** An identity that follows the release state; the broken-up text is rebuilt per value. */
function LiveIdentity({ value }: { value: ReadonlySignal<string> }) { return <Rebuild value={value}>{(current) => <Identity value={current} />}</Rebuild>; }

function ReleaseCard({ title, children }: { title: string; children: Child }) {
  return <section class="cms-release__card"><h2 class="cms-release__card-title">{title}</h2>{children}</section>;
}

/**
 * A `Button` whose variant follows the phase. `Button` fixes its variant at
 * setup, and remounting it on every phase change would drop the focus the
 * author just used to advance the pipeline, so the same markup is bound here.
 */
function PhaseButton({ variant, disabled, onClick, children }: { variant: ReadonlySignal<ButtonVariant>; disabled: ReadonlySignal<boolean>; onClick: () => void; children: Child }) {
  return <button type="button" class={computed(() => cx("cms-btn", variant.value !== "default" && `cms-btn--${variant.value}`))} disabled={disabled} on:click={() => onClick()}>{children}</button>;
}

export interface ReleaseRouteProps {
  /** The shell's route services; the release session itself is application-lifetime and arrives as `controller`. */
  services?: AppServices;
  hostedDemo?: boolean;
  controller: ReleaseController;
  href(change: ReleaseChange | ReleaseCheck): string | null;
  /** Called on `pointerdown` and Enter activation of the live working-preview link, before the browser opens it — a head start for a session flush, never a gate. */
  onBeforeNewTab?: () => void;
}

type Step = "review" | "approve" | "apply" | "build" | "activate" | "newReview";
const PRIMARY_STEP: Record<ReleaseState["phase"], Step> = { inspect: "review", reviewed: "approve", approved: "apply", staged: "build", built: "activate", activated: "newReview", uncertain: "newReview" };

export function ReleaseRoute({ controller, href, hostedDemo = false, onBeforeNewTab }: ReleaseRouteProps) {
  const scope = getScope();
  const state = storeSignal(scope, controller);
  scope.onActivate(() => { if (!controller.getSnapshot().working) void controller.inspect(); });
  const blocked = computed(() => state.value.busy || state.value.gateBlocked);
  const writeDisabled = computed(() => blocked.value || !controller.available);
  const exportWorking = () => { const source = controller.exportProject(); if (!source) return; const url = URL.createObjectURL(new Blob([source], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "working-site-project.json"; anchor.click(); URL.revokeObjectURL(url); };
  // Highlight the phase's step even while blocked; styling never enables an action.
  const primaryStep = computed(() => PRIMARY_STEP[state.value.phase]);
  const variantFor = (step: Step, otherwise: ButtonVariant = "default") => computed<ButtonVariant>(() => primaryStep.value === step ? "primary" : otherwise);
  const phaseIs = (phase: ReleaseState["phase"]) => computed(() => state.value.phase === phase);
  const plan = computed(() => state.value.plan);
  const choiceKey = (choice: ReleaseState["choices"][number]) => JSON.stringify(choice.ref);
  return <LibraryPage class="cms-release-route" icon={PageIcon} title="Review & release" purpose={hostedDemo ? "Inspect and export the disposable working project." : "Inspect, stage, build and activate a local release."}><div class="cms-release__body">
    <div class="cms-release__notices">
      <p>{hostedDemo ? "This hosted demo has no release server. Working changes stay in this tab." : "Local release only — activation is not hosted deployment."}</p>
      <Banner tone="info">{computed(() => `${state.value.message} Current step: ${state.value.phase}.`)}</Banner>
      <Show when={computed(() => !!state.value.error)}>{() => <Banner tone="err">{computed(() => state.value.error ?? "")}</Banner>}</Show>
      <Show when={computed(() => state.value.changed)}>{() => <Banner tone="warn">Working or release state changed. An unstaged approval is invalid; an exact staged build remains separate from newer drafts.</Banner>}</Show>
      {!controller.available ? <Banner tone="info">{hostedDemo ? "Local release server unavailable." : "Static read-only mode."} Inspect or export the working project; review, staging and activation require a direct loopback connection to the local development server.</Banner> : null}
      <Show when={computed(() => state.value.gateBlocked && !state.value.busy)}>{() => <Banner tone="warn">Workspace replacement is in progress. Release operations are unavailable until it finishes.</Banner>}</Show>
    </div>
    <ReleaseCard title="Current state">
      <dl class="cms-release__facts">
        <div><dt>Activated local build:</dt><dd><LiveIdentity value={computed(() => state.value.active?.buildId ?? "None inspected")} /></dd></div>
        <div><dt>Exact staged build:</dt><dd><LiveIdentity value={computed(() => state.value.staged?.buildId ?? "None")} /></dd></div>
      </dl>
      <nav class="cms-release__links" aria-label="Release destinations"><a href={hostDocumentPreviewConfigured ? savedHostPreviewHref : "/website-preview"} target="_blank" rel="noopener" on:pointerdown={() => onBeforeNewTab?.()} on:keydown={(event) => { if (event.key === "Enter") onBeforeNewTab?.(); }}>{hostDocumentPreviewConfigured ? "Saved host page preview" : "Live working preview"}</a>{hostDocumentPreviewConfigured ? <span>Activated release preview unavailable: this host requires an exact-release document renderer. Current saved workspace preview is not the activated release.</span> : <a href="/site" target="_blank" rel="noopener">{hostedDemo ? "Demo website preview" : "Activated local website (not deployed)"}</a>}</nav>
      <div class="cms-release__tools">
      <Button disabled={blocked} on:click={() => void controller.inspect()}>Inspect current state</Button>
      <Button disabled={computed(() => !state.value.working || blocked.value)} on:click={exportWorking}>Export working JSON</Button>
      </div>
    </ReleaseCard>
    <ReleaseCard title="Retained server stages">
      <p>{hostedDemo ? "No release server is connected to this demo; there are no retained server stages." : "These records come from the local release catalog, including stages created in another tab or through the CLI. Selecting one never replaces working drafts."}</p>
      <ul class="cms-release__stages"><For each={computed(() => state.value.retainedStages)} by={(stage) => `${stage.projectId}:${stage.buildId}:${stage.stageGeneration}`}>{(stage) => { const current = stage.value; return <li><span class="cms-release__stage-identity"><Identity value={`${current.projectId} / ${current.buildId}`} /> · incarnation {current.stageGeneration}</span> <Button disabled={writeDisabled} on:click={() => void controller.selectStage(stage.value)}>Inspect stage {current.buildId.slice(0, 8)}</Button></li>; }}</For></ul>
    </ReleaseCard>
    <ReleaseCard title="Select Content changes">
      <p>Selection changes only the candidate. Unselected published entries retain their activated values; unselected new drafts stay private. Unpublish intent is set in the Content editor.</p>
      <div class="cms-release__choices"><For each={computed(() => state.value.choices)} by={choiceKey}>{(choice) => {
        const selected = computed(() => state.value.selection.some(({ ref }) => ref.providerId === choice.value.ref.providerId && ref.modelId === choice.value.ref.modelId && ref.recordId === choice.value.ref.recordId));
        return <div><Checkbox disabled={computed(() => writeDisabled.value || !!state.value.staged)} checked={selected} onCheckedChange={(checked) => controller.select(choice.value, checked)} label={computed(() => `${choice.value.kind}: ${choice.value.ref.providerId} / ${choice.value.ref.modelId} / ${choice.value.ref.recordId}`)} /></div>;
      }}</For></div>
      <Show when={computed(() => state.value.choices.length === 0)}>{() => <p>No selectable Content changes in the inspected snapshot.</p>}</Show>
    </ReleaseCard>
    <Rebuild value={plan}>{(current) => current ? <>
      <ReleaseCard title="Changes"><ul>{current.changes.map((change) => { const link = href(change); return <li key={JSON.stringify(change)}>{change.kind} · {change.domain} · {link ? <a href={link}>{change.providerId} / {change.recordId}</a> : `${change.providerId} / ${change.recordId}`}</li>; })}</ul></ReleaseCard>
      <ReleaseCard title="Checks"><ul>{current.checks.map((check, index) => { const link = href(check); return <li key={index}><Chip tone={check.severity === "blocking" ? "err" : "neutral"}>{check.severity}</Chip> · {check.code}: {check.message} <Identity value={check.path} />{link ? <> <a href={link}>Inspect source</a></> : null}</li>; })}</ul></ReleaseCard>
      <ReleaseCard title="Affected"><ul>{current.affected.map((item, index) => <li key={index}>{item.kind} · <Identity value={item.identity} /> · {item.reason}</li>)}</ul></ReleaseCard>
      <p class="cms-release__digest">Approval digest: <Identity value={current.planDigest} /></p>
    </> : null}</Rebuild>
    <div class="cms-release__actions" role="group" aria-label="Release pipeline">
      <PhaseButton disabled={computed(() => writeDisabled.value || !!state.value.staged)} variant={variantFor("review")} onClick={() => void controller.review()}>Run release checks</PhaseButton>
      <PhaseButton disabled={computed(() => writeDisabled.value || state.value.phase !== "reviewed" || state.value.changed || !!state.value.plan?.checks.some(({ severity }) => severity === "blocking"))} variant={variantFor("approve")} onClick={() => controller.approve()}>Approve reviewed candidate</PhaseButton>
      <PhaseButton disabled={computed(() => writeDisabled.value || !phaseIs("approved").value)} variant={variantFor("apply")} onClick={() => void controller.apply()}>Apply / stage exact candidate</PhaseButton>
      <PhaseButton disabled={computed(() => writeDisabled.value || state.value.phase !== "staged")} variant={variantFor("build")} onClick={() => void controller.build()}>Build staged candidate</PhaseButton>
      <PhaseButton disabled={computed(() => writeDisabled.value || state.value.phase !== "built")} variant={variantFor("activate")} onClick={() => void controller.activate()}>Activate locally</PhaseButton>
      <Button disabled={computed(() => writeDisabled.value || state.value.phase !== "activated")} on:click={() => void controller.reconcile()}>Retry publication reconciliation</Button>
      <Button disabled={computed(() => writeDisabled.value || state.value.phase !== "staged")} variant="danger" on:click={() => void controller.discard()}>Discard unbuilt stage</Button>
      <PhaseButton disabled={computed(() => blocked.value || state.value.phase === "uncertain")} variant={variantFor("newReview")} onClick={() => controller.newReview()}>Review remaining working changes</PhaseButton>
    </div>
  </div></LibraryPage>;
}
