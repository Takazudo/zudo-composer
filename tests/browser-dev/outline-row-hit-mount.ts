/// <reference types="vite/client" />
import { h, render } from "preact";
import { OutlineTree } from "../../src/components/outline-tree";
import type { OutlineNode } from "../../src/components/outline-tree";
import { Button } from "../../src/components/ui/button";

/**
 * The narrow structure rail from #989: a long slug, the slot-rule hint and a
 * "3 kinds" rule tag. Mounted through the real tree so the hit test follows
 * the same markup the authoring UI paints.
 */
const LONG_SLUG = "results-toc-items-slot-with-a-very-long-slug-name";
const HINT = "Results table of contents · Featured result card · Comparison row";

const rule = {
  slug: LONG_SLUG,
  hint: HINT,
  tag: "3 kinds",
  tagVariant: "rule" as const,
  tagDetail: "Heading, Note, Card — rule from Results toc › items",
};

const nodes: readonly OutlineNode[] = [
  {
    id: "doc",
    kind: "category",
    title: "Document",
    count: 12,
    ...rule,
    children: [
      {
        id: "items",
        kind: "group",
        variant: "slot",
        title: "items",
        count: 3,
        ...rule,
        children: [{ id: "leaf", kind: "leaf", title: "SectionHeading", ...rule }],
      },
    ],
  },
];

export function mountOutlineHitProbe(host: HTMLElement): void {
  render(
    h(OutlineTree, {
      label: "Structure",
      showToolbar: false,
      nodes,
      renderActions: (node) => [
        h(
          Button,
          {
            variant: "ghost",
            size: "xs",
            iconOnly: true,
            "aria-label": `Add component to ${node.title}`,
          },
          "+",
        ),
        h(
          Button,
          {
            variant: "ghost",
            size: "xs",
            iconOnly: true,
            "aria-label": `Insert options for ${node.title}`,
          },
          "…",
        ),
      ],
    }),
    host,
  );
}
