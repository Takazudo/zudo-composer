// A textual safety policy for `markdown` Content values submitted by a
// restricted hosted editor. It never renders Markdown: it rejects the
// constructs that can smuggle HTML, scripts or foreign URLs into a document
// so the host's renderer only ever sees prose and allowlisted links. The host
// renderer must still sanitize its own HTML output.

export interface MarkdownContentPolicy {
  /** Raw HTML is never permitted through this role; the literal type says so. */
  readonly allowHtml: false;
  readonly allowImages: boolean;
  /** Link protocols accepted in `[..](url)`, `<url>` and `[ref]: url`, with the trailing colon. */
  readonly allowedLinkProtocols: readonly string[];
  readonly maxLength: number;
}

export const DEFAULT_MARKDOWN_CONTENT_POLICY: MarkdownContentPolicy = Object.freeze({
  allowHtml: false,
  allowImages: false,
  allowedLinkProtocols: Object.freeze(["http:", "https:", "mailto:", "tel:"]),
  maxLength: 100_000,
});

export type MarkdownContentDiagnosticCode = "too-long" | "html-not-allowed" | "image-not-allowed" | "unsafe-link";

export interface MarkdownContentDiagnostic {
  code: MarkdownContentDiagnosticCode;
  message: string;
  /** Character offset of the offending construct. */
  offset: number;
}

// A tag name is followed by whitespace, `/` or `>`; an autolink such as
// `<https://…>` continues with `:` and is therefore not a tag.
const HTML_PATTERN = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:[\s/>]|$)|<!--|<!\[CDATA\[|<\?/g;
const INLINE_LINK_PATTERN = /(!?)\[[^\]]*\]\(\s*<?([^\s)>]*)/g;
const REFERENCE_DEFINITION_PATTERN = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*<?(\S+)/gm;
const AUTOLINK_PATTERN = /<([a-zA-Z][a-zA-Z0-9+.-]*:[^>\s]*)>/g;
const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*:)/;

function linkDiagnostic(url: string, offset: number, policy: MarkdownContentPolicy): MarkdownContentDiagnostic | undefined {
  // Entity escapes and control characters cannot hide a scheme: both are
  // stripped before the protocol is read.
  const decoded = Array.from(url.replace(/&#x?[0-9a-f]+;?/gi, ""), (character) => (character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? "" : character)).join("");
  if (decoded.startsWith("//")) return { code: "unsafe-link", message: "Protocol-relative URLs are not allowed.", offset };
  const scheme = SCHEME_PATTERN.exec(decoded)?.[1]?.toLowerCase();
  if (scheme === undefined) return undefined;
  if (!policy.allowedLinkProtocols.includes(scheme)) return { code: "unsafe-link", message: `URL protocol "${scheme}" is not allowed.`, offset };
  return undefined;
}

export function diagnoseMarkdownValue(value: string, policy: MarkdownContentPolicy = DEFAULT_MARKDOWN_CONTENT_POLICY): MarkdownContentDiagnostic[] {
  const diagnostics: MarkdownContentDiagnostic[] = [];
  if (value.length > policy.maxLength) diagnostics.push({ code: "too-long", message: `Markdown exceeds ${policy.maxLength} characters.`, offset: policy.maxLength });
  for (const match of value.matchAll(HTML_PATTERN)) {
    diagnostics.push({ code: "html-not-allowed", message: "Raw HTML is not allowed in Markdown content.", offset: match.index });
  }
  for (const match of value.matchAll(INLINE_LINK_PATTERN)) {
    if (match[1] === "!" && !policy.allowImages) { diagnostics.push({ code: "image-not-allowed", message: "Images are not allowed in Markdown content.", offset: match.index }); continue; }
    const diagnostic = linkDiagnostic(match[2] ?? "", match.index, policy);
    if (diagnostic) diagnostics.push(diagnostic);
  }
  for (const match of value.matchAll(REFERENCE_DEFINITION_PATTERN)) {
    const diagnostic = linkDiagnostic(match[1] ?? "", match.index, policy);
    if (diagnostic) diagnostics.push(diagnostic);
  }
  for (const match of value.matchAll(AUTOLINK_PATTERN)) {
    const diagnostic = linkDiagnostic(match[1] ?? "", match.index, policy);
    if (diagnostic) diagnostics.push(diagnostic);
  }
  return diagnostics.sort((left, right) => left.offset - right.offset);
}
