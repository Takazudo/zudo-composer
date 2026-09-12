import { defineComponent } from "@zudo-composer/component-contract";
import { createContext, type ComponentChildren } from "preact";
import { useId } from "preact/hooks";

export interface FaqAccordionProps {
  allowMultiple: boolean;
  items?: ComponentChildren;
}

/** The exclusive-accordion group name for `<details name>`; null when several rows may be open. */
export const FaqGroupContext = createContext<string | null>(null);

export function FaqAccordion({ allowMultiple = false, items }: FaqAccordionProps) {
  const group = useId();
  return (
    <FaqGroupContext.Provider value={allowMultiple ? null : `shop-faq-${group}`}>
      <div class="flex max-w-shop-prose flex-col border-t border-shop-border">{items}</div>
    </FaqGroupContext.Provider>
  );
}

export const faqAccordionComponent = defineComponent<FaqAccordionProps>()(FaqAccordion, {
  id: "shop.faq-accordion",
  schemaVersion: 1,
  title: "FAQ accordion",
  category: "Content",
  description: "List host of question rows; one open at a time unless several are allowed.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "FaqAccordion" },
  defaults: { allowMultiple: false },
  fields: [{ kind: "boolean", prop: "allowMultiple", label: "Allow several open" }],
  slots: [{ id: "items", prop: "items", label: "Questions", cardinality: "many", accepts: ["shop.faq-item"] }],
});
