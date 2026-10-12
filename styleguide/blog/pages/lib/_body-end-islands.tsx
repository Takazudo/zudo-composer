import { Island } from "@takazudo/zfb";
import EngineRoutePreviewTokenPanelBootstrap from "./_engine-route-preview-token-panel-bootstrap";
import { previewTokenPanelCaptureScript } from "@takazudo/zudo-sg/token-tweak";
export function BodyEndIslands() {
  return (
    <>
      <script rawHtml={previewTokenPanelCaptureScript()} />
      <Island when="load">
        <EngineRoutePreviewTokenPanelBootstrap />
      </Island>
    </>
  );
}
