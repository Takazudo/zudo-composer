// Visitor entry for static site builds; separate from the authoring application.
import { render } from "preact";
import { build, project } from "virtual:site-static-project";
import { activeComponentProvider } from "../../../src/features/composer/active-pack";
import { SiteDelivery } from "../../../src/features/delivery/site-delivery";
import type { DeliverySourceContract } from "../../../src/features/delivery/source";
import { installVisitorNavigation } from "../../../src/features/delivery/visitor-navigation";
import "virtual:zudo-composer-host-styles";
import "../../../src/features/delivery/visitor.css";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app mount point");

const source: DeliverySourceContract = { kind: "static", componentProvider: activeComponentProvider, project, build };

function mount(): void {
  render(<SiteDelivery source={source} pathname={window.location.pathname} />, root!);
}

installVisitorNavigation({ routes: build.routes.map(({ pathname }) => pathname), basePath: "/", mount });
mount();
