import { computed, ErrorBoundary, getScope, Show, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import type { VersionedAssetStore } from "../../../../assets/library";
import { read, type MaybeSignal } from "../../../../components/reactive";
import type { ComponentDefinition, ComposerComponentProvider } from "../../active-pack";
import { CompositionPreviewHost, type CompositionPreviewHostProps } from "../../preview/composition-preview-host";
import { buildChooserPreviewDocument } from "./chooser-preview-host";

export const CHOOSER_THUMB_VIEWPORT_WIDTH = 720;
export const CHOOSER_THUMB_ATOM_VIEWPORT_WIDTH = 400;
export const CHOOSER_THUMB_VIEWPORT_HEIGHT = 450;
export const CHOOSER_THUMB_FALLBACK_LIMIT = 4;
const ATOM_CATEGORIES = new Set(["Actions", "Typography", "Media"]);

export interface ChooserThumbProps {
  entry: ComponentDefinition;
  componentProvider: ComposerComponentProvider;
  catalogById: ReadonlyMap<string, ComponentDefinition>;
  scrollerRef: Ref<HTMLUListElement>;
  /** Follows the tile's position, which only matters without IntersectionObserver. */
  index: MaybeSignal<number>;
  location?: CompositionPreviewHostProps["location"];
  createBridge?: CompositionPreviewHostProps["createBridge"];
  assetStore?: VersionedAssetStore;
}

function ThumbPreview({ entry, componentProvider, catalogById, location, createBridge, assetStore }: ChooserThumbProps): Child {
  const scope = getScope();
  const document = buildChooserPreviewDocument(entry, catalogById);
  const state = signal<"loading" | "ready" | "failed">("loading");
  // A navigation that never handshakes also needs a bounded fallback.
  scope.onActivate(() => {
    const timeout = setTimeout(() => {
      if (state.value === "loading") state.value = "failed";
    }, 15000);
    return () => clearTimeout(timeout);
  });
  const failed = computed(() => state.value === "failed");
  const loading = computed(() => state.value === "loading");
  return (
    <Show when={failed} fallback={() => (
      <>
        <Show when={loading}>{() => <span class="sg-composer-chooser-thumb-note">Loading preview…</span>}</Show>
        <div class="sg-composer-chooser-thumb-stage" style={computed(() => ({ visibility: loading.value ? "hidden" : "visible" }))}>
          <CompositionPreviewHost componentProvider={componentProvider} document={document}
            title={`${entry.title} thumbnail`} enlargeable={false} location={location} createBridge={createBridge}
            assetStore={assetStore}
            onCurrent={() => { if (state.value === "loading") state.value = "ready"; }}
            onError={() => { state.value = "failed"; }} />
        </div>
      </>
    )}>
      {() => <span class="sg-composer-chooser-thumb-note">Preview unavailable</span>}
    </Show>
  );
}

/** Each near-visible tile owns a detached document and an independent bridge. */
export function ChooserThumb(props: ChooserThumbProps): Child {
  const { entry, index, scrollerRef } = props;
  const scope = getScope();
  const ref: Ref<HTMLDivElement> = { current: null };
  const near = signal(false);
  const width = signal(0);
  const viewportWidth = ATOM_CATEGORIES.has(entry.category) ? CHOOSER_THUMB_ATOM_VIEWPORT_WIDTH : CHOOSER_THUMB_VIEWPORT_WIDTH;
  scope.onActivate(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      width.value = element.clientWidth;
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });
  if (typeof IntersectionObserver === "undefined") {
    scope.effect(() => {
      near.value = read(index) < CHOOSER_THUMB_FALLBACK_LIMIT;
    });
  }
  scope.onActivate(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const observed of entries) if (observed.target === ref.current) near.value = observed.isIntersecting;
    }, { root: scrollerRef.current, rootMargin: "160px 0px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  });
  const style = computed(() => ({
    "--chooser-thumb-scale": String(Math.min(1, width.value / viewportWidth)),
    "--chooser-thumb-width": `${viewportWidth}px`,
    "--chooser-thumb-height": `${CHOOSER_THUMB_VIEWPORT_HEIGHT}px`,
  }));
  return (
    <div ref={ref} class="sg-composer-chooser-thumb" inert aria-hidden="true" style={style}>
      <Show when={near} fallback={() => <span class="sg-composer-chooser-thumb-note">Preview on focus</span>}>
        {() => (
          <ErrorBoundary fallback={() => <span class="sg-composer-chooser-thumb-note">Preview unavailable</span>}>
            {() => <ThumbPreview {...props} />}
          </ErrorBoundary>
        )}
      </Show>
    </div>
  );
}
