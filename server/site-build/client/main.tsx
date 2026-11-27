// Visitor entry for static site builds; separate from the authoring application.
import { signal } from "@takazudo/zfb/zudo-react";
import { mountOwned } from "../../../src/runtime";
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

// One root for the document's life: in-place navigation moves the address
// signal instead of re-rendering the page from scratch.
const pathname = signal(window.location.pathname);
const delivery = mountOwned(SiteDelivery, { source, pathname }, { parent: root, name: "SiteDelivery" });
if (!delivery.handle) throw new Error(`Site delivery could not mount (${delivery.diagnostics.map(({ code }) => code).join(", ") || "no diagnostic"}).`);

installVisitorNavigation({ routes: build.routes.map(({ pathname: route }) => route), basePath: "/", mount: () => { pathname.value = window.location.pathname; } });
