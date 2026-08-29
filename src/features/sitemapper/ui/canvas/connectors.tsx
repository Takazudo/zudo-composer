/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import type { CanvasLayout } from "./layout";

export interface SitemapConnectorsProps {
  layout: CanvasLayout;
}

export function SitemapConnectors({ layout }: SitemapConnectorsProps): JSX.Element {
  return (
    <svg
      class="sg-sitemapper-connectors"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {layout.segments.map((segment) => (
        <path
          key={segment.id}
          class="sg-sitemapper-connector"
          data-sg-external={segment.external ? "true" : undefined}
          d={segment.path}
        />
      ))}
    </svg>
  );
}

export default SitemapConnectors;
