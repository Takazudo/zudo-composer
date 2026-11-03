import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ProductionProviderIntegration } from "../../app/provider-integration";
import { contentAiCandidateDigest, type ContentAiProposal } from "../../content/editorial";
import { canonicalEditorialJson } from "../../content/editorial/differences";
import type { SiteProject } from "../../site-project";
import type { SiteCompiledRoute } from "../../site-project/compiler";
import { useAssetResolvedPreviewSnapshot } from "../composer/preview/assets-snapshot";
import { buildComposerPreviewUrl, composerPreviewFrameProps, createComposerPreviewBridge } from "../composer/preview/bridge";
import type { ComposerPreviewSnapshot, NativeReviewIdentity } from "../composer/preview/protocol";
import { loadWorkingPreviewSnapshot } from "../delivery/working-preview";
import { useResolvedTheme } from "../../theme/use-resolved-theme";
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
 * Apply available.
 */
export function ContentAiCandidateFrame({ controller, proposal, integration }: {
  controller: ContentAuthoringController; proposal: ContentAiProposal; integration: ProductionProviderIntegration;
}): JSX.Element {
  const [prepared, setPrepared] = useState<Prepared>({ status: "preparing" });
  const pack = integration.componentProvider.manifest;
  useEffect(() => {
    let active = true;
    setPrepared({ status: "preparing" });
    void (async (): Promise<Prepared> => {
      // The candidate rendered here must be the one the proposal's digest names.
      const digest = await contentAiCandidateDigest({ entry: proposal.entry, expected: proposal.expected, candidate: proposal.candidate });
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
      (value) => { if (active) setPrepared(value); },
      (cause: unknown) => { if (active) setPrepared({ status: "failed", message: cause instanceof Error ? cause.message : "The candidate could not be prepared for rendering." }); },
    );
    return () => { active = false; };
  }, [integration, proposal.id, pack.packId, pack.packVersion]);

  const ready = prepared.status === "ready" ? prepared : null;
  const assets = useAssetResolvedPreviewSnapshot(ready?.snapshot ?? null, integration.componentProvider.catalog);
  const resolved = ready ? assets.snapshot : null;
  const problem = prepared.status === "failed" || prepared.status === "blocked" ? prepared : assets.error ? { status: "failed" as const, message: assets.error } : null;
  useEffect(() => {
    if (problem) controller.recordCandidateRender(controller.beginCandidateRender(proposal.id), proposal.id, problem);
  }, [problem?.status, problem?.message, proposal.id]);

  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<ReturnType<typeof createComposerPreviewBridge> | null>(null);
  const session = useRef(crypto.randomUUID());
  const token = useRef(0);
  const review = ready?.review ?? null;
  const current = useRef({ review, resolved, proposalId: proposal.id, problem });
  current.current = { review, resolved, proposalId: proposal.id, problem };
  const theme = useResolvedTheme();
  const location = useMemo(() => buildComposerPreviewUrl(), []);
  const send = () => {
    const value = current.current;
    if (value.problem) return;
    // A new render supersedes the last one before anything is posted.
    token.current = controller.beginCandidateRender(value.proposalId);
    if (!value.review || !value.resolved) return;
    bridge.current?.render({ ...value.resolved, nativeReview: { ...value.review, frameSession: session.current } }, { mode: "preview", theme, selectedId: null });
  };
  useEffect(() => {
    if (!frame.current) return;
    const connection = createComposerPreviewBridge({
      frame: frame.current, location, hostWindow: window, pack: { packId: pack.packId, packVersion: pack.packVersion },
      onReady: () => { session.current = crypto.randomUUID(); send(); },
      onRendered: (message) => {
        const expected = current.current.review;
        if (!expected || message.nativeReview.frameSession !== session.current || message.nativeReview.planId !== expected.planId || message.nativeReview.digest !== expected.digest || message.nativeReview.dependencyDigest !== expected.dependencyDigest) return;
        controller.recordCandidateRender(token.current, expected.planId, { status: "ready", digest: message.nativeReview.digest });
      },
      onError: (message) => controller.recordCandidateRender(token.current, current.current.proposalId, { status: "failed", message }),
      onRejected: (reason) => controller.recordCandidateRender(token.current, current.current.proposalId, { status: "failed", message: reason === "pack-mismatch" ? "The preview runs a different component pack." : "The preview refused the candidate." }),
    });
    bridge.current = connection;
    send();
    return () => { connection.dispose(); bridge.current = null; };
  }, [pack.packId, pack.packVersion, location]);
  useEffect(send, [review, resolved, theme]);

  return (
    <div class="sg-content-ai__render">
      <p class="sg-content-ai__note">{ready ? `Rendered as ${ready.route.pathname} with this site's template, Mapping, components and styles. Nothing is saved.` : prepared.status === "preparing" ? "Compiling the page with the candidate…" : problem?.message}</p>
      <iframe ref={frame} {...composerPreviewFrameProps(location, "Rendered candidate")} onLoad={() => { session.current = crypto.randomUUID(); send(); }} />
    </div>
  );
}
