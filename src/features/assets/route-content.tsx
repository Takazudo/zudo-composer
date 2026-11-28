import type { Child } from "@takazudo/zfb/zudo-react";
import { AssetApp, type AssetRouteContentProps } from "./assets-app";
import "./styles.css";

/** Route content exported for the application shell to wire to Assets. */
export function AssetRouteContent(props: AssetRouteContentProps): Child {
  return <AssetApp {...props} />;
}
