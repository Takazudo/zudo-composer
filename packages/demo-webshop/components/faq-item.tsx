import { defineComponent } from "@zudo-composer/component-contract";
import { useContext } from "preact/hooks";
import { FaqGroupContext } from "./faq-accordion";
import { Markdown } from "./markdown";

export interface FaqItemProps {
  question: string;
  answer: string;
  order: number;
}

export function FaqItem({ question = "Question", answer = "", order = 0 }: FaqItemProps) {
  const group = useContext(FaqGroupContext);
  return (
    <details name={group ?? undefined} style={{ order }} class="group border-b border-shop-border bg-shop-surface">
      <summary class="flex cursor-pointer items-center justify-between gap-shop-hsp-md px-shop-hsp-sm py-shop-vsp-sm text-shop-h3 font-shop-semibold text-shop-fg-strong hover:bg-shop-inverse-bg hover:text-shop-inverse-fg [&::-webkit-details-marker]:hidden list-none">
        {question}
        <span aria-hidden="true" class="font-shop-mono text-shop-faint group-open:hidden">+</span>
        <span aria-hidden="true" class="hidden font-shop-mono text-shop-faint group-open:inline">−</span>
      </summary>
      <div class="flex flex-col gap-shop-vsp-sm px-shop-hsp-sm pb-shop-vsp-md text-shop-body text-shop-fg">
        <Markdown source={answer} />
      </div>
    </details>
  );
}

export const faqItemComponent = defineComponent<FaqItemProps>()(FaqItem, {
  id: "shop.faq-item",
  schemaVersion: 1,
  title: "FAQ item",
  category: "Content",
  description: "One question with a markdown answer; square with a 1px bottom rule.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "FaqItem" },
  defaults: { question: "Question", answer: "Answer.", order: 0 },
  fields: [
    { kind: "text", prop: "question", label: "Question" },
    { prop: "answer", label: "Answer", schema: { type: "string" }, editor: { kind: "text", multiline: true, mode: "markdown-source" } },
    { kind: "number", prop: "order", label: "Order", step: 1 },
  ],
});
