import { defineSite, node } from "zudo-composer/authoring";
import { componentPack } from "./components/pack";

const site = defineSite({ id: "starter-site", name: "My first site", componentPack });
const frame = site.template({
  name: "Site frame",
  root: [node("starter.page-frame", {}, {}, "page-frame")],
  outlet: { target: { parentId: "page-frame", slotId: "content" } },
});

const welcome = site.model({
  name: "Welcome", kind: "single",
  fields: [{ key: "heading", kind: "text" }, { key: "description", kind: "long-text" }],
});
site.entry(welcome, {
  id: "welcome",
  values: { heading: "Welcome to your site", description: "Your first page is ready. Edit its content, arrange components, and make it yours." },
});

const home = site.page({
  name: "Home", template: frame,
  root: [
    node("starter.welcome", {}, {}, "welcome"),
    node("starter.picture", {
      src: "/uploaded-assets/sha256-c62b425177a0c01dba4bd49fec9b57efe0bce6632eeb5963d3cf1a66c60a62c6.png",
      alt: "Sunrise in warm colors",
    }),
  ],
});
const homeMapping = site.mapping({
  name: "Home", model: welcome, composition: home,
  bindings: [{ field: "heading", nodeId: "welcome", prop: "heading" }, { field: "description", nodeId: "welcome", prop: "description" }],
});
site.sitemap({ name: "My site", root: { title: "Home", mapping: homeMapping, route: "single" } });

export default site;
