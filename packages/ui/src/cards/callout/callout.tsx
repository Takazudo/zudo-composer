import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../lib/cx";

export type CalloutTone = "note" | "muted";

export type CalloutProps = {
  tone?: CalloutTone;
  title?: string;
  class?: string;
  children?: ComponentChildren;
};

// Tint + rule color are derived via color-mix from tokens (never a raw hex),
// so both tones stay correct in light and dark.
const TONE_STYLE: Record<CalloutTone, JSX.CSSProperties> = {
  note: {
    borderLeftColor: "var(--color-accent)",
    backgroundColor: "color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))",
  },
  muted: {
    borderLeftColor: "var(--color-border)",
    backgroundColor: "var(--color-surface)",
  },
};

const TONE_TITLE_CLASS: Record<CalloutTone, string> = {
  note: "text-accent",
  muted: "text-fg",
};

/**
 * Call-out box for surfacing a note or aside in the flow of body copy.
 * `tone="note"` is accent-tinted with an accent rule; `tone="muted"` is a
 * neutral surface-tinted variant. This is a `@zudo-sg/ui` building block,
 * separate from the doc host's own built-in `<Note>`/admonition directives.
 */
export function Callout({ tone = "note", title, class: cls, children }: CalloutProps) {
  return (
    <div
      class={cx("border border-border border-l-4 rounded-md px-hsp-lg py-vsp-sm", cls)}
      style={TONE_STYLE[tone]}
      role="note"
    >
      {title && (
        <p class={cx("text-caption font-semibold mb-vsp-2xs", TONE_TITLE_CLASS[tone])}>{title}</p>
      )}
      <div class="text-small text-fg">{children}</div>
    </div>
  );
}

/** `tone="note"` alias, for authoring as `<Note>`. */
export function Note(props: Omit<CalloutProps, "tone">) {
  return <Callout tone="note" {...props} />;
}
