import { defineComponent } from "@zudo-composer/component-contract";
import type { ComponentChildren } from "preact";

export interface GridProps {
  columns: "2" | "3" | "4";
  gap: "md" | "lg";
  items?: ComponentChildren;
}

// Literal strings so Tailwind's scanner sees every class: 1 / 2 / 3 / 4 columns at sm / lg / xl.
const COLUMNS = {
  "2": "grid-cols-1 shop-sm:grid-cols-2",
  "3": "grid-cols-1 shop-sm:grid-cols-2 shop-lg:grid-cols-3",
  "4": "grid-cols-1 shop-sm:grid-cols-2 shop-lg:grid-cols-3 shop-xl:grid-cols-4",
} as const;
const GAP = { md: "gap-x-shop-hsp-md gap-y-shop-vsp-md", lg: "gap-x-shop-hsp-lg gap-y-shop-vsp-lg" } as const;

export function Grid({ columns = "3", gap = "md", items }: GridProps) {
  return <div class={`grid ${COLUMNS[columns] ?? COLUMNS["3"]} ${GAP[gap] ?? GAP.md}`}>{items}</div>;
}

export const gridComponent = defineComponent<GridProps>()(Grid, {
  id: "shop.grid",
  schemaVersion: 1,
  title: "Grid",
  category: "Layout",
  description: "Responsive columns: one, then up to the chosen count at sm / lg / xl.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "Grid" },
  defaults: { columns: "3", gap: "md" },
  fields: [
    { kind: "select", prop: "columns", label: "Columns", options: ["2", "3", "4"] },
    { kind: "select", prop: "gap", label: "Gap", options: ["md", "lg"] },
  ],
  slots: [{ id: "items", prop: "items", label: "Items", cardinality: "many" }],
});
