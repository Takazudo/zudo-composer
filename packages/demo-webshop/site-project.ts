// The authored site. `pnpm generate` turns this into `site-project.json`;
// the tests fail when the two disagree.
import { defineSite, node } from "demo-tools";
import { componentPack } from "./components/pack";

const site = defineSite({ id: "demo-webshop", name: "Demo Webshop", componentPack });

const home = site.page({
  name: "Home",
  root: [node("shop.hello", { text: "Hello from the demo webshop. Catalog, product pages and a mock checkout arrive in later tasks." }, {}, "home-hello")],
});

const homeRoute = { title: "Home", page: home };

site.sitemap({
  name: "Demo Webshop sitemap",
  root: homeRoute,
  navigation: { primary: [{ route: homeRoute }], footer: [{ route: homeRoute }] },
});

export default site;
