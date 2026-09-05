import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CompositionDocument } from "../../../composer/model/types";
import { ExpandIcon, XMarkIcon } from "../../../components/icons";
import type { ComposerComponentProvider } from "../component-provider";
import { useResolvedTheme } from "../../../theme/use-resolved-theme";
import { buildComposerPreviewUrl, composerPreviewFrameProps, createComposerPreviewBridge, type ComposerPreviewBridge, type ComposerPreviewLocation } from "./bridge";
import { localPreviewSnapshot, type ComposerPreviewSnapshot, type MessageTarget } from "./protocol";
import "./composition-preview-host.css";
import { useMediaResolvedPreviewSnapshot } from "./media-snapshot";

export interface CompositionPreviewHostProps {
  componentProvider: ComposerComponentProvider;
  document: CompositionDocument | null;
  /** Resolved provider-owned snapshot. When present it is sent verbatim instead of a local-only projection. */
  snapshot?: ComposerPreviewSnapshot | null;
  title?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  loading?: boolean;
  enlargeable?: boolean;
  onCurrent?: () => void;
  onError?: (message: string) => void;
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
  createBridge = createComposerPreviewBridge,
  location: suppliedLocation,
  hostWindow,
}: CompositionPreviewHostProps): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<ComposerPreviewBridge | null>(null);
  const renderedSnapshotRef = useRef<ComposerPreviewSnapshot | null>(null);
  const renderedThemeRef = useRef<"light" | "dark" | null>(null);
  const localSnapshot = useMemo(
    () => (document ? localPreviewSnapshot(document, document.id) : null),
    [document],
  );
  const media = useMediaResolvedPreviewSnapshot(snapshot ?? localSnapshot, componentProvider.catalog);
  const effectiveSnapshot = media.snapshot;
  const latestSnapshotRef = useRef(effectiveSnapshot);
  latestSnapshotRef.current = effectiveSnapshot;
  const activeTheme = useResolvedTheme();
  const latestThemeRef = useRef(activeTheme);
  latestThemeRef.current = activeTheme;
  const onCurrentRef = useRef(onCurrent);
  onCurrentRef.current = onCurrent;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => { if (media.error) onErrorRef.current?.(media.error); }, [media.error]);
  const [enlarged, setEnlarged] = useState(false);
  const enlargeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasEnlargedRef = useRef(false);
  const location = useMemo(() => suppliedLocation ?? buildComposerPreviewUrl(), [suppliedLocation]);
  const frameProps = useMemo(() => composerPreviewFrameProps(location, title), [location, title]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const bridge = createBridge({
      frame,
      location,
      hostWindow: hostWindow ?? window,
      pack: { packId: componentProvider.manifest.packId, packVersion: componentProvider.manifest.packVersion },
      onReady: () => onCurrentRef.current?.(),
      onError: (message) => onErrorRef.current?.(message),
      onRejected: (reason, detail) => {
        if (reason === "pack-mismatch") onErrorRef.current?.(`Preview pack mismatch${detail ? `: ${detail}` : "."}`);
      },
    });
    bridgeRef.current = bridge;
    renderedSnapshotRef.current = null;
    const initialSnapshot = latestSnapshotRef.current;
    if (initialSnapshot) {
      bridge.render(initialSnapshot, { mode: "preview", theme: latestThemeRef.current, selectedId: null });
      renderedSnapshotRef.current = initialSnapshot;
      renderedThemeRef.current = latestThemeRef.current;
      if (bridge.ready) onCurrentRef.current?.();
    }
    return () => {
      bridge.dispose();
      bridgeRef.current = null;
      renderedSnapshotRef.current = null;
      renderedThemeRef.current = null;
    };
  }, [componentProvider.manifest.packId, componentProvider.manifest.packVersion, createBridge, hostWindow, location]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !effectiveSnapshot || (renderedSnapshotRef.current === effectiveSnapshot && renderedThemeRef.current === activeTheme)) return;
    bridge.render(effectiveSnapshot, { mode: "preview", theme: activeTheme, selectedId: null });
    renderedSnapshotRef.current = effectiveSnapshot;
    renderedThemeRef.current = activeTheme;
    if (bridge.ready) onCurrentRef.current?.();
  }, [activeTheme, effectiveSnapshot]);

  useEffect(() => {
    if (enlarged) {
      wasEnlargedRef.current = true;
      closeButtonRef.current?.focus();
      const previousOverflow = globalThis.document.body.style.overflow;
      globalThis.document.body.style.overflow = "hidden";
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setEnlarged(false);
        } else if (event.key === "Tab") {
          event.preventDefault();
          closeButtonRef.current?.focus();
        }
      };
      window.addEventListener("keydown", onKeyDown);
      return () => {
        window.removeEventListener("keydown", onKeyDown);
        globalThis.document.body.style.overflow = previousOverflow;
      };
    }
    if (wasEnlargedRef.current) {
      wasEnlargedRef.current = false;
      enlargeButtonRef.current?.focus();
    }
  }, [enlarged]);

  return <div
    class={`sg-composition-preview${enlarged ? " sg-composition-preview--enlarged" : ""}`}
    {...(enlarged ? { role: "dialog", "aria-modal": "true", "aria-label": `${title}, full screen` } : {})}
  >
    {enlargeable && <button ref={enlargeButtonRef} hidden={enlarged} type="button" class="sg-composition-preview__enlarge" aria-label={`Enlarge ${title}`} onClick={() => setEnlarged(true)}><ExpandIcon size="sm" /><span>Full screen</span></button>}
    {enlarged && <button ref={closeButtonRef} type="button" class="sg-composition-preview__close" aria-label={`Close full-screen ${title}`} onClick={() => setEnlarged(false)}><XMarkIcon size="sm" /><span>Close</span></button>}
    <div class="sg-composition-preview__stage" aria-busy={loading || media.loading}>
      {!effectiveSnapshot && <div class="sg-composition-preview__empty"><h3>{emptyTitle}</h3><p>{media.error ?? (media.loading ? "Resolving current Media versions…" : emptyMessage)}</p></div>}
      <iframe ref={frameRef} hidden={!effectiveSnapshot} style={{ display: effectiveSnapshot ? undefined : "none" }} class="sg-composition-preview__frame" tabIndex={-1} aria-hidden={!effectiveSnapshot} {...frameProps} />
    </div>
  </div>;
}
