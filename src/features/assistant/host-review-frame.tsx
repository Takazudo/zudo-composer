import { getScope, type Ref } from "@takazudo/zfb/zudo-react";
import { acceptHostDocumentMessage, matchesHostDocumentFrame } from "../host-document/protocol";
import type { HostReviewAcknowledgement, HostReviewPreview } from "../../shared/host-review-types";
import type { ProductionProviderIntegration } from "../../app/provider-integration";
/** Acknowledgements come only from the displayed exact candidate document. Remount per candidate. */
export function HostReviewFrame({ value, integration, onReady }: { value: HostReviewPreview; integration: ProductionProviderIntegration; onReady(value: HostReviewAcknowledgement | null, current?: () => boolean): void }) {
  const scope = getScope();
  const frame: Ref<HTMLIFrameElement> = { current: null };
  let acknowledged: Document | null = null, invalid = false;
  const preview = { ...value.preview, html: "" };
  scope.onActivate(() => {
    onReady(null);
    const invalidate = () => { invalid = true; acknowledged = null; onReady(null); };
    const message = (event: MessageEvent) => {
      const result = acceptHostDocumentMessage(event, frame.current?.contentWindow ?? null, window.location.origin, preview);
      if (result?.type === "ready" && !invalid && matchesHostDocumentFrame(frame.current, preview, window.location.origin)) {
        acknowledged = frame.current?.contentDocument ?? null;
        onReady({ reviewId: value.reviewId, candidateDigest: value.candidateDigest, baseDigest: value.baseDigest, identity: preview.identity, frameId: preview.frameId }, () => !invalid && acknowledged === frame.current?.contentDocument && matchesHostDocumentFrame(frame.current, preview, window.location.origin));
      } else if (result?.type === "navigate" || result?.type === "leaving") invalidate();
    };
    window.addEventListener("message", message); window.addEventListener("native-authoring-invalidated", invalidate); window.addEventListener("native-authoring-stale", invalidate);
    const stop = integration.subscribeChanges(channel => { if (channel !== "sessions") invalidate(); });
    return () => { stop(); window.removeEventListener("message", message); window.removeEventListener("native-authoring-invalidated", invalidate); window.removeEventListener("native-authoring-stale", invalidate); };
  });
  return <iframe ref={frame} title="Host candidate review" sandbox="allow-scripts allow-same-origin" src={value.documentUrl} on:load={() => {
    if (acknowledged !== frame.current?.contentDocument || !matchesHostDocumentFrame(frame.current, preview, window.location.origin)) { acknowledged = null; onReady(null); }
  }} />;
}
