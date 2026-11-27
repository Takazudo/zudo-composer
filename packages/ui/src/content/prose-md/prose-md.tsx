"use client";

/**
 * ProseMd — renders a `markdown` string client-side via the markdown runtime
 * (`./markdown-runtime`, #371) and opts into the Composer as a
 * `"markdown-source"` inline-editable field (#372, #368).
 *
 * Three-state render:
 *   - pending  — the raw markdown text in a quiet placeholder block. This is
 *     what SSR/SSG output (`renderToString`) and the styleguide catalog
 *     preview show, and what a client mount shows until the runtime resolves.
 *   - ready    — the sanitized HTML from `renderMarkdown()`, mounted via
 *     `rawHtml`. The runtime sanitizes as its last step (DOMPurify, prose
 *     allowlist) — this component never re-sanitizes or assembles HTML itself.
 *   - error    — a compact diagnostics message.
 *
 * Props are plain values: the Composer preview renderer keys each node by
 * `(nodeId, propsRevision)` and remounts it when a prop changes, so a new
 * `markdown` value is always a fresh mount that starts in pending — no stale
 * ready/error HTML from the previous value can paint first.
 *
 * Stale-async protection: `renderMarkdown` is a plain promise with no
 * cancellation (see markdown-runtime.ts's header), so a superseded mount or an
 * unmount must not let an older result land afterwards. The render starts on
 * activation (browser only), and its continuation is dropped once the scope's
 * `abortSignal` has fired.
 *
 * The wrapper only accepts `markdown` + `class` — no `{...rest}` prop spread,
 * unlike the sibling `Prose*` element overrides. That's a deliberate,
 * unrelated choice: `src/composer/model/reserved-keys.ts`'s
 * `RESERVED_PROP_KEYS` gate gets involved elsewhere (persisted-prop
 * prototype-pollution guarding), not here — this component simply has no
 * other prop to forward, and the rendered root's content is fully owned by
 * the sanitized markdown HTML.
 */
import { computed, getScope, Show, signal } from "@takazudo/zfb/zudo-react";
import { cx } from "../../lib/cx";
import { renderMarkdown, type MarkdownDiagnostic } from "./markdown-runtime";

// Typography for `.zc-prose-md` lives in `./prose-md.css`, wired into the
// single bundled stylesheet via `src/styles/global.css` — NOT imported here.
// @zudo-composer/ui has no build step and no CSS bundling of its own (see
// STORIES.md §1's "Component-scoped CSS" note); the consumer's own `@import`
// graph is what actually ships CSS to the page, and a consumer other than
// this repo's root app must wire `./prose-md.css` in itself.

export type ProseMdProps = {
  markdown: string;
  class?: string;
};

type RenderState =
  | { status: "pending" }
  | { status: "ready"; html: string }
  | { status: "error"; diagnostics: MarkdownDiagnostic[] };

/** First error diagnostic (falling back to the first of any severity), or a generic message. */
function summarizeError(diagnostics: MarkdownDiagnostic[]): string {
  const primary =
    diagnostics.find((diagnostic) => diagnostic.severity === "error") ?? diagnostics[0];
  return primary?.message ?? "Unable to render this markdown.";
}

/** Client-side markdown renderer. Opts into the Composer via `prose-md.composer.tsx`. */
export function ProseMd({ markdown, class: cls }: ProseMdProps) {
  const scope = getScope();
  const state = signal<RenderState>({ status: "pending" });
  const isReady = computed(() => state.value.status === "ready");
  const isError = computed(() => state.value.status === "error");
  const html = computed(() => {
    const current = state.value;
    return current.status === "ready" ? current.html : "";
  });
  const errorMessage = computed(() => {
    const current = state.value;
    return current.status === "error" ? summarizeError(current.diagnostics) : "";
  });

  scope.onActivate(() => {
    void renderMarkdown(markdown).then((result) => {
      // A superseded mount (a newer `markdown` prop remounted this node) or an
      // unmount aborts this scope; a late arrival is dropped rather than
      // overwriting newer content.
      if (scope.abortSignal.aborted) return;
      state.value =
        result.html === null
          ? { status: "error", diagnostics: result.diagnostics }
          : { status: "ready", html: result.html };
    });
  });

  return (
    <Show
      when={isReady}
      fallback={() => (
        <Show
          when={isError}
          fallback={() => (
            <div class={cx("zc-prose-md", "zc-prose-md--pending", cls)}>
              <pre class="zc-prose-md-raw">{markdown}</pre>
            </div>
          )}
        >
          {() => (
            <div class={cx("zc-prose-md", "zc-prose-md--error", cls)} role="alert">
              Couldn't render this markdown: {errorMessage}
            </div>
          )}
        </Show>
      )}
    >
      {/* `html` is sanitized by the markdown runtime (DOMPurify, prose
          allowlist) as its last step — see markdown-runtime.ts's header. */}
      {() => <div class={cx("zc-prose-md", cls)} rawHtml={html} />}
    </Show>
  );
}
