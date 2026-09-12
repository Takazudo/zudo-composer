// Static website build entry (vite.site-static.config.ts); never imported by the installed local tool.
import { render } from "preact";
import { build, project } from "virtual:site-static-project";
import { activeComponentProvider } from "../features/composer/active-pack";
import { SiteDelivery } from "../features/delivery/site-delivery";
import type { DeliverySourceContract } from "../features/delivery/source";
import "virtual:zudo-composer-host-styles";
import "./styles.css";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app mount point");

const source: DeliverySourceContract = { kind: "static", componentProvider: activeComponentProvider, project, build };
const routes = new Set(build.routes.map(({ pathname }) => pathname));

function mount(): void {
  render(<SiteDelivery source={source} pathname={window.location.pathname} />, root!);
}

// Only links to a compiled route are handled in place; everything else
// (uploaded assets, other origins, modified clicks) stays a normal navigation.
document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin || !routes.has(url.pathname)) return;
  event.preventDefault();
  if (url.pathname === window.location.pathname && url.search === window.location.search) { if (url.hash) window.location.hash = url.hash; return; }
  window.history.pushState(null, "", url);
  mount();
  window.scrollTo(0, 0);
});
window.addEventListener("popstate", mount);
mount();
