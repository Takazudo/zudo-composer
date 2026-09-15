import { h } from "preact";

export function Banner({ headline }) {
  return h("h1", { class: "self-host-root-banner" }, headline);
}
