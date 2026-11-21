import { useEffect, useState } from "preact/hooks";
import type { PageLoading } from "./page-loading";
import "./page-loading.css";

/** Fast cached routes never flash: the scrim waits this long before it shows. */
const SHOW_DELAY_MS = 120;

export function PageLoadingOverlay({ loading }: { loading: PageLoading }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (!loading.isLoading()) { clearTimeout(timer); timer = undefined; setVisible(false); return; }
      timer ??= setTimeout(() => { timer = undefined; setVisible(loading.isLoading()); }, SHOW_DELAY_MS);
    };
    update();
    const stop = loading.subscribe(update);
    return () => { stop(); clearTimeout(timer); };
  }, [loading]);
  return <div class="cms-page-loading" data-testid="page-loading-overlay" data-visible={visible ? "" : undefined} aria-hidden={visible ? "false" : "true"}>
    <span class="cms-page-loading__spinner" />
  </div>;
}
