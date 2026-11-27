import { defineComponent } from "@zudo-composer/component-contract";
import { For, Show, computed, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { GALLERY_IMAGE_LINK, type GalleryImageData } from "./gallery-image";
import { createItemRegistry } from "./item-registry";
import { answerLink } from "./slot-link";

// Images arrive as `shop.gallery-image` children rather than src1/src2 props:
// the Assets pass pins only props named src/href/poster/url
// (src/site-project/assets/impact.ts), so a numbered prop would never resolve.
export interface ProductGalleryProps {
  images?: Child | object;
}

const NEXT_KEYS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function ProductGallery({ images }: ProductGalleryProps) {
  const selected = signal(0);
  const thumbs: Ref<HTMLDivElement> = { current: null };
  const { ordered, host } = createItemRegistry<GalleryImageData, boolean>(() => hiddenById.value);
  const current = computed(() => Math.min(selected.value, Math.max(0, ordered.value.length - 1)));
  const hiddenById: ReadonlySignal<ReadonlyMap<string, boolean>> = computed(() => {
    const shown = ordered.value[current.value]?.[0];
    return new Map(ordered.value.map(([id]) => [id, id !== shown]));
  });

  const select = (index: number) => {
    const count = ordered.value.length;
    const next = (index + count) % count;
    selected.value = next;
    thumbs.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = NEXT_KEYS[event.key];
    const target = step !== undefined ? current.value + step : event.key === "Home" ? 0 : event.key === "End" ? ordered.value.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    select(target);
  };

  return (
    <div class="flex flex-col gap-shop-vsp-sm" on:shop-gallery-image={answerLink(GALLERY_IMAGE_LINK, host)}>
      <div class="aspect-square w-full overflow-hidden bg-shop-surface">{images as Child}</div>
      <Show when={computed(() => ordered.value.length >= 2)}>
        {() => (
          // Roving focus: one tab stop, arrow keys move the selection (and focus) between thumbnails.
          <div ref={thumbs} role="group" aria-label="Product images" on:keydown={onKeyDown} class="grid grid-cols-4 gap-shop-hsp-xs">
            <For each={ordered} by={([id]) => id}>
              {(entry, index) => {
                const active = computed(() => index.value === current.value);
                return (
                  <button
                    type="button"
                    aria-label={computed(() => `Show image ${index.value + 1} of ${ordered.value.length}`)}
                    aria-pressed={active}
                    tabindex={computed(() => (active.value ? 0 : -1))}
                    on:click={() => {
                      selected.value = index.value;
                    }}
                    class={computed(() => `aspect-square bg-shop-surface border ${active.value ? "border-shop-fg-strong" : "border-shop-bg hover:border-shop-border"}`)}
                  >
                    <img src={computed(() => entry.value[1].src)} alt="" loading="lazy" class="block h-full w-full object-cover" />
                  </button>
                );
              }}
            </For>
          </div>
        )}
      </Show>
    </div>
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
