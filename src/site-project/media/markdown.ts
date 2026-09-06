import { commonmarkLanguage } from "@codemirror/lang-markdown";

export interface MarkdownMediaDestination { from: number; to: number; useFrom: number; useTo: number; value: string; kind: "link" | "image" }
type Node = ReturnType<typeof commonmarkLanguage.parser.parse>["topNode"];
const label = (value: string) => value.replace(/\s+/g, " ").trim().toUpperCase();
function decodeDestination(value: string): string {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1").replace(/&(?:#(\d+)|#x([a-f\d]+)|(amp|lt|gt|quot|apos|sol|colon|lowbar|period));/gi, (source, decimal: string, hex: string, named: string) => {
    if (named) return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", sol: "/", colon: ":", lowbar: "_", period: "." } as Record<string, string>)[named.toLowerCase()] ?? source;
    const point = Number.parseInt(decimal || hex, decimal ? 10 : 16);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "�";
  });
}
/** Only AST link/image destinations are eligible for rewriting. Titles, code,
 * raw HTML, surrounding prose, and unused reference definitions are untouched. */
export function markdownMediaDestinations(source: string): MarkdownMediaDestination[] {
  const tree = commonmarkLanguage.parser.parse(source), definitions = new Map<string, Node>();
  const uses: Node[] = [];
  tree.iterate({ enter(node) {
    if (node.name === "LinkReference") {
      const id = node.node.getChild("LinkLabel"), url = node.node.getChild("URL");
      if (id && url) { const key = label(source.slice(id.from + 1, id.to - 1)); if (!definitions.has(key)) definitions.set(key, url); }
    } else if (node.name === "Link" || node.name === "Image" || node.name === "Autolink") uses.push(node.node);
  } });
  return uses.flatMap((use) => {
    let url = use.getChild("URL");
    if (!url) {
      const reference = use.getChild("LinkLabel"), raw = reference ? source.slice(reference.from + 1, reference.to - 1) : "";
      const closing = use.getChildren("LinkMark").find((mark) => source.slice(mark.from, mark.to) === "]");
      const key = label(raw || source.slice(use.from + (use.name === "Image" ? 2 : 1), closing?.from ?? use.to - 1));
      url = definitions.get(key) ?? null;
    }
    if (!url) return [];
    let from = url.from, to = url.to;
    if (source[from] === "<" && source[to - 1] === ">") { from++; to--; }
    return [{ from, to, useFrom: use.from, useTo: use.to, value: decodeDestination(source.slice(from, to)), kind: use.name === "Image" ? "image" as const : "link" as const }];
  });
}
export function rewriteMarkdownDestinations(source: string, resolve: (destination: MarkdownMediaDestination) => string | undefined): string {
  const edits = new Map<string, { from: number; to: number; value: string }>();
  for (const destination of markdownMediaDestinations(source)) {
    const value = resolve(destination);
    if (value !== undefined && value !== destination.value) edits.set(`${destination.from}:${destination.to}`, { ...destination, value });
  }
  let output = source;
  for (const edit of [...edits.values()].sort((a, b) => b.from - a.from)) output = output.slice(0, edit.from) + edit.value + output.slice(edit.to);
  return output;
}
