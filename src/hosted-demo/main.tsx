/// <reference path="../features/composer/pack-config.d.ts" />
// Dedicated hosted build entry; never imported by the installed local tool.
import { render } from "preact";
import { isSitePath, isWorkingPreviewPath } from "../features/delivery/routing";
import { bootstrapTheme, createThemeController } from "../theme/theme";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app mount point");

const pathname = window.location.pathname;
const failed = (error: unknown): never => {
  root.textContent = error instanceof Error ? error.message : "Hosted demo could not initialize. Reload to retry.";
  throw error;
};

if (isSitePath(pathname) || isWorkingPreviewPath(pathname)) {
  // A visitor document: the host's stylesheet and the visitor sheet only, and
  // no theme bootstrap, so the preview matches what a visitor is served.
  // Both base paths deliver the working preview because the hosted demo has no
  // activated release, and a reload — which has no `#demoPreview` token, the
  // preview document strips it before the exchange — falls back to the
  // bundled public sample.
  const [{ mountSitePreview }, { createHostedDemoIntegration }] = await Promise.all([
    import("../features/delivery/preview-entry"),
    import("./bootstrap"),
  ]);
  const { integration } = await createHostedDemoIntegration().catch(failed);
  mountSitePreview(root, { kind: "working-preview", providers: integration, basePath: isSitePath(pathname) ? "/site" : "/website-preview" }, { hostedDemo: true });
} else {
  // This is deliberately synchronous and precedes every CSS import, including
  // direct route refreshes. The isolated preview later accepts only its host's
  // resolved light/dark session value and does not install host-side listeners.
  const initialTheme = bootstrapTheme();
  if (pathname === "/composer/preview") {
    (await import("./frame-assets")).installComposerDemoAsset();
    void import("../features/composer/preview/preview-entry").then(({ mountComposerPreview }) => mountComposerPreview(root));
  } else {
    const themeController = createThemeController(initialTheme);
    import.meta.hot?.dispose(() => themeController.dispose());
    // The host's base sheet first: it is the only importer of the component
    // pack's CSS, so the pack's own cascade lands before this app's chrome.
    await import("virtual:zudo-composer-host-styles");
    await import("../style.css");
    const { App } = await import("../App");
    const demo = await (await import("./bootstrap")).bootstrapHostedDemo().catch(failed);
    render(<App themeController={themeController} integration={demo?.integration} hostedDemo={Boolean(demo)} onIntegration={demo?.onIntegration} />, root);
  }
}
