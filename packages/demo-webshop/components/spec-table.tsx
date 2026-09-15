import { defineComponent } from "@zudo-composer/component-contract";

export interface SpecTableProps {
  spec1Label: string;
  spec1Value: string;
  spec2Label: string;
  spec2Value: string;
  spec3Label: string;
  spec3Value: string;
  spec4Label: string;
  spec4Value: string;
  spec5Label: string;
  spec5Value: string;
  spec6Label: string;
  spec6Value: string;
}

const INDEXES = [1, 2, 3, 4, 5, 6] as const;

export function specRows(props: Partial<SpecTableProps>): { label: string; value: string }[] {
  return INDEXES.map((index) => ({ label: props[`spec${index}Label`] ?? "", value: props[`spec${index}Value`] ?? "" })).filter(
    (row) => row.label.trim() !== "" && row.value.trim() !== "",
  );
}

export function SpecTable(props: SpecTableProps) {
  const rows = specRows(props);
  if (rows.length === 0) return null;
  return (
    <table class="w-full max-w-shop-prose border-collapse border-t border-shop-border text-left">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} class="border-b border-shop-border">
            <th scope="row" class="w-1/3 py-shop-vsp-sm pr-shop-hsp-md align-top text-shop-caption font-shop-normal text-shop-muted">{row.label}</th>
            <td class="py-shop-vsp-sm font-shop-mono text-shop-body text-shop-fg-strong">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const DEFAULT_LABELS = ["Material", "Dimensions", "Weight", "Origin", "Care", "Warranty"];

export const specTableComponent = defineComponent<SpecTableProps>()(SpecTable, {
  id: "shop.spec-table",
  schemaVersion: 1,
  title: "Spec table",
  category: "Product",
  description: "Label / value rows in mono; a row with an empty label or value is skipped.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "SpecTable" },
  defaults: Object.fromEntries(INDEXES.flatMap((index) => [[`spec${index}Label`, DEFAULT_LABELS[index - 1]], [`spec${index}Value`, ""]])) as unknown as SpecTableProps,
  fields: INDEXES.flatMap((index) => [
    { kind: "text", prop: `spec${index}Label`, label: `Spec ${index} label` },
    { kind: "text", prop: `spec${index}Value`, label: `Spec ${index} value` },
  ] as const),
});
