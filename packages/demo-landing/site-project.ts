// The authored site. `pnpm generate` turns this into `site-project.json`;
// the tests fail when the two disagree. The full Orrery site is authored in a
// later task; until then the home route shows the pack's hero.
import { defineSite, node } from "demo-tools";
import { componentPack } from "./components/pack";

const site = defineSite({ id: "demo-landing", name: "Demo Landing", componentPack });

const home = site.page({
  name: "Home",
  root: [node("land.hero", {}, {}, "home-hero")],
});

const homeRoute = { title: "Home", page: home };

site.sitemap({
  name: "Demo Landing sitemap",
  root: homeRoute,
  navigation: { primary: [{ route: homeRoute }], footer: [{ route: homeRoute }] },
});

export default site;
