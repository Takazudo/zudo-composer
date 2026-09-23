import { defineConfig } from "@takazudo/zfb/config";
import { zudoDoc } from "@takazudo/zudo-doc/config";
import { withZudoSg } from "@takazudo/zudo-sg/config";
import zudoSgConfig from "./zudo-sg.config.mjs";

export default defineConfig(withZudoSg(zudoDoc({
  siteName: "Shop Styleguide",
  base: "/",
  port: 4398,
  mermaid: false,
  strictContentBridge: true,
}), zudoSgConfig));
