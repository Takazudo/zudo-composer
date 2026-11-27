import { defineComponent } from "@zudo-composer/component-contract";
import { flattenChildren, h, isDescription, type Child } from "@takazudo/zfb/zudo-react";
import { FAQ_GROUP_LINK } from "./faq-group";
import { FaqItem } from "./faq-item";
import { answerLink } from "./slot-link";

export interface FaqAccordionProps {
  allowMultiple: boolean;
  items?: Child | object;
}

let nextGroup = 0;

/** Question rows given directly get the group as a prop; opaque rows (Composer's keyed nodes) ask for it on activation. */
function withGroup(items: Child, group: string | null): Child {
  if (group === null) return items;
  return flattenChildren(items).map((item) => (isDescription(item) && item.type === FaqItem ? h(FaqItem, { ...item.props, group }) : item));
}

export function FaqAccordion({ allowMultiple = false, items }: FaqAccordionProps) {
  const group = allowMultiple ? null : `shop-faq-${nextGroup++}`;
  return (
    <div class="flex max-w-shop-prose flex-col border-t border-shop-border" on:shop-faq-group={answerLink(FAQ_GROUP_LINK, group)}>
      {withGroup(items as Child, group)}
    </div>
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
