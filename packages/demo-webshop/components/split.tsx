import { defineComponent } from "@zudo-composer/component-contract";
import type { Child } from "@takazudo/zfb/zudo-react";

export interface SplitProps {
  ratio: "1/1" | "2/3" | "3/2";
  // A single slot: the contract types it framework-neutrally, bigint included.
  left?: Child | object | bigint;
  right?: Child | object;
}

const RATIO = {
  "1/1": "shop-md:grid-cols-[1fr_1fr]",
  "2/3": "shop-md:grid-cols-[2fr_3fr]",
  "3/2": "shop-md:grid-cols-[3fr_2fr]",
} as const;

export function Split({ ratio = "1/1", left, right }: SplitProps) {
  return (
    <div class={`grid grid-cols-1 gap-shop-vsp-md ${RATIO[ratio] ?? RATIO["1/1"]} shop-md:gap-shop-hsp-xl`}>
      <div>{left as Child}</div>
      <div class="flex flex-col gap-shop-vsp-md">{right as Child}</div>
    </div>
  );
}

export const splitComponent = defineComponent<SplitProps>()(Split, {
  id: "shop.split",
  schemaVersion: 1,
  title: "Split",
  category: "Layout",
  description: "Two columns from md.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "Split" },
  defaults: { ratio: "1/1" },
  fields: [{ kind: "select", prop: "ratio", label: "Ratio", options: ["1/1", "2/3", "3/2"] }],
  slots: [
    { id: "left", prop: "left", label: "Left", cardinality: "single" },
    { id: "right", prop: "right", label: "Right", cardinality: "many" },
  ],
});
