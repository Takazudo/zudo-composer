import { useEffect, useMemo, useRef } from "preact/hooks";
import type { ComposerComponentProvider } from "../composer/component-provider";
import { buildComposerPreviewUrl, composerPreviewFrameProps, createComposerPreviewBridge } from "../composer/preview/bridge";
import type { ComposerPreviewSnapshot, NativeReviewIdentity, ReviewAnnotatedMessage } from "../composer/preview/protocol";
import { useResolvedTheme } from "../../theme/use-resolved-theme";
import type { NativeIdentity } from "./types";

export function NativePageFrame({ provider, snapshot, review, selecting, identity, draftRevision, onSelect, onEvidence, onError, onReviewAnnotated, focusAnnotation, title = "Native page preview" }: {
  provider: ComposerComponentProvider; snapshot: ComposerPreviewSnapshot;
  review?: Omit<NativeReviewIdentity, "frameSession">; selecting: boolean; identity: NativeIdentity; draftRevision: string;
  onSelect(id: string, revision: number): void; onEvidence(value: boolean): void; onError(message: string): void;
  onReviewAnnotated?(message: ReviewAnnotatedMessage): void; focusAnnotation?: { id: string; nonce: number } | null; title?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<ReturnType<typeof createComposerPreviewBridge> | null>(null);
  const current = useRef({ snapshot, review, selecting, identity, draftRevision, onSelect, onEvidence, onError, onReviewAnnotated });
  current.current = { snapshot, review, selecting, identity, draftRevision, onSelect, onEvidence, onError, onReviewAnnotated };
  const renderedOwner = useRef<NativeIdentity | null>(null);
  const session = useRef(crypto.randomUUID());
  const theme = useResolvedTheme();
  const location = useMemo(() => buildComposerPreviewUrl(), []);
  const send = () => {
    current.current.onEvidence(false);
    const value = current.current;
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
      onRendered: message => {
        const expected = current.current.review;
        if (!expected || message.nativeReview.frameSession !== session.current || message.nativeReview.planId !== expected.planId || message.nativeReview.digest !== expected.digest || message.nativeReview.dependencyDigest !== expected.dependencyDigest || JSON.stringify(message.nativeReview.identity) !== JSON.stringify(expected.identity)) return;
        current.current.onEvidence(true);
      },
      onError: message => { current.current.onEvidence(false); current.current.onError(message); },
      onReviewAnnotated: message => current.current.onReviewAnnotated?.(message),
      onRejected: reason => { if (reason === "pack-mismatch" || reason === "invalid-payload") { current.current.onEvidence(false); current.current.onError("Preview identity or schema mismatch."); } },
    });
    bridge.current = connection; send();
    return () => { current.current.onEvidence(false); connection.dispose(); bridge.current = null; };
  }, [provider, location]);
  useEffect(send, [snapshot, review, selecting, theme]);
  useEffect(() => { if (focusAnnotation) bridge.current?.focusAnnotation?.(focusAnnotation.id); }, [focusAnnotation]);
  return <iframe ref={frame} {...composerPreviewFrameProps(location, title)} onLoad={() => { session.current = crypto.randomUUID(); send(); }} />;
}
