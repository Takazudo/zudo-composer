/** @jsxRuntime automatic */
/** @jsxImportSource @takazudo/zfb/zudo-react */
import { mount } from "@takazudo/zfb/zudo-react/client";
import type { RootHandle } from "@takazudo/zfb/zudo-react/client";
import { createHostedPreviewHost, HostedPreviewError } from "zudo-composer/hosted-content/preview";
import { HostDocumentBody } from "./OfferPage";
import { fixedHostDefinition, offerProjection } from "./project";
import { hostPack, hostRenderer } from "./identity";
const outlet = document.getElementById("visitor-root");
if (!outlet) throw Error("Missing host visitor root");
let root: RootHandle | null = null;
const host = createHostedPreviewHost({ hostWindow: window, parent: window.parent, origin: location.origin,
  pack: hostPack, renderer: hostRenderer, frameSession: crypto.randomUUID(),
  async render(request, context) {
    if (request.routeId !== fixedHostDefinition.route.id) throw new HostedPreviewError("unsupported-route", "The host owns only its fixed home route");
    const data = offerProjection(request.renderData);
    if (!context.isCurrent()) return;
    root?.dispose();
    root = mount(<HostDocumentBody data={data} />, outlet, {
      identity: { component: "HostDocumentBody", build: hostRenderer.rendererVersion },
      report(diagnostic) { throw new HostedPreviewError("render-failed", diagnostic.actual); },
    });
    if (!root) throw new HostedPreviewError("render-failed", "zudo-react failed to commit the host document");
    await Promise.all([...outlet.querySelectorAll("img")].map(async (image) => {
      if (context.signal.aborted) return;
      try { await image.decode(); } catch { throw new HostedPreviewError("missing-dependency", `Approved image failed: ${image.getAttribute("src")}`); }
      if (image.naturalWidth === 0) throw new HostedPreviewError("missing-dependency", "Approved image has no decoded pixels");
    }));
    if (context.isCurrent()) outlet.dataset.snapshotId = request.snapshotId;
  },
});
host.ready();
window.addEventListener("pagehide", () => { host.dispose(); root?.dispose(); }, { once: true });
