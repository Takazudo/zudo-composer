import { defineComponent, type AuthorFieldDefinition } from "@zudo-composer/component-contract";
import { Hero, type HeroProps } from "./hero";

// The provider accepts ComponentChildren at runtime, while Composer persists
// these authorable text leaves as JSON strings. Keep that authoring projection
// explicit so contract-v2 static checks remain meaningful.
type HeroComposerProps = Omit<HeroProps, "heading" | "lead"> & { heading?: string; lead?: string };

export const heroDisplay = {
  title: "Hero",
  category: "Content",
  description:
    "First-view hero band: eyebrow + display heading + lead + CTA row over a soft accent-tinted background.",
} as const;

export const heroComposer = defineComponent<HeroComposerProps>()(Hero, {
  id: "ui.hero",
  schemaVersion: 1,
  ...heroDisplay,
  source: { module: "@zudo-sg/ui", exportKind: "named", exportName: "Hero" },
  defaults: {
    eyebrow: "Welcome",
    heading: "Build things that last",
    lead: "A sample lead paragraph.",
    variant: "primary",
    actions: [{ label: "Get started", href: "#", variant: "primary" }],
  },
  fields: [
    { prop: "eyebrow", label: "Eyebrow", schema: { type: "string" }, editor: { kind: "text" } },
    { prop: "heading", label: "Heading", schema: { type: "string" }, editor: { kind: "text" } },
    { prop: "lead", label: "Lead", schema: { type: "string" }, editor: { kind: "text" } },
    { prop: "variant", label: "Variant", schema: { type: "string", enum: ["primary", "secondary"] }, editor: { kind: "select" } },
    {
      prop: "actions",
      label: "Actions",
      schema: {
        type: "array",
        items: {
          schema: {
            type: "object",
            fields: [
              {
                key: "label",
                label: "Label",
                required: true,
                schema: { type: "string" },
                editor: { kind: "text" },
              },
              {
                key: "href",
                label: "URL",
                required: true,
                schema: { type: "string" },
                editor: { kind: "text" },
              },
              {
                key: "variant",
                label: "Variant",
                schema: { type: "string", enum: ["primary", "secondary"] },
                editor: { kind: "select" },
              },
            ],
          },
          editor: { kind: "group" },
        },
      },
      editor: { kind: "list" },
    } satisfies AuthorFieldDefinition<HeroComposerProps>,
  ],
});
