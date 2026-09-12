import type { ComponentChildren, JSX } from "preact";

// A tiny in-pack markdown renderer (no WASM, no HTML passthrough): headings,
// paragraphs, lists, blockquotes, fenced code, hr, block images with captions
// and inline code / links / em / strong. Output is Preact vnodes, so authored
// text can never inject markup.

type Block =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "code"; code: string }
  | { kind: "rule" }
  | { kind: "image"; src: string; alt: string; title: string };

const IMAGE_LINE = /^!\[([^\]]*)\]\(\s*(\S+?)(?:\s+"([^"]*)")?\s*\)$/;
const ORDERED_ITEM = /^\d+[.)]\s+/;
const UNORDERED_ITEM = /^[-*+]\s+/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  const isBlockStart = (line: string) => /^(#{1,6}\s|>|```|([-*_])\2{2,}\s*$)/.test(line) || ORDERED_ITEM.test(line) || UNORDERED_ITEM.test(line) || IMAGE_LINE.test(line.trim());
  while (index < lines.length) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (trimmed === "") { index++; continue; }
    if (trimmed.startsWith("```")) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index]!.trim().startsWith("```")) code.push(lines[index++]!);
      index++;
      blocks.push({ kind: "code", code: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length <= 2 ? 2 : 3, text: heading[2]!.replace(/\s+#+\s*$/, "") });
      index++;
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(trimmed.replace(/\s/g, ""))) { blocks.push({ kind: "rule" }); index++; continue; }
    const image = IMAGE_LINE.exec(trimmed);
    if (image) { blocks.push({ kind: "image", alt: image[1]!, src: image[2]!, title: image[3] ?? "" }); index++; continue; }
    if (trimmed.startsWith(">")) {
      const quoted: string[] = [];
      while (index < lines.length && lines[index]!.trim().startsWith(">")) quoted.push(lines[index++]!.trim().replace(/^>\s?/, ""));
      blocks.push({ kind: "quote", blocks: parseMarkdown(quoted.join("\n")) });
      continue;
    }
    const ordered = ORDERED_ITEM.test(trimmed);
    if (ordered || UNORDERED_ITEM.test(trimmed)) {
      const marker = ordered ? ORDERED_ITEM : UNORDERED_ITEM;
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index]!.trim();
        if (marker.test(current)) { items.push(current.replace(marker, "")); index++; continue; }
        if (current !== "" && !isBlockStart(current) && items.length > 0) { items[items.length - 1] += ` ${current}`; index++; continue; }
        break;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim() !== "" && (paragraph.length === 0 || !isBlockStart(lines[index]!.trim()))) paragraph.push(lines[index++]!.trim());
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

export function safeHref(href: string): string | undefined {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(href) ? href : undefined;
}

const INLINE = /(`[^`]+`)|(\[([^\]]+)\]\(\s*(\S+?)\s*\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*|_([^_]+)_)/;

export function renderInline(text: string): ComponentChildren[] {
  const output: ComponentChildren[] = [];
  let rest = text;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) { output.push(rest); break; }
    if (match.index > 0) output.push(rest.slice(0, match.index));
    const [whole, code, link, linkText, linkHref, strong, strongText, em, emStar, emUnderscore] = match;
    if (code) output.push(<code class="bg-blog-surface px-blog-hsp-xs font-blog-mono text-blog-code">{code.slice(1, -1)}</code>);
    else if (link) {
      const href = safeHref(linkHref!);
      output.push(href
        ? <a class="text-blog-link underline decoration-current underline-offset-3 hover:text-blog-fg-strong" href={href}>{renderInline(linkText!)}</a>
        : linkText);
    } else if (strong) output.push(<strong class="font-blog-semibold">{renderInline(strongText!)}</strong>);
    else if (em) output.push(<em>{renderInline(emStar ?? emUnderscore!)}</em>);
    rest = rest.slice(match.index + whole.length);
  }
  return output;
}

const DROP_CAP = "first-letter:float-left first-letter:mr-blog-hsp-xs first-letter:font-blog-semibold first-letter:text-blog-drop-cap first-letter:text-blog-accent";

function renderBlock(block: Block, key: number, dropCap: boolean): JSX.Element {
  switch (block.kind) {
    case "heading":
      return block.level === 2
        ? <h2 key={key} class="mt-blog-vsp-md font-blog-serif text-blog-h2 font-blog-semibold text-blog-fg-strong">{renderInline(block.text)}</h2>
        : <h3 key={key} class="mt-blog-vsp-md font-blog-serif text-blog-h3 font-blog-semibold text-blog-fg-strong">{renderInline(block.text)}</h3>;
    case "paragraph":
      return <p key={key} class={`mt-blog-vsp-sm${dropCap ? ` ${DROP_CAP}` : ""}`}>{renderInline(block.text)}</p>;
    case "list": {
      const items = block.items.map((item, index) => <li key={index} class="mt-blog-vsp-xs">{renderInline(item)}</li>);
      return block.ordered
        ? <ol key={key} class="mt-blog-vsp-sm list-decimal pl-blog-hsp-md">{items}</ol>
        : <ul key={key} class="mt-blog-vsp-sm list-disc pl-blog-hsp-md">{items}</ul>;
    }
    case "quote":
      return <blockquote key={key} class="mt-blog-vsp-md border-l-2 border-blog-border pl-blog-hsp-md italic text-blog-fg">{block.blocks.map((inner, index) => renderBlock(inner, index, false))}</blockquote>;
    case "code":
      return <pre key={key} class="mt-blog-vsp-md overflow-x-auto bg-blog-surface px-blog-hsp-sm py-blog-vsp-sm font-blog-mono text-blog-code"><code>{block.code}</code></pre>;
    case "rule":
      return <hr key={key} class="mt-blog-vsp-lg border-t border-blog-border" />;
    case "image": {
      const src = safeHref(block.src);
      return (
        <figure key={key} class="mt-blog-vsp-md">
          {src ? <img class="block w-full" src={src} alt={block.alt} loading="lazy" /> : null}
          {block.title ? <figcaption class="mt-blog-vsp-xs font-blog-sans text-blog-caption text-blog-muted">{block.title}</figcaption> : null}
        </figure>
      );
    }
  }
}

export interface ProseBodyProps {
  markdown?: string;
  dropCap?: boolean;
}

export function ProseBody({ markdown = "", dropCap = false }: ProseBodyProps) {
  const blocks = parseMarkdown(markdown);
  const firstParagraph = dropCap ? blocks.findIndex((block) => block.kind === "paragraph") : -1;
  return (
    <div class="mx-auto max-w-blog-measure font-blog-serif text-blog-body text-blog-fg [&>:first-child]:mt-[0]">
      {blocks.map((block, index) => renderBlock(block, index, index === firstParagraph))}
    </div>
  );
}
