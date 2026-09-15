/**
 * Client-side markdown → sanitized HTML runtime, backed by
 * `@takazudo/zfb-md-wasm/render` (the focused wasm build of zfb's own
 * markdown rendering pipeline, so a live preview matches what zfb renders at
 * build time without shipping the root entry's compiler graph).
 *
 * ## Fence handling
 *
 * md-wasm 2.10 exposes zfb's native fenced-code class mode at
 * `pipeline.codeHighlight`. It preserves the fence language and emits the same
 * semantic `hi-*` markup as the build, including fences nested in blockquotes
 * and lists. The former positional source scanner is therefore unnecessary.
 *
 * ## Sanitization is mandatory
 *
 * `renderHtml` is not a sanitizer. Verified against zfb-md-wasm 2.10.1: raw
 * `<script>alert(1)</script>`, `<a onclick="…">`, `<svg onload="…">`,
 * `<iframe src="…">` and `[x](javascript:…)` all pass through with zero
 * diagnostics. Every returned string therefore goes through DOMPurify with an
 * explicit prose allowlist (below) as the LAST step, after fence
 * substitution, so highlight markup is covered too. `style` is not allowed,
 * which also strips any inline syntect colours left by the mismatch path.
 *
 * ## Caller responsibilities
 *
 * Stale-result protection is the CALLER's. `renderMarkdown` is a plain
 * promise with no cancellation; a component that re-renders on every keystroke
 * must drop results whose input no longer matches its current state. Only the
 * module import is cached — a rejected import is evicted so a later mount can
 * retry a transient chunk load.
 */

import DOMPurify from "dompurify";
import type {
  Diagnostic,
  DiagnosticSource,
  PipelineOptions,
} from "@takazudo/zfb-md-wasm/render";

export type MarkdownDiagnosticSource = DiagnosticSource | "internal" | "sanitize";

export interface MarkdownDiagnostic {
  severity: "error" | "warning";
  source: MarkdownDiagnosticSource;
  message: string;
  line: number | null;
  column: number | null;
}

export interface MarkdownRenderResult {
  /** Sanitized HTML fragment, or `null` when any error diagnostic was raised. */
  html: string | null;
  diagnostics: MarkdownDiagnostic[];
}

export type MarkdownModule = Pick<
  typeof import("@takazudo/zfb-md-wasm/render"),
  "renderHtml"
>;

export type MarkdownModuleImporter = () => Promise<MarkdownModule>;

export interface MarkdownRuntime {
  renderMarkdown(source: string): Promise<MarkdownRenderResult>;
}

/**
 * Mirrors the zudo-doc 5 preset: conservative zfb GFM plus task lists and
 * footnotes, CJK-friendly parsing, hierarchical heading ids, and semantic
 * fenced-code class output.
 */
const PIPELINE_OPTIONS: PipelineOptions = {
  gfm: {
    strikethrough: true,
    table: true,
    autolinkLiteral: false,
    taskListItem: true,
    footnoteDefinition: true,
  },
  cjkFriendly: true,
  codeHighlight: { mode: "class" },
  features: {
    // zudo-doc's preset pins this unconditionally, and the always-on
    // HeadingLinks plugin derives its anchors from it. Without it a repeated
    // child heading previews as `child` / `child-1` where the build emits
    // `parent-child` / `other-child`.
    headingIds: { strategy: "hierarchical" },
  },
};

/**
 * Prose allowlist for the sanitizer. Covers what zfb's markdown pipeline can
 * emit for this project's fences and GFM set, plus the `hi-*` highlight markup
 * (`class` on `pre`/`code`/`span`). `style` is intentionally absent.
 */
const ALLOWED_TAGS = [
  "a", "abbr", "blockquote", "br", "code", "dd", "del", "div", "dl", "dt", "em",
  "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "img", "ins",
  "input", "kbd", "li", "mark", "ol", "p", "pre", "s", "samp", "section", "span", "strong",
  "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul", "var",
];

const ALLOWED_ATTR = [
  "align", "alt", "checked", "class", "colspan", "dir", "disabled", "height", "href", "id", "lang",
  "reversed", "role", "rowspan", "src", "start", "title", "type", "width",
];

/**
 * `ALLOW_DATA_ATTR` defaults to true and is NOT narrowed by an explicit
 * `ALLOWED_ATTR`, so raw `<span data-zc-node-id="…">` in an author's markdown
 * would survive into the composer canvas — where `src/features/composer/
 * preview/renderer.ts` routes events with `closest("[data-zc-node-id]")` /
 * `closest("[data-zc-affordance]")` and would treat the prose as another
 * node. Nothing this pipeline emits needs a `data-*` attribute, so drop the
 * whole class. `aria-*` stays allowed for the heading-link labels.
 */
const SANITIZE_CONFIG = { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false };

/**
 * Probe run through the sanitizer before it is trusted. `isSupported` is not
 * sufficient: under happy-dom 16.8.1 (this repo's vitest DOM) DOMPurify
 * reports `isSupported: true` yet returns its input essentially untouched —
 * `<script>` and `onerror=` survive. A DOM that merely looks complete enough
 * can therefore turn sanitization into a silent no-op, so verify the real
 * behavior once per instance instead of trusting the capability flag.
 */
const SANITIZER_PROBE = '<img src="x" onerror="alert(1)"><script>alert(2)</script>';

let purifier: typeof DOMPurify | null = null;
let purifierVerified = false;
let purifierWithInputGuard: typeof DOMPurify | null = null;

/**
 * `dompurify`'s default export binds `window` at module-evaluation time, which
 * is absent when this module is first pulled in during an SSR pass. Re-bind on
 * every miss so a later browser-side call still gets a working instance.
 */
function getPurifier(): typeof DOMPurify | null {
  if (!purifier?.isSupported) {
    purifierVerified = false;
    purifier = DOMPurify.isSupported ? DOMPurify : DOMPurify();
  }
  if (!purifier.isSupported) return null;
  if (!purifierVerified) {
    const probe = purifier.sanitize(SANITIZER_PROBE, { ALLOWED_TAGS, ALLOWED_ATTR });
    if (/<script/i.test(probe) || /\son[a-z]+=/i.test(probe)) return null;
    purifierVerified = true;
  }
  if (purifierWithInputGuard !== purifier) {
    purifier.addHook("uponSanitizeElement", (node, data) => {
      if (data.tagName !== "input") return;
      const input = node as HTMLInputElement;
      if (input.getAttribute("type") !== "checkbox") {
        input.remove();
        return;
      }
      // GFM task-list controls are display-only even when equivalent raw HTML
      // omitted the attribute. Never allow prose to inject an active form UI.
      input.setAttribute("disabled", "");
    });
    purifierWithInputGuard = purifier;
  }
  return purifier;
}

/**
 * Sanitize an assembled prose fragment. Returns `null` when no working
 * sanitizer is available — DOMPurify degrades to a pass-through rather than
 * throwing, and returning unsanitized HTML would be worse than returning
 * nothing.
 */
export function sanitizeRenderedHtml(html: string): string | null {
  const instance = getPurifier();
  if (!instance) return null;
  return instance.sanitize(html, SANITIZE_CONFIG);
}

function toDiagnostic(diagnostic: Diagnostic): MarkdownDiagnostic {
  return {
    severity: diagnostic.severity,
    source: diagnostic.source,
    message: diagnostic.message,
    line: diagnostic.line,
    column: diagnostic.column,
  };
}

/**
 * Build a markdown runtime over a module importer. The cached value is only
 * the focused render-entry import; a rejection is evicted so the next call
 * retries.
 */
export function createMarkdownRuntime(importModule: MarkdownModuleImporter): MarkdownRuntime {
  let modulePromise: Promise<MarkdownModule> | null = null;

  function loadModule(): Promise<MarkdownModule> {
    if (!modulePromise) {
      const pending = importModule().catch((error: unknown) => {
        if (modulePromise === pending) {
          modulePromise = null;
        }
        throw error;
      });
      modulePromise = pending;
    }
    return modulePromise;
  }

  return {
    async renderMarkdown(source) {
      const diagnostics: MarkdownDiagnostic[] = [];
      try {
        const module = await loadModule();
        const rendered = await module.renderHtml(source, {
          filename: "prose.md",
          pipeline: PIPELINE_OPTIONS,
        });
        diagnostics.push(...rendered.diagnostics.map(toDiagnostic));
        if (rendered.html === null) {
          return { html: null, diagnostics };
        }

        if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
          return { html: null, diagnostics };
        }

        const sanitized = sanitizeRenderedHtml(rendered.html);
        if (sanitized === null) {
          diagnostics.push({
            severity: "error",
            source: "sanitize",
            message: "no working DOM sanitizer available for the rendered markdown",
            line: null,
            column: null,
          });
          return { html: null, diagnostics };
        }
        return { html: sanitized, diagnostics };
      } catch (error) {
        // A module-load failure or a wasm trap (`ZfbMdWasmTrapError`) is the
        // only way this boundary throws; surface it as a diagnostic so callers
        // never have to wrap the call themselves.
        diagnostics.push({
          severity: "error",
          source: "internal",
          message: error instanceof Error ? error.message : String(error),
          line: null,
          column: null,
        });
        return { html: null, diagnostics };
      }
    },
  };
}

const defaultRuntime = createMarkdownRuntime(
  () => import("@takazudo/zfb-md-wasm/render"),
);

/** Render markdown to sanitized HTML using the shared lazily-loaded runtime. */
export function renderMarkdown(source: string): Promise<MarkdownRenderResult> {
  return defaultRuntime.renderMarkdown(source);
}
