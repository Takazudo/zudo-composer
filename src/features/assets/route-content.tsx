import type { Child } from "@takazudo/zfb/zudo-react";
import type { RouteServicesProps } from "../../app/services";
import { AssetApp, type AssetRouteContentProps } from "./assets-app";
import "./styles.css";

/** Route content exported for the application shell to wire to Assets. */
export function AssetRouteContent(props: AssetRouteContentProps & RouteServicesProps): Child {
  return <AssetApp {...props} />;
}
