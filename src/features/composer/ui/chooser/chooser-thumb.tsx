import { Component, type ComponentChildren, type RefObject } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentDefinition, ComposerComponentProvider } from "../../active-pack";
import { CompositionPreviewHost, type CompositionPreviewHostProps } from "../../preview/composition-preview-host";
import { buildChooserPreviewDocument } from "./chooser-preview-host";

export const CHOOSER_THUMB_VIEWPORT_WIDTH = 720;
export const CHOOSER_THUMB_ATOM_VIEWPORT_WIDTH = 400;
export const CHOOSER_THUMB_VIEWPORT_HEIGHT = 450;
export const CHOOSER_THUMB_FALLBACK_LIMIT = 4;
const ATOM_CATEGORIES = new Set(["Actions", "Typography", "Media"]);

class ThumbErrorBoundary extends Component<{ children: ComponentChildren }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <span class="sg-composer-chooser-thumb-note">Preview unavailable</span> : this.props.children; }
}

export interface ChooserThumbProps {
  entry: ComponentDefinition;
  componentProvider: ComposerComponentProvider;
  catalogById: ReadonlyMap<string, ComponentDefinition>;
  scrollerRef: RefObject<HTMLUListElement>;
  index: number;
  location?: CompositionPreviewHostProps["location"];
  createBridge?: CompositionPreviewHostProps["createBridge"];
}

function ThumbPreview({ entry, componentProvider, catalogById, location, createBridge }: ChooserThumbProps) {
  const document = useMemo(() => buildChooserPreviewDocument(entry, catalogById), [entry, catalogById]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  // A navigation that never handshakes also needs a bounded fallback.
  useEffect(() => {
    if (state !== "loading") return;
    const timeout = setTimeout(() => setState("failed"), 15000);
    return () => clearTimeout(timeout);
  }, [state]);
  if (state === "failed") return <span class="sg-composer-chooser-thumb-note">Preview unavailable</span>;
  return <>
    {state === "loading" && <span class="sg-composer-chooser-thumb-note">Loading preview…</span>}
    <div class="sg-composer-chooser-thumb-stage" style={{ visibility: state === "loading" ? "hidden" : "visible" }}>
      <CompositionPreviewHost componentProvider={componentProvider} document={document}
        title={`${entry.title} thumbnail`} enlargeable={false} location={location} createBridge={createBridge}
        onCurrent={() => setState("ready")} onError={() => setState("failed")} />
    </div>
  </>;
}

/** Each near-visible tile owns a detached document and an independent bridge. */
export function ChooserThumb(props: ChooserThumbProps) {
  const { entry, index, scrollerRef } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [width, setWidth] = useState(0);
  const viewportWidth = ATOM_CATEGORIES.has(entry.category) ? CHOOSER_THUMB_ATOM_VIEWPORT_WIDTH : CHOOSER_THUMB_VIEWPORT_WIDTH;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setNear(index < CHOOSER_THUMB_FALLBACK_LIMIT);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const observed of entries) if (observed.target === ref.current) setNear(observed.isIntersecting);
    }, { root: scrollerRef.current, rootMargin: "160px 0px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [index, scrollerRef]);
  return <div ref={ref} class="sg-composer-chooser-thumb" inert aria-hidden="true"
    style={{ "--chooser-thumb-scale": Math.min(1, width / viewportWidth), "--chooser-thumb-width": `${viewportWidth}px`, "--chooser-thumb-height": `${CHOOSER_THUMB_VIEWPORT_HEIGHT}px` }}>
    {near ? <ThumbErrorBoundary key={entry.id}><ThumbPreview {...props} /></ThumbErrorBoundary>
      : <span class="sg-composer-chooser-thumb-note">Preview on focus</span>}
  </div>;
}
