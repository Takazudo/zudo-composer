import { defineComponent } from "@zudo-composer/component-contract";
import { useRef, useState } from "preact/hooks";

export interface ProductGalleryProps {
  src1: string;
  alt1: string;
  src2: string;
  alt2: string;
  src3: string;
  alt3: string;
}

const NEXT_KEYS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function ProductGallery({ src1 = "", alt1 = "", src2 = "", alt2 = "", src3 = "", alt3 = "" }: ProductGalleryProps) {
  const images = [
    { src: src1, alt: alt1 },
    { src: src2, alt: alt2 },
    { src: src3, alt: alt3 },
  ].filter((image) => image.src !== "");
  const [selected, setSelected] = useState(0);
  const thumbs = useRef<HTMLDivElement>(null);
  const current = Math.min(selected, Math.max(0, images.length - 1));
  const main = images[current];

  const select = (index: number) => {
    const next = (index + images.length) % images.length;
    setSelected(next);
    thumbs.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = NEXT_KEYS[event.key];
    const target = step !== undefined ? current + step : event.key === "Home" ? 0 : event.key === "End" ? images.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    select(target);
  };

  return (
    <div class="flex flex-col gap-shop-vsp-sm">
      <div class="aspect-square w-full bg-shop-surface">
        {main && <img src={main.src} alt={main.alt} class="block h-full w-full object-cover" />}
      </div>
      {images.length >= 2 && (
        // Roving focus: one tab stop, arrow keys move the selection (and focus) between thumbnails.
        <div ref={thumbs} role="group" aria-label="Product images" onKeyDown={onKeyDown} class="grid grid-cols-4 gap-shop-hsp-xs">
          {images.map((image, index) => (
            <button
              key={image.src}
              type="button"
              aria-label={`Show image ${index + 1} of ${images.length}`}
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
  );
}

export const productGalleryComponent = defineComponent<ProductGalleryProps>()(ProductGallery, {
  id: "shop.product-gallery",
  schemaVersion: 1,
  title: "Product gallery",
  category: "Product",
  description: "Square main image with thumbnails when two or more images are set; arrow keys move the selection. An empty URL means no image.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "ProductGallery" },
  defaults: { src1: "", alt1: "", src2: "", alt2: "", src3: "", alt3: "" },
  fields: [
    { kind: "text", prop: "src1", label: "Image 1 URL" },
    { kind: "text", prop: "alt1", label: "Image 1 alt" },
    { kind: "text", prop: "src2", label: "Image 2 URL" },
    { kind: "text", prop: "alt2", label: "Image 2 alt" },
    { kind: "text", prop: "src3", label: "Image 3 URL" },
    { kind: "text", prop: "alt3", label: "Image 3 alt" },
  ],
});
