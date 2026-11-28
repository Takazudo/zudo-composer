import type { Child } from "@takazudo/zfb/zudo-react";
import type { RouteServicesProps } from "../../app/services";
import { MappingApp, type MappingRouteContentProps } from "./mapping-app";
import "./styles.css";

/** Route content exported for the application shell to wire to its Mapping provider. */
export function MappingRouteContent(props: MappingRouteContentProps & RouteServicesProps): Child {
  const workspace = props.services.workspace;
  return <MappingApp {...props} navigate={props.navigate ?? ((href: string) => { void workspace.navigate(href); })} />;
}
