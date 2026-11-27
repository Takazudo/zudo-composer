import { computed, getScope, signal } from "@takazudo/zfb/zudo-react";
import type { PageLoading } from "./page-loading";
import "./page-loading.css";

/** Fast cached routes never flash: the scrim waits this long before it shows. */
const SHOW_DELAY_MS = 120;

export interface PageLoadingOverlayProps {
  loading: PageLoading;
}

export function PageLoadingOverlay({ loading }: PageLoadingOverlayProps) {
  const visible = signal(false);
  getScope().onActivate(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (!loading.isLoading()) { clearTimeout(timer); timer = undefined; visible.value = false; return; }
      timer ??= setTimeout(() => { timer = undefined; visible.value = loading.isLoading(); }, SHOW_DELAY_MS);
    };
    update();
    const stop = loading.subscribe(update);
    return () => { stop(); clearTimeout(timer); };
  });
  return <div class="cms-page-loading" data-testid="page-loading-overlay" data-visible={computed(() => (visible.value ? "" : undefined))} aria-hidden={computed(() => (visible.value ? "false" : "true"))}>
    <span class="cms-page-loading__spinner" />
  </div>;
}
