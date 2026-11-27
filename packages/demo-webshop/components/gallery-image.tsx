import { defineComponent } from "@zudo-composer/component-contract";
import { computed, type Ref } from "@takazudo/zfb/zudo-react";
import { linkItem, type ItemHost } from "./item-registry";
import { slotLink } from "./slot-link";

export interface GalleryImageData {
  src: string;
  alt: string;
}

/** Answered by `shop.product-gallery`; the view is whether the gallery hides this image. */
export const GALLERY_IMAGE_LINK = slotLink<ItemHost<GalleryImageData, boolean>>("shop-gallery-image");

export interface GalleryImageProps {
  src: string;
  alt: string;
}

/** Outside a gallery (Composer canvas, static authoring) the image is always shown. An empty URL never registers. */
export function GalleryImage({ src = "", alt = "" }: GalleryImageProps) {
  if (src === "") return null;
  const element: Ref<HTMLImageElement> = { current: null };
  const hidden = linkItem(GALLERY_IMAGE_LINK, { src, alt }, element);
  return <img ref={element} src={src} alt={alt} hidden={computed(() => hidden.value ?? false)} class="block aspect-square w-full bg-shop-surface object-cover" />;
}

export const galleryImageComponent = defineComponent<GalleryImageProps>()(GalleryImage, {
  id: "shop.gallery-image",
  schemaVersion: 1,
  title: "Gallery image",
  category: "Product",
  description: "One square product image inside a product gallery. An empty URL renders nothing.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "GalleryImage" },
  defaults: { src: "", alt: "" },
  fields: [
    { kind: "text", prop: "src", label: "Image" },
    { kind: "text", prop: "alt", label: "Alt text" },
  ],
});
