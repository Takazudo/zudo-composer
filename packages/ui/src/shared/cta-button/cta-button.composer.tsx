import { defineComponent } from "@zudo-composer/component-contract";
import { CtaButton, type CtaButtonProps } from "./cta-button";

// Composer stores a plain JSON label; the runtime component also supports
// richer ComponentChildren for application-authored usage.
type CtaButtonComposerProps = Omit<CtaButtonProps, "children"> & { children?: string };

export const ctaButtonDisplay = {
  title: "CtaButton",
  category: "Actions",
  description: "Accent-filled or outlined call-to-action link, with an optional trailing arrow.",
} as const;

export const ctaButtonComposer = defineComponent<CtaButtonComposerProps>()(CtaButton, {
  id: "ui.cta-button",
  schemaVersion: 1,
  ...ctaButtonDisplay,
  source: { module: "@zudo-sg/ui", exportKind: "named", exportName: "CtaButton" },
  defaults: { href: "/products", variant: "primary", arrow: true, children: "Browse products" },
  fields: [
    { prop: "href", label: "Link", required: true, schema: { type: "string" }, editor: { kind: "text" } },
    { prop: "variant", label: "Variant", schema: { type: "string", enum: ["primary", "secondary"] }, editor: { kind: "select" } },
    { prop: "arrow", label: "Arrow", schema: { type: "boolean" }, editor: { kind: "boolean" } },
    { prop: "children", label: "Label", schema: { type: "string" }, editor: { kind: "text", multiline: false }, inlineEdit: true },
  ],
  adapters: {
    inlineEditor: {
      field: "children",
      resolveElement: (root: HTMLElement) => root.querySelector<HTMLElement>("[data-cta-label]") ?? root,
    },
  },
});
