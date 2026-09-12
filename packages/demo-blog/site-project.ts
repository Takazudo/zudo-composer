// The authored site. `pnpm generate` turns this into `site-project.json`;
// the tests fail when the two disagree. The full Margin Notes site (frame,
// articles, authors, comments) is authored by the content task.
import { defineSite, node } from "demo-tools";
import { componentPack } from "./components/pack";

const site = defineSite({ id: "demo-blog", name: "Demo Blog", componentPack });

const home = site.page({
  name: "Home",
  root: [
    node("blog.home-hero", {
      heading: "Notes from the margin",
      lead: "Short essays on craft, focus and the tools that hold up.",
      linkLabel: "About the journal",
      linkHref: "/about",
    }, {}, "home-hero"),
    node("blog.demo-note", { text: "Demo — no data is sent." }, {}, "home-demo-note"),
  ],
});

const homeRoute = { title: "Home", page: home };

site.sitemap({
  name: "Demo Blog sitemap",
  root: homeRoute,
  navigation: { primary: [{ route: homeRoute }], footer: [{ route: homeRoute }] },
});

export default site;
