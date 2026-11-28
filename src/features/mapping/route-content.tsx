import type { Child } from "@takazudo/zfb/zudo-react";
import { MappingApp, type MappingRouteContentProps } from "./mapping-app";
import "./styles.css";

/** Route content for the application shell; navigation goes through its workspace services. */
export function MappingRouteContent(props: MappingRouteContentProps): Child {
  const workspace = props.services?.workspace;
  return <MappingApp {...props} navigate={props.navigate ?? (workspace ? (href) => { void workspace.navigate(href); } : undefined)} />;
}
