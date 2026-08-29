import type { SitemapDocument, SitemapNode } from "../../../../sitemapper/model";

export const DESKTOP_MEDIA_QUERY = "(min-width: 64rem)";
export const NODE_WIDTH = 10 * 16;
export const NODE_MIN_HEIGHT = 3.5 * 16;

const DESKTOP_PADDING = 2 * 16;
const MOBILE_PADDING = 0.75 * 16;
const CLUSTER_GUTTER = 3 * 16;
const ROW_GAP = 1.25 * 16;
const MOBILE_ROW_GAP = 1 * 16;
const LEVEL_INDENT = 1.5 * 16;
const MOBILE_INDENT = 1.375 * 16;
const OUTLINE_CONNECTOR_GUTTER = 0.5 * 16;
const CHILD_OFFSET = 2 * 16;
const ROOT_RAIL_DROP = 1.5 * 16;
const MIN_MOBILE_NODE_WIDTH = 15 * 16;

export interface LogicalNode {
  readonly node: SitemapNode;
  readonly parentId: string | null;
  readonly depth: number;
  readonly order: number;
  readonly external: boolean;
  readonly externalCluster: boolean;
}

export interface LogicalTree {
  readonly nodes: readonly LogicalNode[];
  readonly byId: ReadonlyMap<string, LogicalNode>;
  readonly childrenById: ReadonlyMap<string, readonly string[]>;
}

export interface NodeRectangle {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly external: boolean;
  readonly externalCluster: boolean;
}

export interface ConnectorSegment {
  readonly id: string;
  readonly path: string;
  readonly external: boolean;
}

export type CanvasLayoutMode = "cluster" | "outline";

export interface CanvasLayout {
  readonly mode: CanvasLayoutMode;
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly NodeRectangle[];
  readonly segments: readonly ConnectorSegment[];
}

export type NodeHeights = ReadonlyMap<string, number>;

export function isExternalSlug(slug: string | undefined): boolean {
  if (!slug) return false;
  try {
    const url = new URL(slug);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function descendants(node: SitemapNode): SitemapNode[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

export function buildLogicalTree(document: SitemapDocument): LogicalTree {
  const nodes: LogicalNode[] = [];
  const byId = new Map<string, LogicalNode>();
  const childrenById = new Map<string, readonly string[]>();
  const root = document.root[0];

  const walk = (
    node: SitemapNode,
    parentId: string | null,
    depth: number,
    inheritedExternalCluster: boolean,
  ): void => {
    const allDescendants = descendants(node);
    const startsExternalCluster = depth === 1 && (
      isExternalSlug(node.slug)
      || (allDescendants.length > 0 && allDescendants.every((item) => isExternalSlug(item.slug)))
    );
    const logical: LogicalNode = Object.freeze({
      node,
      parentId,
      depth,
      order: nodes.length,
      external: isExternalSlug(node.slug),
      externalCluster: inheritedExternalCluster || startsExternalCluster,
    });
    nodes.push(logical);
    byId.set(node.id, logical);
    childrenById.set(node.id, Object.freeze(node.children.map((child) => child.id)));
    for (const child of node.children) {
      walk(child, node.id, depth + 1, logical.externalCluster);
    }
  };

  if (root) walk(root, null, 0, false);
  return Object.freeze({ nodes: Object.freeze(nodes), byId, childrenById });
}

function half(value: number): number {
  return Math.round(value * 2) / 2;
}

function point(value: number): string {
  const rounded = half(value);
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

function segment(
  id: string,
  commands: readonly (readonly ["M", number, number] | readonly ["H" | "V", number])[],
  external: boolean,
): ConnectorSegment {
  const path = commands.map((command) => command[0] === "M"
    ? `M ${point(command[1])} ${point(command[2])}`
    : `${command[0]} ${point(command[1])}`).join(" ");
  return Object.freeze({ id, path, external });
}

function nodeHeight(id: string, heights: NodeHeights): number {
  return Math.max(NODE_MIN_HEIGHT, heights.get(id) ?? NODE_MIN_HEIGHT);
}

function connectors(
  tree: LogicalTree,
  rectangles: readonly NodeRectangle[],
  mode: CanvasLayout["mode"],
): readonly ConnectorSegment[] {
  const rectById = new Map(rectangles.map((rectangle) => [rectangle.id, rectangle]));
  const output: ConnectorSegment[] = [];
  const root = rectangles.find((rectangle) => rectangle.depth === 0);

  for (const parent of rectangles) {
    const childIds = tree.childrenById.get(parent.id) ?? [];
    const children = childIds.flatMap((id) => {
      const rectangle = rectById.get(id);
      return rectangle ? [rectangle] : [];
    });
    if (children.length === 0) continue;

    if (mode === "cluster" && parent.id === root?.id) {
      const railY = parent.top + parent.height + ROOT_RAIL_DROP;
      const centers = children.map((child) => child.left + child.width / 2);
      if (children.length === 1) {
        const child = children[0]!;
        output.push(segment(
          `${parent.id}:${child.id}`,
          [["M", parent.left + parent.width / 2, parent.top + parent.height], ["V", child.top]],
          child.external || child.externalCluster,
        ));
        continue;
      }
      output.push(segment(
        `${parent.id}:root-drop`,
        [["M", parent.left + parent.width / 2, parent.top + parent.height], ["V", railY]],
        false,
      ));
      output.push(segment(`${parent.id}:rail`, [["M", centers[0]!, railY], ["H", centers.at(-1)!]], false));
      children.forEach((child, index) => {
        output.push(segment(
          `${parent.id}:${child.id}`,
          [["M", centers[index]!, railY], ["V", child.top]],
          child.external || child.externalCluster,
        ));
      });
      continue;
    }

    if (mode === "outline") {
      // Child boxes can share their parent's left edge once depth indentation
      // clamps. Derive the spine from the child border rather than applying a
      // desktop offset inside the boxes. When the gutter falls outside the
      // parent, lead horizontally from its bottom border before descending.
      const spineX = Math.min(...children.map((child) => child.left)) - OUTLINE_CONNECTOR_GUTTER;
      const parentAnchorX = Math.min(
        Math.max(spineX, parent.left),
        parent.left + parent.width,
      );
      const lastY = children.at(-1)!.top + children.at(-1)!.height / 2;
      const spineCommands: Array<readonly ["M", number, number] | readonly ["H" | "V", number]> = [
        ["M", parentAnchorX, parent.top + parent.height],
      ];
      if (parentAnchorX !== spineX) spineCommands.push(["H", spineX]);
      spineCommands.push(["V", lastY]);
      output.push(segment(`${parent.id}:spine`, spineCommands, parent.externalCluster));
      children.forEach((child) => {
        const centerY = child.top + child.height / 2;
        output.push(segment(
          `${parent.id}:${child.id}`,
          [["M", spineX, centerY], ["H", child.left]],
          parent.externalCluster || child.external || child.externalCluster,
        ));
      });
      continue;
    }

    const spineX = parent.left + LEVEL_INDENT;
    const lastY = children.at(-1)!.top + children.at(-1)!.height / 2;
    output.push(segment(
      `${parent.id}:spine`,
      [["M", spineX, parent.top + parent.height], ["V", lastY]],
      parent.externalCluster,
    ));
    children.forEach((child) => {
      const centerY = child.top + child.height / 2;
      output.push(segment(
        `${parent.id}:${child.id}`,
        [["M", spineX, centerY], ["H", child.left]],
        parent.externalCluster || child.external || child.externalCluster,
      ));
    });
  }
  return Object.freeze(output);
}

function outlineLayout(tree: LogicalTree, heights: NodeHeights, viewportWidth: number): CanvasLayout {
  let top = MOBILE_PADDING;
  let right = viewportWidth;
  const nodes = tree.nodes.map((logical) => {
    const visibleDepth = Math.min(logical.depth, 4);
    const left = MOBILE_PADDING + visibleDepth * MOBILE_INDENT;
    const width = Math.max(MIN_MOBILE_NODE_WIDTH, viewportWidth - MOBILE_PADDING * 2 - visibleDepth * MOBILE_INDENT);
    const height = nodeHeight(logical.node.id, heights);
    const rectangle = Object.freeze({
      id: logical.node.id,
      left,
      top,
      width,
      height,
      depth: logical.depth,
      external: logical.external,
      externalCluster: logical.externalCluster,
    });
    top += height + MOBILE_ROW_GAP;
    right = Math.max(right, left + width + MOBILE_PADDING);
    return rectangle;
  });
  const height = Math.max(0, top - MOBILE_ROW_GAP + MOBILE_PADDING);
  return Object.freeze({
    mode: "outline",
    width: right,
    height,
    nodes: Object.freeze(nodes),
    segments: connectors(tree, nodes, "outline"),
  });
}

interface ClusterDraft {
  readonly logical: LogicalNode;
  readonly localLeft: number;
  readonly localTop: number;
  readonly width: number;
  readonly height: number;
}

function clusterLayout(tree: LogicalTree, heights: NodeHeights, viewportWidth: number): CanvasLayout {
  const rootLogical = tree.nodes[0];
  if (!rootLogical) return Object.freeze({
    mode: "cluster",
    width: viewportWidth,
    height: 0,
    nodes: Object.freeze([]),
    segments: Object.freeze([]),
  });
  const depthOne = tree.nodes.filter((node) => node.depth === 1);
  const clusters: { drafts: ClusterDraft[]; width: number; height: number }[] = [];

  for (const clusterRoot of depthOne) {
    const members = tree.nodes.filter((candidate) => {
      let current: LogicalNode | undefined = candidate;
      while (current?.parentId) {
        if (current.parentId === clusterRoot.node.id) return true;
        current = tree.byId.get(current.parentId);
      }
      return candidate.node.id === clusterRoot.node.id;
    });
    let top = 0;
    let right = NODE_WIDTH;
    const drafts = members.map((member) => {
      const relativeDepth = member.depth - 1;
      const left = relativeDepth === 0 ? 0 : CHILD_OFFSET + (relativeDepth - 1) * LEVEL_INDENT;
      const height = nodeHeight(member.node.id, heights);
      const draft = { logical: member, localLeft: left, localTop: top, width: NODE_WIDTH, height };
      top += height + ROW_GAP;
      right = Math.max(right, left + NODE_WIDTH);
      return draft;
    });
    clusters.push({ drafts, width: right, height: Math.max(0, top - ROW_GAP) });
  }

  const footprintsWidth = clusters.reduce((sum, cluster) => sum + cluster.width, 0)
    + Math.max(0, clusters.length - 1) * CLUSTER_GUTTER;
  const rootHeight = nodeHeight(rootLogical.node.id, heights);
  const clusterTop = DESKTOP_PADDING + rootHeight + ROOT_RAIL_DROP * 2;
  const contentWidth = Math.max(NODE_WIDTH, footprintsWidth);
  const stageWidth = Math.max(viewportWidth, contentWidth + DESKTOP_PADDING * 2);
  const contentLeft = (stageWidth - footprintsWidth) / 2;
  const rootLeft = (stageWidth - NODE_WIDTH) / 2;
  const nodes: NodeRectangle[] = [Object.freeze({
    id: rootLogical.node.id,
    left: rootLeft,
    top: DESKTOP_PADDING,
    width: NODE_WIDTH,
    height: rootHeight,
    depth: 0,
    external: rootLogical.external,
    externalCluster: false,
  })];
  let clusterLeft = contentLeft;
  let maxBottom = DESKTOP_PADDING + rootHeight;
  for (const cluster of clusters) {
    for (const draft of cluster.drafts) {
      nodes.push(Object.freeze({
        id: draft.logical.node.id,
        left: clusterLeft + draft.localLeft,
        top: clusterTop + draft.localTop,
        width: draft.width,
        height: draft.height,
        depth: draft.logical.depth,
        external: draft.logical.external,
        externalCluster: draft.logical.externalCluster,
      }));
      maxBottom = Math.max(maxBottom, clusterTop + draft.localTop + draft.height);
    }
    clusterLeft += cluster.width + CLUSTER_GUTTER;
  }
  const frozenNodes = Object.freeze(nodes);
  return Object.freeze({
    mode: "cluster",
    width: stageWidth,
    height: maxBottom + DESKTOP_PADDING,
    nodes: frozenNodes,
    segments: connectors(tree, frozenNodes, "cluster"),
  });
}

/**
 * Pure, immutable measured layout. `viewportWidth` is the actual canvas
 * scrollport used for geometry; `mode` comes from the page-level media seam.
 */
export function layoutSitemap(
  tree: LogicalTree,
  heights: NodeHeights,
  viewportWidth: number,
  mode: CanvasLayoutMode,
): CanvasLayout {
  const safeWidth = Math.max(0, viewportWidth);
  return mode === "cluster"
    ? clusterLayout(tree, heights, safeWidth)
    : outlineLayout(tree, heights, safeWidth);
}
