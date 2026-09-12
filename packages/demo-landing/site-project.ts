// The authored site. `pnpm generate` turns this into `site-project.json`;
// the tests fail when the two disagree.
import { defineSite, node } from "demo-tools";
import { componentPack } from "./components/pack";

const site = defineSite({ id: "demo-landing", name: "Demo Landing", componentPack });

const home = site.page({
  name: "Home",
  root: [node("land.hello", { text: "Hello from the demo landing page. Pricing and a mock signup arrive in later tasks." }, {}, "home-hello")],
});

const homeRoute = { title: "Home", page: home };

site.sitemap({
  name: "Demo Landing sitemap",
  root: homeRoute,
  navigation: { primary: [{ route: homeRoute }], footer: [{ route: homeRoute }] },
});

export default site;
