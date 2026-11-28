import { computed, getScope, signal, type Ref } from "@takazudo/zfb/zudo-react";
import type { ProductionProviderIntegration } from "../../app/provider-integration";
import { contentAiCandidateDigest, type ContentAiProposal } from "../../content/editorial";
import { canonicalEditorialJson } from "../../content/editorial/differences";
import type { SiteProject } from "../../site-project";
import type { SiteCompiledRoute } from "../../site-project/compiler";
import { resolvedThemeSignal } from "../../theme/use-resolved-theme";
import { assetResolvedPreviewSnapshot } from "../composer/preview/assets-snapshot";
import { buildComposerPreviewUrl, composerPreviewFrameProps, createComposerPreviewBridge } from "../composer/preview/bridge";
import type { ComposerPreviewSnapshot, NativeReviewIdentity } from "../composer/preview/protocol";
import { loadWorkingPreviewSnapshot } from "../delivery/working-preview";
import type { ContentAuthoringController } from "./controller";

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The working project with only this Entry's values replaced by the validated candidate. */
function withCandidate(project: SiteProject, proposal: ContentAiProposal): SiteProject {
  const next = structuredClone(project);
  const provider = next.providers.content.find((item) => item.id === proposal.entry.providerId);
  const entry = provider?.entries.find((item) => item.id === proposal.entry.recordId && item.modelId === proposal.entry.modelId);
  if (!entry) throw new Error("The Entry is not part of this site's project.");
  entry.values = structuredClone(proposal.candidate) as typeof entry.values;
  return next;
}

type Prepared =
  | { status: "ready"; route: SiteCompiledRoute; snapshot: ComposerPreviewSnapshot; review: Omit<NativeReviewIdentity, "frameSession"> }
  | { status: "failed" | "blocked"; message: string }
  | { status: "preparing" };

/**
 * The proposal's exact candidate rendered as the site page that shows it: the
 * working project is compiled exactly as the website preview does, with only
 * this Entry's validated candidate overlaid in memory, so the host's own
 * template, Mappings, routes, components and styles produce it. Nothing is
 * saved. Every send starts a new render token, and only the frame's
 * acknowledgement of this proposal's digest, route and dependencies can make
 * Apply available. One frame belongs to one proposal: a new proposal mounts a new frame.
 */
export function ContentAiCandidateFrame({ controller, proposal, integration }: {
  controller: ContentAuthoringController; proposal: ContentAiProposal; integration: ProductionProviderIntegration;
}) {
  const scope = getScope();
  const prepared = signal<Prepared>({ status: "preparing" });
  const pack = integration.componentProvider.manifest;
  scope.onActivate(() => {
    void (async (): Promise<Prepared> => {
      // The candidate rendered here must be the one the proposal's digest names.
      const digest = await contentAiCandidateDigest({ entry: proposal.entry, expected: proposal.expected, candidate: proposal.candidate, validationPolicy: proposal.validationPolicy });
      if (digest !== proposal.candidateDigest) return { status: "failed", message: "The candidate does not match the proposal it came from." };
      const compiled = await loadWorkingPreviewSnapshot(integration, undefined, (project) => withCandidate(project, proposal));
      if (compiled.status !== "ready") return { status: "blocked", message: compiled.message };
      const route = compiled.build.routes.find((item) => item.selectedEntry?.providerId === proposal.entry.providerId && item.selectedEntry.modelId === proposal.entry.modelId && item.selectedEntry.recordId === proposal.entry.recordId);
      if (!route) return { status: "blocked", message: "No page of this site renders this Entry, so its candidate cannot be reviewed." };
      const { composition } = route;
      const snapshot: ComposerPreviewSnapshot = {
        document: composition.document, localRecordId: composition.document.id,
        ...(composition.linkedSource ? { linked: { sourceRecordId: composition.linkedSource.ref.recordId, sourceDocument: composition.linkedSource.document, outlet: composition.linkedSource.outlet } } : {}),
      };
      const dependencyDigest = await sha256(canonicalEditorialJson({ snapshot, pack: { packId: pack.packId, packVersion: pack.packVersion }, route: { pathname: route.pathname, source: route.source } }));
      return {
        status: "ready", route, snapshot,
        review: { planId: proposal.id, digest, dependencyDigest, identity: { kind: "content-candidate", providerId: proposal.entry.providerId, modelId: proposal.entry.modelId, recordId: proposal.entry.recordId, mapping: { providerId: route.source.ref.providerId, recordId: route.source.ref.recordId }, pathname: route.pathname } },
      };
    })().then(
      (value) => { if (!scope.abortSignal.aborted) prepared.value = value; },
      (cause: unknown) => { if (!scope.abortSignal.aborted) prepared.value = { status: "failed", message: cause instanceof Error ? cause.message : "The candidate could not be prepared for rendering." }; },
    );
  });

  const ready = computed(() => prepared.value.status === "ready" ? prepared.value as Extract<Prepared, { status: "ready" }> : null);
  const assets = assetResolvedPreviewSnapshot(scope, computed(() => ready.value?.snapshot ?? null), integration.componentProvider.catalog, { store: integration.assetProvider?.store });
  const resolved = computed(() => ready.value ? assets.value.snapshot : null);
  const problem = computed(() => {
    const value = prepared.value;
    if (value.status === "failed" || value.status === "blocked") return value;
    const error = assets.value.error;
    return error ? { status: "failed" as const, message: error } : null;
  });
  let recordedProblem = "";
  scope.effect(() => {
    const current = problem.value;
    const key = current ? `${current.status}\u0000${current.message}` : "";
    if (key === recordedProblem) return;
    recordedProblem = key;
    if (current) controller.recordCandidateRender(controller.beginCandidateRender(proposal.id), proposal.id, current);
  });

  const frame: Ref<HTMLIFrameElement> = { current: null };
  let bridge: ReturnType<typeof createComposerPreviewBridge> | null = null;
  let session = crypto.randomUUID();
  let token = 0;
  const review = computed(() => ready.value?.review ?? null);
  const theme = resolvedThemeSignal(scope);
  const location = buildComposerPreviewUrl();
  const send = () => {
    if (problem.value) return;
    // A new render supersedes the last one before anything is posted.
    token = controller.beginCandidateRender(proposal.id);
    const expected = review.value, snapshot = resolved.value;
    if (!expected || !snapshot) return;
    bridge?.render({ ...snapshot, nativeReview: { ...expected, frameSession: session } }, { mode: "preview", theme: theme.value, selectedId: null });
  };
  scope.onActivate(() => {
    if (!frame.current) return undefined;
    const connection = createComposerPreviewBridge({
      frame: frame.current, location, hostWindow: window, pack: { packId: pack.packId, packVersion: pack.packVersion },
      onReady: () => { session = crypto.randomUUID(); send(); },
      onRendered: (message) => {
        const expected = review.value;
        if (!expected || message.nativeReview.frameSession !== session || message.nativeReview.planId !== expected.planId || message.nativeReview.digest !== expected.digest || message.nativeReview.dependencyDigest !== expected.dependencyDigest) return;
        controller.recordCandidateRender(token, expected.planId, { status: "ready", digest: message.nativeReview.digest });
      },
      onError: (message) => controller.recordCandidateRender(token, proposal.id, { status: "failed", message }),
      onRejected: (reason) => controller.recordCandidateRender(token, proposal.id, { status: "failed", message: reason === "pack-mismatch" ? "The preview runs a different component pack." : "The preview refused the candidate." }),
    });
    bridge = connection;
    send();
    return () => { connection.dispose(); bridge = null; };
  });
  let sentKey: readonly unknown[] = [review.value, resolved.value, theme.value];
  scope.effect(() => {
    const next = [review.value, resolved.value, theme.value] as const;
    if (next.every((item, index) => Object.is(item, sentKey[index]))) return;
    sentKey = next;
    send();
  });

  const note = computed(() => {
    const current = ready.value;
    if (current) return `Rendered as ${current.route.pathname} with this site's template, Mapping, components and styles. Nothing is saved.`;
    return prepared.value.status === "preparing" ? "Compiling the page with the candidate…" : problem.value?.message ?? "";
  });
  return (
    <div class="sg-content-ai__render">
      <p class="sg-content-ai__note">{note}</p>
      <iframe ref={frame} {...composerPreviewFrameProps(location, "Rendered candidate")} on:load={() => { session = crypto.randomUUID(); send(); }} />
    </div>
  );
}
