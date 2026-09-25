import { defineConfig } from "@takazudo/zfb/config";
import { zudoDoc } from "@takazudo/zudo-doc/config";
import { withZudoSg } from "@takazudo/zudo-sg/config";
import zudoSgConfig from "./zudo-sg.config.mjs";

export default defineConfig(withZudoSg(zudoDoc({
  siteName: "Landing Styleguide",
  base: "/",
  port: 4399,
  mermaid: false,
  strictContentBridge: true,
  // Bundling follows `bundleZdtp ?? designTokenPanel`; this host never
  // sets `designTokenPanel`, so without this the zdtp loader resolves to
  // zudo-doc's throwing stub and the engine's preview token panel
  // (opened from the header trigger `withZudoSg` injects) rejects at
  // runtime (zudolab/zudo-doc#4261).
  bundleZdtp: true,
  // Mounts the preview token panel bootstrap on every package-owned
  // route (/components/*, /tokens), not just this host's host-owned
  // `/`. See pages/lib/_chrome-bindings.tsx.
  chromeBindingsModule: "./pages/lib/_chrome-bindings.tsx",
}), zudoSgConfig));
