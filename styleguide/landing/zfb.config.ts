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
}), zudoSgConfig));
