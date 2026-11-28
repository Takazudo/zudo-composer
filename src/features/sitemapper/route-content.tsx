import type { Child } from "@takazudo/zfb/zudo-react";
import type { RouteServicesProps } from "../../app/services";
import "./styles.css";
import {
  ProductionSitemapperApp,
  type ProductionSitemapperAppProps,
} from "./app/production-sitemapper-app";

/** Standalone route content; the application shell supplies its active catalog. */
export function SitemapperRouteContent(props: ProductionSitemapperAppProps & RouteServicesProps): Child {
  const workspace = props.services.workspace;
  return <ProductionSitemapperApp {...props} navigate={props.navigate ?? ((href: string) => { void workspace.navigate(href); })} />;
}
