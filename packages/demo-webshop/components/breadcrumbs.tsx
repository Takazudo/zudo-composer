import { defineComponent } from "@zudo-composer/component-contract";
import { HOVER_INVERT } from "./tone";

export interface BreadcrumbItem {
  label: string;
  href: string;
}

export interface BreadcrumbsProps {
  items: readonly BreadcrumbItem[];
}

const DEFAULT_ITEMS: readonly BreadcrumbItem[] = [
  { label: "Home", href: "/" },
  { label: "All products", href: "/products" },
];

export function Breadcrumbs({ items = DEFAULT_ITEMS }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" class="py-shop-vsp-sm">
      <ol class="flex flex-wrap items-center gap-shop-hsp-xs text-shop-caption text-shop-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={index} class="flex items-center gap-shop-hsp-xs">
              {last ? (
                <span aria-current="page" class="text-shop-fg">{item.label}</span>
              ) : (
                <>
                  <a href={item.href} class={`text-shop-muted ${HOVER_INVERT}`}>{item.label}</a>
                  <span aria-hidden="true">›</span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export const breadcrumbsComponent = defineComponent<BreadcrumbsProps>()(Breadcrumbs, {
  id: "shop.breadcrumbs",
  schemaVersion: 1,
  title: "Breadcrumbs",
  category: "Chrome",
  description: "Home › category › product trail from static items.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "Breadcrumbs" },
  defaults: { items: [{ label: "Home", href: "/" }, { label: "All products", href: "/products" }] },
  fields: [
    {
      prop: "items",
      label: "Items",
      schema: {
        type: "array",
        items: {
          schema: {
            type: "object",
            fields: [
              { key: "label", label: "Label", required: true, schema: { type: "string" }, editor: { kind: "text" } },
              { key: "href", label: "URL", required: true, schema: { type: "string" }, editor: { kind: "text" } },
            ],
          },
          editor: { kind: "group" },
        },
      },
      editor: { kind: "list" },
    },
  ],
});
