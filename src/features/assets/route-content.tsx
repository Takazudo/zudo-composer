import type { JSX } from "preact";
import { AssetApp, type AssetRouteContentProps } from "./assets-app";
import "./styles.css";

/** Route content exported for the application shell to wire to Assets. */
export function AssetRouteContent(props: AssetRouteContentProps): JSX.Element {
  return <AssetApp {...props} />;
}
