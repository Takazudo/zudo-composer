import { defineComponent } from "@zudo-composer/component-contract";

export interface ImageProps {
  src: string;
  alt: string;
  aspect: "1/1" | "4/3" | "16/9";
  caption: string;
}

const ASPECT = { "1/1": "aspect-square", "4/3": "aspect-[4/3]", "16/9": "aspect-video" } as const;

export function Image({ src = "", alt = "", aspect = "4/3", caption = "" }: ImageProps) {
  return (
    <figure class="flex flex-col gap-shop-vsp-xs">
      <div class={`w-full bg-shop-surface ${ASPECT[aspect] ?? ASPECT["4/3"]}`}>
        {src !== "" && <img src={src} alt={alt} loading="lazy" class="block h-full w-full object-cover" />}
      </div>
      {caption !== "" && <figcaption class="text-shop-caption text-shop-muted">{caption}</figcaption>}
    </figure>
  );
}

export const imageComponent = defineComponent<ImageProps>()(Image, {
  id: "shop.image",
  schemaVersion: 1,
  title: "Image",
  category: "Content",
  description: "Plain figure with a fixed aspect ratio and optional caption.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "Image" },
  defaults: { src: "", alt: "", aspect: "4/3", caption: "" },
  fields: [
    { kind: "text", prop: "src", label: "Image URL" },
    { kind: "text", prop: "alt", label: "Image alt" },
    { kind: "select", prop: "aspect", label: "Aspect", options: ["1/1", "4/3", "16/9"] },
    { kind: "text", prop: "caption", label: "Caption" },
  ],
});
