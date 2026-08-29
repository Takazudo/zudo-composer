import { h } from "preact";
import type { FunctionComponent, JSX } from "preact";

interface IconProps {
  width?: number;
  height?: number;
  class?: string;
  style?: string | JSX.CSSProperties;
  size?: "xs" | "sm" | "md" | "lg";
}

type Icon = FunctionComponent<IconProps>;
type Shape = JSX.Element;

function icon(children: Shape[], stroke = false): Icon {
  return ({ width, height, size = "md", class: className, style }) => {
    const tokenSize = { xs: 12, sm: 16, md: 20, lg: 24 }[size];
    return h("svg", {
    "aria-hidden": "true",
    viewBox: "0 0 16 16",
    width: width ?? tokenSize,
    height: height ?? tokenSize,
    class: className,
    style,
    fill: stroke ? "none" : "currentColor",
    stroke: stroke ? "currentColor" : undefined,
    "stroke-width": stroke ? 1.5 : undefined,
    "stroke-linecap": stroke ? "round" : undefined,
    "stroke-linejoin": stroke ? "round" : undefined,
    }, children);
  };
}

export const ChevronRightIcon = icon([h("path", { d: "M6.25 3.75 10.5 8l-4.25 4.25" })], true);
export const ChevronDownIcon = icon([h("path", { d: "m3.75 6.25 4.25 4.25 4.25-4.25" })], true);
export const ChevronUpIcon = icon([h("path", { d: "m3.75 9.75 4.25-4.25 4.25 4.25" })], true);
export const PlusIcon = icon([h("path", { d: "M8 2.5v11M2.5 8h11" })], true);
export const CopyIcon = icon([
  h("rect", { x: 5.5, y: 5.5, width: 8.5, height: 8.5, rx: 1.25 }),
  h("path", { d: "M3.25 10.75h-.5a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5h6a1.5 1.5 0 0 1 1.5 1.5v.5" }),
], true);
export const TrashIcon = icon([
  h("path", { d: "M3.5 4.5h9M6 4.5v-2h4v2M5 6.5v6M8 6.5v6M11 6.5v6M4 4.5l.75 9h6.5l.75-9" }),
], true);
export const PageIcon = icon([
  h("rect", { x: 1.75, y: 2.25, width: 12.5, height: 11.5, rx: 1.25 }),
  h("line", { x1: 1.75, y1: 5.25, x2: 14.25, y2: 5.25 }),
], true);
