import { h } from "@takazudo/zfb/zudo-react";

export function Banner({ headline }) {
  return h("h1", { class: "self-host-root-banner" }, headline);
}
