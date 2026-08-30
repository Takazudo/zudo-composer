import type { JSX } from "preact";
import { MediaApp, type MediaRouteContentProps } from "./media-app";
import "./styles.css";

/** Route content exported for the application shell to wire to Media. */
export function MediaRouteContent(props: MediaRouteContentProps): JSX.Element {
  return <MediaApp {...props} />;
}
