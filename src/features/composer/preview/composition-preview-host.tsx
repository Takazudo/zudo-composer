import { computed, getScope, signal, Show, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import type { CompositionDocument } from "../../../composer/model/types";
import type { VersionedAssetStore } from "../../../assets/library";
import { ExpandIcon, XMarkIcon } from "../../../components/icons";
import { read, toSignal, type MaybeSignal } from "../../../components/reactive";
import type { ComposerComponentProvider } from "../component-provider";
import { resolvedThemeSignal } from "../../../theme/use-resolved-theme";
import { buildComposerPreviewUrl, composerPreviewFrameProps, createComposerPreviewBridge, type ComposerPreviewBridge, type ComposerPreviewLocation } from "./bridge";
import { localPreviewSnapshot, type ComposerPreviewSnapshot, type MessageTarget } from "./protocol";
import "./composition-preview-host.css";
import { assetResolvedPreviewSnapshot } from "./assets-snapshot";

export interface CompositionPreviewHostProps {
  componentProvider: ComposerComponentProvider;
  document: MaybeSignal<CompositionDocument | null>;
  /** Resolved provider-owned snapshot. When present it is sent verbatim instead of a local-only projection. */
  snapshot?: MaybeSignal<ComposerPreviewSnapshot | null | undefined>;
  title?: string;
  emptyTitle?: MaybeSignal<string>;
  emptyMessage?: MaybeSignal<string>;
  loading?: MaybeSignal<boolean>;
  enlargeable?: boolean;
  /** Read at call time, so a signal may swap the callback without a remount. */
  onCurrent?: MaybeSignal<(() => void) | undefined>;
  onError?: MaybeSignal<((message: string) => void) | undefined>;
  /** The workspace's versioned Asset store, for resolving managed Asset references. */
  assetStore?: VersionedAssetStore;
  createBridge?: typeof createComposerPreviewBridge;
  location?: ComposerPreviewLocation;
  hostWindow?: MessageTarget;
}

/** Generic, read-only Composition host. Only detached Composition JSON crosses the iframe boundary. */
export function CompositionPreviewHost({
  componentProvider,
  document,
  snapshot,
  title = "Composition preview",
  emptyTitle = "Preview unavailable",
  emptyMessage = "Choose a valid source to render a preview.",
  loading = false,
  enlargeable = true,
  onCurrent,
  onError,
  assetStore,
  createBridge = createComposerPreviewBridge,
  location: suppliedLocation,
  hostWindow,
}: CompositionPreviewHostProps): Child {
  const scope = getScope();
  const frameRef: Ref<HTMLIFrameElement> = { current: null };
  let bridge: ComposerPreviewBridge | null = null;
  let renderedSnapshot: ComposerPreviewSnapshot | null = null;
  let renderedTheme: "light" | "dark" | null = null;
  const documentSignal = toSignal(document);
  const suppliedSnapshot = toSignal(snapshot ?? null);
  let lastDocument: CompositionDocument | null = null;
  let localSnapshot: ComposerPreviewSnapshot | null = null;
  const authored = computed(() => {
    const supplied = suppliedSnapshot.value;
    if (supplied) return supplied;
    const current = documentSignal.value;
    if (current !== lastDocument) {
      lastDocument = current;
      localSnapshot = current ? localPreviewSnapshot(current, current.id) : null;
    }
    return localSnapshot;
  });
  const asset = assetResolvedPreviewSnapshot(scope, authored, componentProvider.catalog, { store: assetStore });
  const effectiveSnapshot = computed(() => asset.value.snapshot);
  const assetError = computed(() => asset.value.error);
  const activeTheme = resolvedThemeSignal(scope);
  const current = (): void => read(onCurrent)?.();
  const fail = (message: string): void => read(onError)?.(message);

  let reportedError: string | undefined;
  scope.effect(() => {
    const message = assetError.value;
    if (message === reportedError) return;
    reportedError = message;
    if (message) fail(message);
  });
  const enlarged = signal(false);
  const enlargeButtonRef: Ref<HTMLButtonElement> = { current: null };
  const closeButtonRef: Ref<HTMLButtonElement> = { current: null };
  let wasEnlarged = false;
  const location = suppliedLocation ?? buildComposerPreviewUrl();
  const frameProps = composerPreviewFrameProps(location, title);

  const send = (next: ComposerPreviewSnapshot, theme: "light" | "dark"): void => {
    if (!bridge) return;
    bridge.render(next, { mode: "preview", theme, selectedId: null });
    renderedSnapshot = next;
    renderedTheme = theme;
    if (bridge.ready) current();
  };

  scope.onActivate(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const created = createBridge({
      frame,
      location,
      hostWindow: hostWindow ?? window,
      pack: { packId: componentProvider.manifest.packId, packVersion: componentProvider.manifest.packVersion },
      onReady: () => current(),
      onError: (message) => fail(message),
      onRejected: (reason, detail) => {
        if (reason === "pack-mismatch") fail(`Preview pack mismatch${detail ? `: ${detail}` : "."}`);
      },
    });
    bridge = created;
    renderedSnapshot = null;
    const initialSnapshot = effectiveSnapshot.value;
    if (initialSnapshot) send(initialSnapshot, activeTheme.value);
    return () => {
      created.dispose();
      bridge = null;
      renderedSnapshot = null;
      renderedTheme = null;
    };
  });

  scope.effect(() => {
    const next = effectiveSnapshot.value;
    const theme = activeTheme.value;
    if (!bridge || !next || (renderedSnapshot === next && renderedTheme === theme)) return;
    send(next, theme);
  });

  scope.effect(() => {
    if (enlarged.value) {
      wasEnlarged = true;
      closeButtonRef.current?.focus();
      const body = globalThis.document.body;
      const previousOverflow = body.style.overflow;
      body.style.overflow = "hidden";
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          enlarged.value = false;
        } else if (event.key === "Tab") {
          event.preventDefault();
          closeButtonRef.current?.focus();
        }
      };
      window.addEventListener("keydown", onKeyDown);
      return () => {
        window.removeEventListener("keydown", onKeyDown);
        body.style.overflow = previousOverflow;
      };
    }
    if (wasEnlarged) {
      wasEnlarged = false;
      enlargeButtonRef.current?.focus();
    }
    return undefined;
  });

  const empty = computed(() => !effectiveSnapshot.value);
  const busy = computed(() => read(loading) || asset.value.loading);
  const emptyText = computed(() => asset.value.error ?? (asset.value.loading ? "Resolving current Assets versions…" : read(emptyMessage)));

  return <div
    class={computed(() => `sg-composition-preview${enlarged.value ? " sg-composition-preview--enlarged" : ""}`)}
    role={computed(() => (enlarged.value ? "dialog" : null))}
    aria-modal={computed(() => (enlarged.value ? "true" : null))}
    aria-label={computed(() => (enlarged.value ? `${title}, full screen` : null))}
  >
    {enlargeable ? <button ref={enlargeButtonRef} hidden={enlarged} type="button" class="sg-composition-preview__enlarge" aria-label={`Enlarge ${title}`} on:click={() => { enlarged.value = true; }}><ExpandIcon size="sm" /><span>Full screen</span></button> : null}
    <Show when={enlarged}>{() => <button ref={closeButtonRef} type="button" class="sg-composition-preview__close" aria-label={`Close full-screen ${title}`} on:click={() => { enlarged.value = false; }}><XMarkIcon size="sm" /><span>Close</span></button>}</Show>
    <div class="sg-composition-preview__stage" aria-busy={busy}>
      <Show when={empty}>{() => <div class="sg-composition-preview__empty"><h3>{toSignal(emptyTitle)}</h3><p>{emptyText}</p></div>}</Show>
      <iframe ref={frameRef} hidden={empty} style={computed(() => (empty.value ? "display: none;" : null))} on:error={() => fail("Preview frame failed to load.")} class="sg-composition-preview__frame" tabindex={-1} aria-hidden={computed(() => (empty.value ? "true" : "false"))} {...frameProps} />
    </div>
  </div>;
}
