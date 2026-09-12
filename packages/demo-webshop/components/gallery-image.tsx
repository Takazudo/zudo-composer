import { defineComponent } from "@zudo-composer/component-contract";
import { createContext } from "preact";
import { useContext, useId, useLayoutEffect } from "preact/hooks";
import type { GridRegistry } from "./grid-context";

export interface GalleryImageData {
  src: string;
  alt: string;
}

export const GalleryRegistryContext = createContext<GridRegistry<GalleryImageData> | null>(null);
/** The registered id of the image the gallery shows; null until the gallery has registrations. */
export const GallerySelectionContext = createContext<string | null>(null);

export interface GalleryImageProps {
  src: string;
  alt: string;
}

/** Outside a gallery (Composer canvas, static authoring) the image is always shown. */
export function GalleryImage({ src = "", alt = "" }: GalleryImageProps) {
  const registry = useContext(GalleryRegistryContext);
  const selectedId = useContext(GallerySelectionContext);
  const id = useId();
  useLayoutEffect(() => {
    if (src === "") registry?.unregister(id);
    else registry?.register(id, { src, alt });
  }, [registry, id, src, alt]);
  useLayoutEffect(() => () => registry?.unregister(id), [registry, id]);
  if (src === "") return null;
  return <img src={src} alt={alt} hidden={selectedId !== null && selectedId !== id} class="block aspect-square w-full bg-shop-surface object-cover" />;
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
    { kind: "text", prop: "src", label: "Image URL" },
    { kind: "text", prop: "alt", label: "Alt text" },
  ],
});
