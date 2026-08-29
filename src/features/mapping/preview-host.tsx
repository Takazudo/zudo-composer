import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CompositionDocument } from "../../composer/model/types";
import type { ComposerComponentProvider } from "../composer/component-provider";
import {
  buildComposerPreviewUrl,
  composerPreviewFrameProps,
  createComposerPreviewBridge,
  localPreviewSnapshot,
  type ComposerPreviewBridge,
  type ComposerPreviewLocation,
  type MessageTarget,
} from "../composer/preview";

export interface MappingPreviewHostProps {
  componentProvider: ComposerComponentProvider;
  document: CompositionDocument | null;
  loading?: boolean;
  onCurrent?: () => void;
  onError?: (message: string) => void;
  createBridge?: typeof createComposerPreviewBridge;
  location?: ComposerPreviewLocation;
  hostWindow?: MessageTarget;
}

function theme(): "light" | "dark" { return globalThis.document?.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
function useHostTheme(): "light" | "dark" {
  const [activeTheme, setActiveTheme] = useState(theme);
  useEffect(() => {
    const root = globalThis.document?.documentElement;
    if (!root || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setActiveTheme(theme()));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return activeTheme;
}

/** Dedicated read-only bridge host. Only resolved Composition JSON crosses into the preview chunk. */
export function MappingPreviewHost({ componentProvider, document, loading = false, onCurrent, onError, createBridge = createComposerPreviewBridge, location: suppliedLocation, hostWindow }: MappingPreviewHostProps): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<ComposerPreviewBridge | null>(null);
  const activeTheme = useHostTheme();
  const location = useMemo(() => suppliedLocation ?? buildComposerPreviewUrl(), [suppliedLocation]);
  const frameProps = useMemo(() => composerPreviewFrameProps(location, "Resolved Mapping preview"), [location]);

  useEffect(() => {
    const frame = frameRef.current; if (!frame) return;
    const bridge = createBridge({
      frame, location, hostWindow: hostWindow ?? window,
      pack: { packId: componentProvider.manifest.packId, packVersion: componentProvider.manifest.packVersion },
      onReady: () => onCurrent?.(),
      onError: (message) => onError?.(message),
      onRejected: (reason, detail) => { if (reason === "pack-mismatch") onError?.(`Preview pack mismatch${detail ? `: ${detail}` : "."}`); },
    });
    bridgeRef.current = bridge;
    return () => { bridge.dispose(); bridgeRef.current = null; };
  }, [componentProvider.manifest.packId, componentProvider.manifest.packVersion, createBridge, hostWindow, location, onCurrent, onError]);

  useEffect(() => {
    const bridge = bridgeRef.current; if (!bridge || !document) return;
    bridge.render(localPreviewSnapshot(document, document.id), { mode: "preview", theme: activeTheme, selectedId: null });
  }, [activeTheme, document]);

  return <div class="sg-mapping-preview-stage" aria-busy={loading}>
    {!document && <div class="sg-mapping-empty"><h3>Preview unavailable</h3><p>Choose a valid Composition and sample Entry to render a resolved preview.</p></div>}
    <iframe ref={frameRef} class="sg-mapping-preview-frame" tabIndex={-1} aria-hidden={!document} {...frameProps} />
  </div>;
}
