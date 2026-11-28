import { computed, For, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type { CanvasLayout } from "./layout";

export interface SitemapConnectorsProps {
  layout: ReadonlySignal<CanvasLayout>;
}

export function SitemapConnectors({ layout }: SitemapConnectorsProps): Child {
  return (
    <svg
      class="sg-sitemapper-connectors"
      width={computed(() => layout.value.width)}
      height={computed(() => layout.value.height)}
      viewBox={computed(() => `0 0 ${layout.value.width} ${layout.value.height}`)}
      aria-hidden="true"
      focusable="false"
    >
      <For each={computed(() => layout.value.segments)} by={(segment) => segment.id}>{(segment) => (
        <path
          class="sg-sitemapper-connector"
          data-sg-external={computed(() => segment.value.external ? "true" : null)}
          d={computed(() => segment.value.path)}
        />
      )}</For>
    </svg>
  );
}

export default SitemapConnectors;
