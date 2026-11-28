import type { Child } from "@takazudo/zfb/zudo-react";

export interface PanelProps {
  title: string;
  tone?: "plain" | "loud";
  // The contract types slots structurally (any object), wider than `Child`.
  children?: Child | object;
}

export function Panel({ title, tone = "plain", children }: PanelProps) {
  return (
    <section class={`themeset-panel themeset-panel--${tone}`}>
      <h2 class="themeset-panel__title">{title}</h2>
      {children as Child}
    </section>
  );
}

export interface NoteProps {
  body: string;
}

export function Note({ body }: NoteProps) {
  return <p class="themeset-note">{body}</p>;
}
