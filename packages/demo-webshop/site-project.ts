// The authored site. `pnpm generate` turns this into `site-project.json`;
// the tests fail when the two disagree.
import { defineSite, node } from "demo-tools";
import { componentPack } from "./components/pack";

const site = defineSite({ id: "demo-webshop", name: "Demo Webshop", componentPack });

const home = site.page({
  name: "Home",
  root: [
    node(
      "shop.section-heading",
      { eyebrow: "Nightjar Supply", heading: "Objects for quiet work", intro: "The catalog, product pages and a mock checkout arrive in later tasks.", as: "h1" },
      {},
      "home-heading",
    ),
  ],
});

const homeRoute = { title: "Home", page: home };

site.sitemap({
  name: "Demo Webshop sitemap",
  root: homeRoute,
  navigation: { primary: [{ route: homeRoute }], footer: [{ route: homeRoute }] },
});

export default site;
