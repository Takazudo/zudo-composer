import { getScope, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import type { ComposerComponentProvider } from "../composer/component-provider";
import { buildComposerPreviewUrl, composerPreviewFrameProps, createComposerPreviewBridge } from "../composer/preview/bridge";
import type { ComposerPreviewSnapshot, NativeReviewIdentity, ReviewAnnotatedMessage } from "../composer/preview/protocol";
import { resolvedThemeSignal } from "../../theme/use-resolved-theme";
import { read, type MaybeSignal } from "../../components/reactive";
import { watch } from "./live";
import type { NativeIdentity } from "./types";

export interface NativePageFrameProps {
  provider: ComposerComponentProvider; snapshot: ReadonlySignal<ComposerPreviewSnapshot | null>;
  review?: ReadonlySignal<Omit<NativeReviewIdentity, "frameSession"> | undefined>; selecting: MaybeSignal<boolean>; identity: ReadonlySignal<NativeIdentity | null>; draftRevision: ReadonlySignal<string>;
  onSelect(id: string, revision: number): void; onEvidence(value: boolean): void; onError(message: string): void;
  onRenderReady?(value: boolean): void;
  onReviewAnnotated?(message: ReviewAnnotatedMessage): void; focusAnnotation?: ReadonlySignal<{ id: string; nonce: number } | null>; title?: MaybeSignal<string>;
}

/** Live inputs are signals; callbacks are read once and must not read the signals they write. */
export function NativePageFrame(props: NativePageFrameProps) {
  const { provider, onSelect, onEvidence, onError, onReviewAnnotated, onRenderReady } = props;
  const scope = getScope();
  const frame: Ref<HTMLIFrameElement> = { current: null };
  let bridge: ReturnType<typeof createComposerPreviewBridge> | null = null;
  let invalidated = false, stale = false;
  let sentSnapshot: ComposerPreviewSnapshot | null = null;
  let renderedOwner: NativeIdentity | null = null;
  let session: string = crypto.randomUUID();
  const theme = resolvedThemeSignal(scope);
  const location = buildComposerPreviewUrl();
  const review = () => props.review?.value;
  const send = () => {
    onEvidence(false);
    onRenderReady?.(false);
    const snapshot = props.snapshot.value, identity = props.identity.value;
    if (stale || !snapshot || !identity) return;
    invalidated = false;
    sentSnapshot = snapshot;
    renderedOwner = identity;
    const nativeReview = review();
    bridge?.render({ ...snapshot, nativePage: { identity, draftRevision: props.draftRevision.value, frameSession: session }, selectNative: read(props.selecting) && !nativeReview, ...(nativeReview ? { nativeReview: { ...nativeReview, frameSession: session } } : {}) }, { mode: "preview", theme: theme.value, selectedId: null });
  };
  scope.onActivate(() => {
    if (!frame.current) return undefined;
    const connection = createComposerPreviewBridge({ frame: frame.current, location, hostWindow: window, pack: { packId: provider.manifest.packId, packVersion: provider.manifest.packVersion },
      onReady: () => { session = crypto.randomUUID(); send(); },
      onNativeSelect: message => {
        const identity = props.identity.value;
        if (read(props.selecting) && !review() && message.revision === connection.revision && message.nativePage.frameSession === session && message.nativePage.draftRevision === props.draftRevision.value && JSON.stringify(message.nativePage.identity) === JSON.stringify(identity) && JSON.stringify(renderedOwner) === JSON.stringify(identity)) onSelect(message.nodeId, message.revision);
      },
      onNativePageRendered: message => {
        if (sentSnapshot === props.snapshot.value && !invalidated && !stale && message.revision === connection.revision && message.nativePage.frameSession === session && message.nativePage.draftRevision === props.draftRevision.value && JSON.stringify(message.nativePage.identity) === JSON.stringify(props.identity.value)) onRenderReady?.(true);
      },
      onRendered: message => {
        const expected = review();
        if (invalidated || stale || sentSnapshot !== props.snapshot.value || !expected || message.nativeReview.frameSession !== session || message.nativeReview.planId !== expected.planId || message.nativeReview.digest !== expected.digest || message.nativeReview.dependencyDigest !== expected.dependencyDigest || JSON.stringify(message.nativeReview.identity) !== JSON.stringify(expected.identity)) return;
        onEvidence(true);
      },
      onError: message => { invalidated = true; onEvidence(false); onRenderReady?.(false); onError(message); },
      onReviewAnnotated: message => onReviewAnnotated?.(message),
      onRejected: reason => { if (reason === "pack-mismatch" || reason === "invalid-payload") { invalidated = true; onEvidence(false); onRenderReady?.(false); onError("Preview identity or schema mismatch."); } },
    });
    bridge = connection; send();
    const invalidate = (event: Event) => { invalidated = true; if (event.type === "native-authoring-stale") stale = true; onRenderReady?.(false); };
    window.addEventListener("native-authoring-stale", invalidate);
    window.addEventListener("native-authoring-invalidated", invalidate);
    return () => {
      window.removeEventListener("native-authoring-stale", invalidate); window.removeEventListener("native-authoring-invalidated", invalidate);
      onEvidence(false); onRenderReady?.(false); connection.dispose(); bridge = null;
    };
  });
  // Resend whenever any rendered input changes, as the Preact effect on these dependencies did.
  watch(scope, () => [props.snapshot.value, review(), read(props.selecting), theme.value, props.identity.value, props.draftRevision.value] as const, () => { if (bridge) send(); });
  if (props.focusAnnotation) {
    const focus = props.focusAnnotation;
    watch(scope, () => [focus.value] as const, ([value]) => { if (value) bridge?.focusAnnotation?.(value.id); });
  }
  const frameProps = composerPreviewFrameProps(location, read(props.title ?? "Native page preview"));
  return <iframe ref={frame} {...frameProps} title={props.title ?? "Native page preview"} on:load={() => { session = crypto.randomUUID(); send(); }} />;
}
