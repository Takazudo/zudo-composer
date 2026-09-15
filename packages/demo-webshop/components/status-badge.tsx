import { defineComponent } from "@zudo-composer/component-contract";
import { CAPS } from "./tone";

export type Availability = "in-stock" | "low-stock" | "sold-out";

export interface StatusBadgeProps {
  availability: Availability;
  label: string;
}

// low-stock is one of the accent's few permitted uses (§ 3); nothing else here is chromatic.
const TONE = { "in-stock": "text-shop-muted", "low-stock": "text-shop-accent", "sold-out": "text-shop-danger" } as const;

export function StatusBadge({ availability = "in-stock", label = "In stock" }: StatusBadgeProps) {
  return <span class={`${CAPS} ${TONE[availability] ?? TONE["in-stock"]}`}>{label}</span>;
}

export const statusBadgeComponent = defineComponent<StatusBadgeProps>()(StatusBadge, {
  id: "shop.status-badge",
  schemaVersion: 1,
  title: "Status badge",
  category: "Catalog",
  description: "Uppercase stock caption coloured by availability.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "StatusBadge" },
  defaults: { availability: "in-stock", label: "In stock" },
  fields: [
    { kind: "select", prop: "availability", label: "Availability", options: ["in-stock", "low-stock", "sold-out"] },
    { kind: "text", prop: "label", label: "Label" },
  ],
});
