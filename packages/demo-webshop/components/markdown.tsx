import type { ComponentChildren, JSX } from "preact";

// A deliberately tiny markdown subset (h2/h3, paragraphs, lists, links,
// emphasis, rules) rendered straight to Preact nodes: no HTML strings, no WASM.

const LINK_CLASS = "text-shop-link underline decoration-shop-border underline-offset-4 hover:bg-shop-inverse-bg hover:text-shop-inverse-fg";
const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/;

function safeHref(href: string): string | undefined {
  return /^(https?:\/\/|mailto:|\/|#)/.test(href) ? href : undefined;
}

export function renderInline(text: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let rest = text;
  while (rest !== "") {
    const match = INLINE.exec(rest);
    if (!match) {
      out.push(rest);
      break;
    }
    if (match.index > 0) out.push(rest.slice(0, match.index));
    const [whole, linkText, href, strong, em, emUnderscore] = match;
    if (linkText !== undefined) {
      const target = safeHref(href!);
      out.push(target ? <a class={LINK_CLASS} href={target}>{renderInline(linkText)}</a> : linkText);
    } else if (strong !== undefined) {
      out.push(<strong class="font-shop-semibold text-shop-fg-strong">{renderInline(strong)}</strong>);
    } else {
      out.push(<em>{renderInline(em ?? emUnderscore!)}</em>);
    }
    rest = rest.slice(match.index + whole.length);
  }
  return out;
}

type Block =
  | { kind: "h2" | "h3" | "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "hr" };

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (line === "") flush();
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
      blocks.push({ kind: "hr" });
    } else if (heading) {
      flush();
      blocks.push({ kind: heading[1]!.length === 3 ? "h3" : "h2", text: heading[2]! });
    } else if (bullet || numbered) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? numbered)![1]!;
      const last = blocks.at(-1);
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else paragraph.push(line);
  }
  flush();
  return blocks;
}

function renderBlock(block: Block, key: number): JSX.Element {
  switch (block.kind) {
    case "h2":
      return <h2 key={key} class="text-shop-h2 font-shop-semibold text-shop-fg-strong">{renderInline(block.text)}</h2>;
    case "h3":
      return <h3 key={key} class="text-shop-h3 font-shop-semibold text-shop-fg-strong">{renderInline(block.text)}</h3>;
    case "p":
      return <p key={key}>{renderInline(block.text)}</p>;
    case "hr":
      return <hr key={key} class="border-shop-border" />;
    case "ul":
    case "ol": {
      const List = block.kind;
      return (
        <List key={key} class={`flex flex-col gap-shop-vsp-xs pl-shop-hsp-md ${block.kind === "ul" ? "list-disc" : "list-decimal"}`}>
          {block.items.map((item, index) => <li key={index}>{renderInline(item)}</li>)}
        </List>
      );
    }
  }
}

export function Markdown({ source }: { source: string }) {
  return <>{parseBlocks(source).map(renderBlock)}</>;
}
