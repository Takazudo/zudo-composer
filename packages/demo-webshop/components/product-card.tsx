import { defineComponent } from "@zudo-composer/component-contract";
import { useGridItem } from "./grid-context";
import { PriceTag } from "./price-tag";
import { StatusBadge, type Availability } from "./status-badge";
import { CAPS } from "./tone";

export interface ProductCardProps {
  name: string;
  href: string;
  src: string;
  alt: string;
  price: number;
  currency: string;
  category: "desk" | "carry" | "light";
  availability: Availability;
  stockLabel: string;
  slug: string;
  featured: boolean;
  tag1: string;
  tag2: string;
  tag3: string;
}

export function ProductCard({
  name = "Product",
  href = "#",
  src = "",
  alt = "",
  price = 0,
  currency = "USD",
  category = "desk",
  availability = "in-stock",
  stockLabel = "In stock",
  slug = "",
  featured = false,
  tag1 = "",
  tag2 = "",
  tag3 = "",
}: ProductCardProps) {
  const view = useGridItem({ name, price, category, featured, tags: [tag1, tag2, tag3].filter((tag) => tag !== "") });
  return (
    <a
      href={href}
      hidden={view.hidden}
      style={view.managed ? { order: view.order } : undefined}
      data-slug={slug || undefined}
      class="group flex flex-col gap-shop-vsp-sm bg-shop-bg text-shop-fg hover:bg-shop-inverse-bg hover:text-shop-inverse-fg"
    >
      <div class="aspect-square w-full bg-shop-surface">
        {src !== "" && <img src={src} alt={alt} loading="lazy" class="block h-full w-full object-cover" />}
      </div>
      <div class="flex flex-col gap-shop-vsp-xs px-shop-hsp-xs pb-shop-vsp-sm">
        <div class="flex items-baseline justify-between gap-shop-hsp-xs">
          <span class={`${CAPS} text-shop-muted group-hover:text-shop-inverse-fg`}>{category}</span>
          {availability !== "in-stock" && <StatusBadge availability={availability} label={stockLabel} />}
        </div>
        <h3 class="text-shop-h3 font-shop-semibold text-shop-fg-strong group-hover:text-shop-inverse-fg">{name}</h3>
        <span class="group-hover:[&>*]:text-shop-inverse-fg">
          <PriceTag price={price} currency={currency} size="body" />
        </span>
      </div>
    </a>
  );
}

export const productCardComponent = defineComponent<ProductCardProps>()(ProductCard, {
  id: "shop.product-card",
  schemaVersion: 1,
  title: "Product card",
  category: "Catalog",
  description: "One product; the whole card links to its page and hides itself when the grid filters it out.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "ProductCard" },
  defaults: {
    name: "Product",
    href: "#",
    src: "",
    alt: "",
    price: 0,
    currency: "USD",
    category: "desk",
    availability: "in-stock",
    stockLabel: "In stock",
    slug: "",
    featured: false,
    tag1: "",
    tag2: "",
    tag3: "",
  },
  fields: [
    { kind: "text", prop: "name", label: "Name" },
    { kind: "text", prop: "href", label: "URL" },
    { kind: "text", prop: "src", label: "Image URL" },
    { kind: "text", prop: "alt", label: "Image alt" },
    { kind: "number", prop: "price", label: "Price", min: 0, step: 0.01 },
    { kind: "text", prop: "currency", label: "Currency" },
    { kind: "select", prop: "category", label: "Category", options: ["desk", "carry", "light"] },
    { kind: "select", prop: "availability", label: "Availability", options: ["in-stock", "low-stock", "sold-out"] },
    { kind: "text", prop: "stockLabel", label: "Stock label" },
    { kind: "text", prop: "slug", label: "Slug" },
    { kind: "boolean", prop: "featured", label: "Featured" },
    { kind: "text", prop: "tag1", label: "Tag 1" },
    { kind: "text", prop: "tag2", label: "Tag 2" },
    { kind: "text", prop: "tag3", label: "Tag 3" },
  ],
});
