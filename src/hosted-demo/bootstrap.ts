import { assets as bundledAsset } from "virtual:hosted-demo-seed";
import sample from "../../packages/demo-studio/site-project.json";
import { createProductionProviderIntegration, type ProductionProviderIntegration } from "../app/provider-integration";
import { computeSiteProjectRevision } from "../app/empty-site-project";
import { validateSiteProject, type SiteProject } from "../site-project";
import { activeSiteProjectValidationContext } from "../app/site-project-manifest";
import { createDemoWorkspaceProviders } from "./workspaces";
import { createDemoAsset, type DemoAssetSeed } from "./assets";
interface Handoff { project: SiteProject; assets: DemoAssetSeed }
async function incomingHandoff(): Promise<Handoff | null> {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("demoPreview");
  if (!token) return null;
  const source = window.opener ?? (window.parent !== window ? window.parent : null);
  if (!source) throw new Error("This preview's owning demo tab is unavailable. Open the preview again from that tab.");
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener("message", receive); reject(new Error("Demo preview handoff timed out. Open it again from the owning tab.")); }, 10000);
    function receive(event: MessageEvent) { if (event.origin !== location.origin || event.source !== source || event.data?.type !== "hosted-demo-preview-response" || event.data.token !== token) return; clearTimeout(timer); window.removeEventListener("message", receive); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.snapshot); }
    window.addEventListener("message", receive);
    source.postMessage({ type: "hosted-demo-preview-request", token }, location.origin);
  });
}
export async function bootstrapHostedDemo() {
  const handoff = await incomingHandoff();
  const validated = validateSiteProject(handoff?.project ?? sample, activeSiteProjectValidationContext);
  if (!validated.ok) throw new Error("Bundled demo project is incompatible with the configured component pack.");
  const assetSeed: DemoAssetSeed = handoff?.assets ?? { snapshot: bundledAsset, bytes: {} };
  if (!handoff) await Promise.all(bundledAsset.records.flatMap((r) => r.document.versions).map(async (v) => { const response = await fetch(`${v.url}?hosted-demo-seed=1`, { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(`Demo assets could not load: ${v.url}`); assetSeed.bytes[v.checksum] = new Uint8Array(await response.arrayBuffer()); }));
  const assets = await createDemoAsset(assetSeed);
  let integration = createProductionProviderIntegration({ project: validated.project, sourceRevision: await computeSiteProjectRevision(validated.project), createProviders: createDemoWorkspaceProviders(), assetProvider: assets.provider });
  if (!("serviceWorker" in navigator)) throw new Error("The hosted demo requires service-worker support for tab-isolated assets.");
  navigator.serviceWorker.addEventListener("message", (event) => { if (event.data?.type === "hosted-demo-assets" && event.ports[0]) event.ports[0].postMessage(assets.readUrl(event.data.pathname)); });
  await Promise.race([navigator.serviceWorker.register("/hosted-demo-assets-worker.js", { scope: "/", updateViaCache: "none" }), new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Demo assets registration timed out. Reload to retry.")), 10000))]);
  await Promise.race([new Promise<void>((resolve) => { if (navigator.serviceWorker.controller) resolve(); else navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }); }), new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Demo assets setup timed out. Reload to retry.")), 10000))]);
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.data?.type !== "hosted-demo-frame-assets" || !event.ports[0]) return;
    const frame = [...document.querySelectorAll("iframe")].find((frame) => frame.contentWindow === event.source && new URL(frame.src, location.href).pathname === "/composer/preview");
    if (frame) event.ports[0].postMessage(assets.readUrl(event.data.pathname));
  });
  const tickets = new Map<string, Window>();
  window.addEventListener("message", (event) => { if (event.origin !== location.origin || event.data?.type !== "hosted-demo-preview-request" || tickets.get(event.data.token) !== event.source) return; const target = tickets.get(event.data.token)!; tickets.delete(event.data.token); void (async () => { try { const capture = await integration.captureWorkspace(); if (capture.status !== "ready") throw new Error("Finish saving edits before opening the working preview."); const assetSnapshot = assets.exportSeed(); if (!await integration.isCaptureCurrent(capture.capture)) throw new Error("The project changed during preview handoff. Open it again."); target.postMessage({ type: "hosted-demo-preview-response", token: event.data.token, snapshot: { project: capture.project, assets: assetSnapshot } }, location.origin); } catch (error) { target.postMessage({ type: "hosted-demo-preview-response", token: event.data.token, error: error instanceof Error ? error.message : "Demo preview failed." }, location.origin); } })(); });
  const openPreview = (url: URL) => { const token = crypto.randomUUID(); url.hash = new URLSearchParams({ demoPreview: token }).toString(); const target = window.open(url.href, "_blank"); if (target) { tickets.set(token, target); setTimeout(() => tickets.delete(token), 15000); } };
  document.addEventListener("click", (event) => {
    const anchor = (event.target as Element | null)?.closest?.("a");
    if (!anchor || anchor.target !== "_blank") return;
    const url = new URL(anchor.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/uploaded-assets/")) return;
    const value = assets.readUrl(url.pathname); if (!value) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const objectUrl = URL.createObjectURL(new Blob([value.bytes], { type: value.mimeType }));
    window.open(objectUrl, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }, true);
  // Explicit handoff for modifier-click/new-window previews. Same-tab navigation
  // remains inside App, so its current integration never gets reconstructed.
  document.addEventListener("click", (event) => { const anchor = (event.target as Element | null)?.closest?.("a"); if (!anchor) return; const url = new URL(anchor.href); if (url.origin !== location.origin || !url.pathname.startsWith("/website-preview") || !(event.ctrlKey || event.metaKey || event.shiftKey || anchor.target === "_blank")) return; event.preventDefault(); event.stopImmediatePropagation(); openPreview(url); }, true);
  const mountPreviewFrame = (frame: HTMLIFrameElement, url = new URL("/website-preview", location.origin)) => {
    if (url.origin !== location.origin || !url.pathname.startsWith("/website-preview")) throw new Error("Demo preview frame requires a same-origin working-preview URL.");
    const token = crypto.randomUUID(); const target = frame.contentWindow;
    if (!target) throw new Error("Attach the preview iframe before requesting its snapshot.");
    url.hash = new URLSearchParams({ demoPreview: token }).toString(); tickets.set(token, target);
    frame.src = url.href; setTimeout(() => tickets.delete(token), 15000);
  };
  return { integration, mountPreviewFrame, onIntegration(next: ProductionProviderIntegration) { integration = next; }, openPreview };
}
