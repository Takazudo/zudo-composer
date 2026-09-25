"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import PreviewTokenPanelBootstrap from "@takazudo/zudo-sg/token-tweak/preview-token-panel-bootstrap";

export default function EngineRoutePreviewTokenPanelBootstrap() {
  if (typeof document === "undefined" || !document.querySelector("[data-sg-engine-route]")) return null;
  return <PreviewTokenPanelBootstrap />;
}

EngineRoutePreviewTokenPanelBootstrap.displayName = "EngineRoutePreviewTokenPanelBootstrap";
