import type { ComponentChildren } from "preact";

export interface PanelProps {
  title: string;
  tone?: "plain" | "loud";
  children?: ComponentChildren;
}

export function Panel({ title, tone = "plain", children }: PanelProps) {
  return (
    <section class={`themeset-panel themeset-panel--${tone}`}>
      <h2 class="themeset-panel__title">{title}</h2>
      {children}
    </section>
  );
}

export interface NoteProps {
  body: string;
}

export function Note({ body }: NoteProps) {
  return <p class="themeset-note">{body}</p>;
}
