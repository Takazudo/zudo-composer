import { flattenChildren, getScope, h, isDescription, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { Icon } from "./icons";
import { Markdown } from "./prose";
import { answerLink, requestLink, slotLink } from "./slot-link";

/** The shared `<details name>` that makes the rows exclusive; null = independent rows. */
const FAQ_GROUP_LINK = slotLink<string | null>("land-faq-group");

export interface FaqAccordionProps {
  allowMultiple: boolean;
  items?: Child | object;
}

let nextGroup = 0;

export function FaqAccordion({ allowMultiple, items }: FaqAccordionProps) {
  const group = allowMultiple ? null : `faq-${nextGroup++}`;
  // Rows given directly get the group as a prop; opaque rows (Composer's keyed nodes) ask for it on activation.
  const rows = group === null
    ? (items as Child)
    : flattenChildren(items as Child).map((item) => (isDescription(item) && item.type === FaqItem ? h(FaqItem, { ...item.props, group }) : item));
  return (
    <div class="mx-auto flex w-full max-w-land-narrow flex-col gap-land-vsp-xs" on:land-faq-group={answerLink(FAQ_GROUP_LINK, group)}>
      {rows}
    </div>
  );
}

export interface FaqItemProps {
  question: string;
  answer: string;
  /** Filter key for Mapping query conditions (`topic equals billing`). */
  topic: "general" | "billing" | "security";
  /** Sort key the Mapping query orders by. */
  order: number;
  /** Set by `land.faq-accordion` for rows it renders directly. */
  group?: string | null;
}

export function FaqItem({ question, answer, topic, group }: FaqItemProps) {
  const element: Ref<HTMLDetailsElement> = { current: null };
  const name = signal<string | null>(group ?? null);
  if (group === undefined) {
    getScope().onActivate(() => {
      const linked = requestLink(FAQ_GROUP_LINK, element.current);
      if (linked !== undefined) name.value = linked;
    });
  }
  // `<details name>` is exclusive natively; closing siblings by hand covers engines without it.
  const onToggle = (event: Event) => {
    const details = event.currentTarget as HTMLDetailsElement;
    const shared = name.value;
    if (!shared || !details.open) return;
    for (const other of details.ownerDocument.querySelectorAll<HTMLDetailsElement>("details[name]")) {
      if (other !== details && other.getAttribute("name") === shared) other.open = false;
    }
  };
  return (
    <details ref={element} name={name} data-topic={topic} on:toggle={onToggle} class="group rounded-land-md border border-land-border bg-land-surface">
      <summary class="flex cursor-pointer list-none items-center justify-between gap-land-hsp-sm rounded-land-md px-land-hsp-md py-land-vsp-sm text-land-h3 text-land-fg-strong hover:bg-land-surface-2 [&::-webkit-details-marker]:hidden">
        <span>{question}</span>
        <Icon name="plus" class="size-land-icon shrink-0 text-land-muted group-open:rotate-45" />
      </summary>
      <div class="flex flex-col gap-land-vsp-sm px-land-hsp-md pb-land-vsp-sm text-land-body text-land-fg">
        <Markdown source={answer} />
      </div>
    </details>
  );
}
