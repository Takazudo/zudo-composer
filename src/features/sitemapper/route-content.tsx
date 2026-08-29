/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import "./styles.css";
import {
  ProductionSitemapperApp,
  type ProductionSitemapperAppProps,
} from "./app/production-sitemapper-app";

/** Standalone route content; the application shell supplies its active catalog. */
export function SitemapperRouteContent(props: ProductionSitemapperAppProps): JSX.Element {
  return <ProductionSitemapperApp {...props} />;
}
