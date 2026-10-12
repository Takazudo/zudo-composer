"use client";
import { getScope, signal, Show } from "@takazudo/zfb/zudo-react";
import PreviewTokenPanelBootstrap from "@takazudo/zudo-sg/token-tweak/preview-token-panel-bootstrap";
export default function EngineRoutePreviewTokenPanelBootstrap() {
  const active = signal(false);
  getScope().onActivate(() => {
    active.value = Boolean(document.querySelector("[data-sg-engine-route]"));
  });
  return <Show when={active}>{() => <PreviewTokenPanelBootstrap />}</Show>;
}
