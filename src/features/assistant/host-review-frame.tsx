import { useEffect, useRef } from "preact/hooks";
import { acceptHostDocumentMessage, matchesHostDocumentFrame } from "../host-document/protocol";
import type { HostReviewAcknowledgement, HostReviewPreview } from "../../shared/host-review-types";
import type { ProductionProviderIntegration } from "../../app/provider-integration";
/** Acknowledgements come only from the displayed exact candidate document. */
export function HostReviewFrame({ value, integration, onReady }: { value: HostReviewPreview; integration: ProductionProviderIntegration; onReady(value: HostReviewAcknowledgement | null, current?: () => boolean): void }) {
  const frame = useRef<HTMLIFrameElement>(null), acknowledged = useRef<Document | null>(null), invalid = useRef(false);
  const currentCallback = useRef(onReady); currentCallback.current = onReady;
  const preview = { ...value.preview, html: "" };
  useEffect(() => {
    acknowledged.current = null; invalid.current = false; currentCallback.current(null);
    const invalidate = () => { invalid.current = true; acknowledged.current = null; currentCallback.current(null); };
    const message = (event: MessageEvent) => {
      const result = acceptHostDocumentMessage(event, frame.current?.contentWindow ?? null, window.location.origin, preview);
      if (result?.type === "ready" && !invalid.current && matchesHostDocumentFrame(frame.current, preview, window.location.origin)) {
        acknowledged.current = frame.current?.contentDocument ?? null;
        currentCallback.current({ reviewId: value.reviewId, candidateDigest: value.candidateDigest, baseDigest: value.baseDigest, identity: preview.identity, frameId: preview.frameId }, () => !invalid.current && acknowledged.current === frame.current?.contentDocument && matchesHostDocumentFrame(frame.current, preview, window.location.origin));
      } else if (result?.type === "navigate" || result?.type === "leaving") invalidate();
    };
    window.addEventListener("message", message); window.addEventListener("native-authoring-invalidated", invalidate); window.addEventListener("native-authoring-stale", invalidate);
    const stop = integration.subscribeChanges(channel => { if (channel !== "sessions") invalidate(); });
    return () => { stop(); window.removeEventListener("message", message); window.removeEventListener("native-authoring-invalidated", invalidate); window.removeEventListener("native-authoring-stale", invalidate); };
  }, [value, integration]);
  return <iframe ref={frame} title="Host candidate review" sandbox="allow-scripts allow-same-origin" src={value.documentUrl} onLoad={() => {
    if (acknowledged.current !== frame.current?.contentDocument || !matchesHostDocumentFrame(frame.current, preview, window.location.origin)) { acknowledged.current = null; currentCallback.current(null); }
  }} />;
}
