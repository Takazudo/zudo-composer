import type { JSX } from "preact";
import type { ContentRouteContentProps } from "./content-app";
import { ContentApp } from "./content-app";
import "./styles.css";

/** Route content exported for the application shell to wire to its Content provider. */
export function ContentRouteContent(props: ContentRouteContentProps): JSX.Element { return <ContentApp {...props} />; }
