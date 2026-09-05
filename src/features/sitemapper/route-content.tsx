/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useWorkspace } from "../../app/workspace-context";
import "./styles.css";
import {
  ProductionSitemapperApp,
  type ProductionSitemapperAppProps,
} from "./app/production-sitemapper-app";

/** Standalone route content; the application shell supplies its active catalog. */
export function SitemapperRouteContent(props: ProductionSitemapperAppProps): JSX.Element {
  const workspace = useWorkspace();
  return <ProductionSitemapperApp {...props} navigate={props.navigate ?? (workspace ? (href) => { void workspace.navigate(href); } : undefined)} />;
}
