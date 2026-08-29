import type { JSX } from "preact";
import { MappingApp, type MappingRouteContentProps } from "./mapping-app";
import "./styles.css";

/** Route content exported for later application-shell provider wiring. */
export function MappingRouteContent(props: MappingRouteContentProps): JSX.Element { return <MappingApp {...props} />; }
