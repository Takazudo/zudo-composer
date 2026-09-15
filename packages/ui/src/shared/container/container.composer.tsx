import { defineComponent } from "@zudo-composer/component-contract";
import { Container, type ContainerProps } from "./container";

export const containerDisplay = {
  title: "Container",
  category: "Layout",
  description:
    "Centers page content in a single ~88rem-wide column, with fluid inline padding that expands on wider viewports.",
} as const;

export const containerComposer = defineComponent<ContainerProps>()(Container, {
  id: "ui.container",
  schemaVersion: 1,
  ...containerDisplay,
  source: { module: "@zudo-sg/ui", exportKind: "named", exportName: "Container" },
  slots: [{ id: "content", prop: "children", label: "Content", cardinality: "many" }],
});
