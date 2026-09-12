import { defineComponent } from "@zudo-composer/component-contract";

export interface CategoryTileProps {
  label: string;
  href: string;
  src: string;
  alt: string;
  caption: string;
}

export function CategoryTile({ label = "Category", href = "#", src = "", alt = "", caption = "" }: CategoryTileProps) {
  return (
    <a href={href} class="group flex flex-col gap-shop-vsp-sm bg-shop-bg hover:bg-shop-inverse-bg hover:text-shop-inverse-fg">
      <div class="aspect-square w-full bg-shop-surface">
        {src !== "" && <img src={src} alt={alt} loading="lazy" class="block h-full w-full object-cover" />}
      </div>
      <div class="flex flex-col gap-shop-vsp-xs px-shop-hsp-xs pb-shop-vsp-sm">
        <h3 class="text-shop-h3 font-shop-semibold text-shop-fg-strong group-hover:text-shop-inverse-fg">{label}</h3>
        {caption !== "" && <p class="text-shop-caption text-shop-muted group-hover:text-shop-inverse-fg">{caption}</p>}
      </div>
    </a>
  );
}

export const categoryTileComponent = defineComponent<CategoryTileProps>()(CategoryTile, {
  id: "shop.category-tile",
  schemaVersion: 1,
  title: "Category tile",
  category: "Catalog",
  description: "Home shelf tile: square image, label and a short caption.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "CategoryTile" },
  defaults: { label: "Category", href: "#", src: "", alt: "", caption: "" },
  fields: [
    { kind: "text", prop: "label", label: "Label" },
    { kind: "text", prop: "href", label: "URL" },
    { kind: "text", prop: "src", label: "Image URL" },
    { kind: "text", prop: "alt", label: "Image alt" },
    { kind: "text", prop: "caption", label: "Caption" },
  ],
});
