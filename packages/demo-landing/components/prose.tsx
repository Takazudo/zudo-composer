import type { ComponentChildren } from "preact";

/** Text links: never accent; the underline darkens and thickens on hover. */
export const textLinkClass = "text-land-link underline decoration-land-border underline-offset-2 hover:decoration-land-fg-strong hover:decoration-2";

export type MarkdownBlock =
  | { kind: "h2" | "h3" | "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] };

/**
 * The tiny markdown subset the landing copy needs: headings (h1/h2 → h2,
 * deeper → h3), paragraphs, `-`/`*`/`1.` lists, and inline strong, em and links.
 * No HTML passes through; everything becomes Preact nodes.
 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  // Cast, not annotation: the closures below reassign it, which control-flow narrowing cannot see.
  let list = null as { kind: "ul" | "ol"; items: string[] } | null;
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: heading[1]!.length <= 2 ? "h2" : "h3", text: heading[2]! });
      continue;
    }
    const item = /^[-*+]\s+(.*)$/.exec(line) ?? /^\d+[.)]\s+(.*)$/.exec(line);
    if (item) {
      const kind = /^\d/.test(line) ? "ol" : "ul";
      flushParagraph();
      if (list?.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list!.items.push(item[1]!);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

const INLINE = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
const SAFE_HREF = /^(https?:|mailto:|\/|#)/i;

export function renderInline(text: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const [, strong, star, underscore, linkText, href] = match;
    if (strong !== undefined) out.push(<strong class="font-land-semibold text-land-fg-strong">{renderInline(strong)}</strong>);
    else if (star !== undefined || underscore !== undefined) out.push(<em>{renderInline((star ?? underscore)!)}</em>);
    else if (SAFE_HREF.test(href!)) out.push(<a href={href} class={textLinkClass}>{renderInline(linkText!)}</a>);
    else out.push(linkText);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  return (
    <>
      {parseMarkdown(source).map((block, index) => {
        switch (block.kind) {
          case "h2": return <h2 key={index} class="mt-land-vsp-sm text-land-h3 text-land-fg-strong first:mt-0">{renderInline(block.text)}</h2>;
          case "h3": return <h3 key={index} class="mt-land-vsp-xs text-land-body font-land-semibold text-land-fg-strong first:mt-0">{renderInline(block.text)}</h3>;
          case "p": return <p key={index}>{renderInline(block.text)}</p>;
          case "ul": return <ul key={index} class="flex list-disc flex-col gap-land-vsp-xs pl-land-hsp-md">{block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}</ul>;
          case "ol": return <ol key={index} class="flex list-decimal flex-col gap-land-vsp-xs pl-land-hsp-md">{block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}</ol>;
        }
      })}
    </>
  );
}

export interface ProseProps {
  markdown: string;
}

export function Prose({ markdown }: ProseProps) {
  return <div class="flex flex-col gap-land-vsp-sm text-land-body text-land-fg"><Markdown source={markdown} /></div>;
}

export interface ComparisonNoteProps {
  markdown: string;
}

export function ComparisonNote({ markdown }: ComparisonNoteProps) {
  return (
    <div class="mx-auto flex w-full max-w-land-narrow flex-col gap-land-vsp-xs rounded-land-md border border-land-border bg-land-surface p-land-hsp-md text-land-body text-land-fg">
      <Markdown source={markdown} />
    </div>
  );
}
