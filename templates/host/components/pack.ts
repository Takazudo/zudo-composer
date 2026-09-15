import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { name } from "../package.json";
import { PageFrame, Picture, Welcome, type PageFrameProps, type PictureProps, type WelcomeProps } from "./page";

const source = (exportName: string) => ({ module: `${name}/components`, exportKind: "named" as const, exportName });

export const componentPack = defineComponentPack({
  packId: name,
  packVersion: "1.0.0",
  components: [
    defineComponent<PageFrameProps>()(PageFrame, {
      id: "starter.page-frame", schemaVersion: 1, title: "Page frame", category: "Layout",
      description: "A centered page with a content slot.", source: source("PageFrame"), defaults: {}, fields: [],
      slots: [{ id: "content", prop: "content", label: "Content", cardinality: "many" }],
    }),
    defineComponent<WelcomeProps>()(Welcome, {
      id: "starter.welcome", schemaVersion: 1, title: "Welcome", category: "Content",
      description: "A page heading and introduction.", source: source("Welcome"),
      defaults: { heading: "Welcome to your site", description: "Make something of your own." },
      fields: [{ kind: "text", prop: "heading", label: "Heading" }, { kind: "text", prop: "description", label: "Description" }],
    }),
    defineComponent<PictureProps>()(Picture, {
      id: "starter.picture", schemaVersion: 1, title: "Picture", category: "Media",
      description: "An image with alternative text.", source: source("Picture"), defaults: { src: "", alt: "" },
      fields: [{ kind: "text", prop: "src", label: "Image URL" }, { kind: "text", prop: "alt", label: "Alternative text" }],
    }),
  ],
});

export { PageFrame, Picture, Welcome };
