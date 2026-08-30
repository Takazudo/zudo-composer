import type { JSX } from "preact";
import { FolderIcon, UploadIcon } from "../../components/icons";
import type { MediaProvider } from "../../media";

export interface MediaRouteContentProps {
  /** The dev-only provider is absent from production builds. */
  provider?: MediaProvider;
}

/**
 * The route shell stays useful before a dev upload provider is available. It
 * deliberately does not initialize or probe an optional provider: the
 * disconnected production state must not create a request by itself.
 */
export function MediaApp({ provider }: MediaRouteContentProps): JSX.Element {
  const connected = provider !== undefined;
  return (
    <main class="sg-media-app" aria-labelledby="media-title">
      <header class="sg-media-app__header">
        <div>
          <p class="sg-media-eyebrow">Asset workspace</p>
          <h1 id="media-title">Media library</h1>
        </div>
      </header>
      <section
        class="sg-media-state"
        data-media-provider-state={connected ? "connected" : "unavailable"}
        aria-labelledby="media-state-title"
      >
        {connected ? <FolderIcon size="lg" /> : <UploadIcon size="lg" />}
        <div>
          <h2 id="media-state-title">{connected ? "Media provider connected" : "Media service not connected"}</h2>
          <p>
            {connected
              ? "Media browsing will appear here when the library surface is enabled."
              : "Media uploads are unavailable in this standalone build because no development media service is connected."}
          </p>
        </div>
      </section>
    </main>
  );
}
