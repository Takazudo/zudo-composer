import { defineComponent } from "@zudo-composer/component-contract";
import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { GalleryRegistryContext, GallerySelectionContext, type GalleryImageData } from "./gallery-image";
import { useGridRegistry } from "./grid-context";

// Images arrive as `shop.gallery-image` children rather than src1/src2 props:
// the Assets pass pins only props named src/href/poster/url
// (src/site-project/assets/impact.ts), so a numbered prop would never resolve.
export interface ProductGalleryProps {
  images?: ComponentChildren;
}

const NEXT_KEYS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function ProductGallery({ images }: ProductGalleryProps) {
  const { registry, ordered } = useGridRegistry<GalleryImageData>();
  const [selected, setSelected] = useState(0);
  const thumbs = useRef<HTMLDivElement>(null);
  const current = Math.min(selected, Math.max(0, ordered.length - 1));

  const select = (index: number) => {
    const next = (index + ordered.length) % ordered.length;
    setSelected(next);
    thumbs.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = NEXT_KEYS[event.key];
    const target = step !== undefined ? current + step : event.key === "Home" ? 0 : event.key === "End" ? ordered.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    select(target);
  };

  return (
    <GalleryRegistryContext.Provider value={registry}>
      <GallerySelectionContext.Provider value={ordered[current]?.[0] ?? null}>
        <div class="flex flex-col gap-shop-vsp-sm">
          <div class="aspect-square w-full overflow-hidden bg-shop-surface">{images}</div>
          {ordered.length >= 2 && (
            // Roving focus: one tab stop, arrow keys move the selection (and focus) between thumbnails.
            <div ref={thumbs} role="group" aria-label="Product images" onKeyDown={onKeyDown} class="grid grid-cols-4 gap-shop-hsp-xs">
              {ordered.map(([id, image], index) => (
                <button
                  key={id}
                  type="button"
                  aria-label={`Show image ${index + 1} of ${ordered.length}`}
                  aria-pressed={index === current}
                  tabIndex={index === current ? 0 : -1}
                  onClick={() => setSelected(index)}
                  class={`aspect-square bg-shop-surface border ${index === current ? "border-shop-fg-strong" : "border-shop-bg hover:border-shop-border"}`}
                >
                  <img src={image.src} alt="" loading="lazy" class="block h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </GallerySelectionContext.Provider>
    </GalleryRegistryContext.Provider>
  );
}

export const productGalleryComponent = defineComponent<ProductGalleryProps>()(ProductGallery, {
  id: "shop.product-gallery",
  schemaVersion: 1,
  title: "Product gallery",
  category: "Product",
  description: "Square main image with thumbnails when two or more gallery images are set; arrow keys move the selection.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "ProductGallery" },
  defaults: {},
  fields: [],
  slots: [{ id: "images", prop: "images", label: "Images", cardinality: "many", accepts: ["shop.gallery-image"] }],
});
