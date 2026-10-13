import { marked, Renderer } from "marked";
function attribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
}
/** Defense in depth for the trusted saved source: never evaluate HTML/MDX or unapproved images. */
export function renderHostMarkdown(source: string): string {
  const renderer = new Renderer();
  renderer.html = () => { throw Error("Host Notes do not permit raw HTML"); };
  renderer.image = () => { throw Error("Host images must use the approved Content asset field"); };
  renderer.link = function ({ href, title, tokens }) {
    let decoded = href;
    try { for (let count = 0; count < 3; count++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } }
    catch { throw Error("Malformed Notes link"); }
    if ([...decoded].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || /^(?:javascript|vbscript|data):/i.test(decoded.replaceAll(" ", "")) || decoded.startsWith("//")) throw Error("Unsafe Notes link");
    const resolved = new URL(decoded, "https://fixture.invalid/");
    if (!["https:", "http:", "mailto:"].includes(resolved.protocol) || resolved.username || resolved.password) throw Error("Unsafe Notes link");
    return `<a href="${attribute(href)}"${title ? ` title="${attribute(title)}"` : ""}>${this.parser.parseInline(tokens)}</a>`;
  };
  const html = marked.parse(source, { renderer, async: false, gfm: true });
  if (typeof html !== "string") throw Error("Host Notes rendering must complete synchronously");
  return html;
}
