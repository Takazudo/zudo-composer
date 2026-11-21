import { useEffect, useState } from "preact/hooks";
import type { PageLoading } from "./page-loading";
import "./page-loading.css";

export function PageLoadingOverlay({ loading }: { loading: PageLoading }) {
  const [visible, setVisible] = useState(loading.isLoading);
  useEffect(() => { setVisible(loading.isLoading()); return loading.subscribe(() => setVisible(loading.isLoading())); }, [loading]);
  return <div class="cms-page-loading" data-testid="page-loading-overlay" data-visible={visible ? "" : undefined} aria-hidden={visible ? "false" : "true"}>
    <span class="cms-page-loading__spinner" />
  </div>;
}
