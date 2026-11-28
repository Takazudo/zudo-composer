import type { Child } from "@takazudo/zfb/zudo-react";
import type { RouteServicesProps } from "../../app/services";
import type { ContentRouteContentProps } from "./content-app";
import { ContentApp } from "./content-app";
import "./styles.css";

/** Route content exported for the application shell to wire to its Content provider. */
export function ContentRouteContent(props: ContentRouteContentProps & RouteServicesProps): Child { return <ContentApp {...props} />; }
