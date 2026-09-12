import { createContext, type ComponentChildren } from "preact";
import { useContext, useId } from "preact/hooks";
import { Icon } from "./icons";
import { Markdown } from "./prose";

/** `group` is the shared `<details name>` that makes the rows exclusive; absent = independent rows. */
const FaqContext = createContext<{ group: string | undefined } | null>(null);

export interface FaqAccordionProps {
  allowMultiple: boolean;
  items?: ComponentChildren;
}

export function FaqAccordion({ allowMultiple, items }: FaqAccordionProps) {
  const id = useId();
  return (
    <FaqContext.Provider value={{ group: allowMultiple ? undefined : `faq-${id}` }}>
      <div class="mx-auto flex w-full max-w-land-narrow flex-col gap-land-vsp-xs">{items}</div>
    </FaqContext.Provider>
  );
}

export interface FaqItemProps {
  question: string;
  answer: string;
  /** Filter key for Mapping query conditions (`topic equals billing`). */
  topic: "general" | "billing" | "security";
  /** Sort key the Mapping query orders by. */
  order: number;
}

export function FaqItem({ question, answer, topic }: FaqItemProps) {
  const group = useContext(FaqContext)?.group;
  // `<details name>` is exclusive natively; closing siblings by hand covers engines without it.
  const onToggle = (event: Event) => {
    const details = event.currentTarget as HTMLDetailsElement;
    if (!group || !details.open) return;
    for (const other of details.ownerDocument.querySelectorAll<HTMLDetailsElement>("details[name]")) {
      if (other !== details && other.getAttribute("name") === group) other.open = false;
    }
  };
  return (
    <details name={group} data-topic={topic} onToggle={onToggle} class="group rounded-land-md border border-land-border bg-land-surface">
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
