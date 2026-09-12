// The authored site. `pnpm generate` turns this into `site-project.json`;
// the tests fail when the two disagree.
import { defineSite, node } from "demo-tools";
import { componentPack } from "./components/pack";

const site = defineSite({ id: "demo-blog", name: "Demo Blog", componentPack });

const home = site.page({
  name: "Home",
  root: [node("blog.hello", { text: "Hello from the demo blog. Articles, tags and authors arrive in later tasks." }, {}, "home-hello")],
});

const homeRoute = { title: "Home", page: home };

site.sitemap({
  name: "Demo Blog sitemap",
  root: homeRoute,
  navigation: { primary: [{ route: homeRoute }], footer: [{ route: homeRoute }] },
});

export default site;
