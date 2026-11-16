import { useEffect, useMemo, useRef } from "preact/hooks";
import type { ComposerComponentProvider } from "../composer/component-provider";
import { buildComposerPreviewUrl, composerPreviewFrameProps, createComposerPreviewBridge } from "../composer/preview/bridge";
import type { ComposerPreviewSnapshot, NativeReviewIdentity, ReviewAnnotatedMessage } from "../composer/preview/protocol";
import { useResolvedTheme } from "../../theme/use-resolved-theme";
import type { NativeIdentity } from "./types";

export function NativePageFrame({ provider, snapshot, review, selecting, identity, draftRevision, onSelect, onEvidence, onError, onReviewAnnotated, onRenderReady, focusAnnotation, title = "Native page preview" }: {
  provider: ComposerComponentProvider; snapshot: ComposerPreviewSnapshot;
  review?: Omit<NativeReviewIdentity, "frameSession">; selecting: boolean; identity: NativeIdentity; draftRevision: string;
  onSelect(id: string, revision: number): void; onEvidence(value: boolean): void; onError(message: string): void;
  onRenderReady?(value: boolean): void;
  onReviewAnnotated?(message: ReviewAnnotatedMessage): void; focusAnnotation?: { id: string; nonce: number } | null; title?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<ReturnType<typeof createComposerPreviewBridge> | null>(null);
  const current = useRef({ snapshot, review, selecting, identity, draftRevision, onSelect, onEvidence, onError, onReviewAnnotated, onRenderReady });
  current.current = { snapshot, review, selecting, identity, draftRevision, onSelect, onEvidence, onError, onReviewAnnotated, onRenderReady };
  const invalidated = useRef(false), stale = useRef(false);
  const sentSnapshot = useRef<ComposerPreviewSnapshot | null>(null);
  const renderedOwner = useRef<NativeIdentity | null>(null);
  const session = useRef(crypto.randomUUID());
  const theme = useResolvedTheme();
  const location = useMemo(() => buildComposerPreviewUrl(), []);
  const send = () => {
    current.current.onEvidence(false);
    current.current.onRenderReady?.(false);
    const value = current.current;
    if (stale.current) return;
    invalidated.current = false;
    sentSnapshot.current = value.snapshot;
    renderedOwner.current = value.identity;
    bridge.current?.render({ ...value.snapshot, nativePage: { identity: value.identity, draftRevision: value.draftRevision, frameSession: session.current }, selectNative: value.selecting && !value.review, ...(value.review ? { nativeReview: { ...value.review, frameSession: session.current } } : {}) }, { mode: "preview", theme, selectedId: null });
  };
  useEffect(() => {
    if (!frame.current) return;
    const connection = createComposerPreviewBridge({ frame: frame.current, location, hostWindow: window, pack: { packId: provider.manifest.packId, packVersion: provider.manifest.packVersion },
      onReady: () => { session.current = crypto.randomUUID(); send(); },
      onNativeSelect: message => {
        const value = current.current;
        if (value.selecting && !value.review && message.revision === connection.revision && message.nativePage.frameSession === session.current && message.nativePage.draftRevision === value.draftRevision && JSON.stringify(message.nativePage.identity) === JSON.stringify(value.identity) && JSON.stringify(renderedOwner.current) === JSON.stringify(value.identity)) value.onSelect(message.nodeId, message.revision);
      },
      onNativePageRendered: message => {
        const value = current.current;
        if (sentSnapshot.current === value.snapshot && !invalidated.current && !stale.current && message.revision === connection.revision && message.nativePage.frameSession === session.current && message.nativePage.draftRevision === value.draftRevision && JSON.stringify(message.nativePage.identity) === JSON.stringify(value.identity)) value.onRenderReady?.(true);
      },
      onRendered: message => {
        const expected = current.current.review;
        if (invalidated.current || stale.current || sentSnapshot.current !== current.current.snapshot || !expected || message.nativeReview.frameSession !== session.current || message.nativeReview.planId !== expected.planId || message.nativeReview.digest !== expected.digest || message.nativeReview.dependencyDigest !== expected.dependencyDigest || JSON.stringify(message.nativeReview.identity) !== JSON.stringify(expected.identity)) return;
        current.current.onEvidence(true);
      },
      onError: message => { invalidated.current = true; current.current.onEvidence(false); current.current.onRenderReady?.(false); current.current.onError(message); },
      onReviewAnnotated: message => current.current.onReviewAnnotated?.(message),
      onRejected: reason => { if (reason === "pack-mismatch" || reason === "invalid-payload") { invalidated.current = true; current.current.onEvidence(false); current.current.onRenderReady?.(false); current.current.onError("Preview identity or schema mismatch."); } },
    });
    bridge.current = connection; send();
    return () => { current.current.onEvidence(false); current.current.onRenderReady?.(false); connection.dispose(); bridge.current = null; };
  }, [provider, location]);
  useEffect(send, [snapshot, review, selecting, theme, identity, draftRevision]);
  useEffect(() => {
    const invalidate = (event: Event) => { invalidated.current = true; if (event.type === "native-authoring-stale") stale.current = true; current.current.onRenderReady?.(false); };
    window.addEventListener("native-authoring-stale", invalidate);
    window.addEventListener("native-authoring-invalidated", invalidate);
    return () => { window.removeEventListener("native-authoring-stale", invalidate); window.removeEventListener("native-authoring-invalidated", invalidate); };
  }, []);
  useEffect(() => { if (focusAnnotation) bridge.current?.focusAnnotation?.(focusAnnotation.id); }, [focusAnnotation]);
  return <iframe ref={frame} {...composerPreviewFrameProps(location, title)} onLoad={() => { session.current = crypto.randomUUID(); send(); }} />;
}
