import type { JSX } from "preact";
import { MappingApp, type MappingRouteContentProps } from "./mapping-app";
import "./styles.css";
import { useWorkspace } from "../../app/workspace-context";

/** Route content exported for later application-shell provider wiring. */
export function MappingRouteContent(props: MappingRouteContentProps): JSX.Element {
  const workspace = useWorkspace();
  return <MappingApp {...props} navigate={props.navigate ?? (workspace ? (href) => { void workspace.navigate(href); } : undefined)} />;
}
