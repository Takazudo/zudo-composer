import type { ReviewAnnotatedMessage, ReviewAnnotation, ReviewAnnotations } from "./protocol";

type Result = ReviewAnnotatedMessage["results"][number];
const INSERT = "zc-review-insert", DELETE = "zc-review-delete";
interface Marked { annotation: ReviewAnnotation; wrapper: HTMLElement; box: HTMLElement; badge: HTMLElement }
interface TextIndex { full: string; nodes: { node: Text; start: number }[] }

/** Text nodes of one rendered component, excluding editor chrome, with cumulative offsets. */
function indexText(root: Element): TextIndex {
  const nodes: TextIndex["nodes"] = [];
  let full = "";
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement?.closest(".zc-chrome, [data-zc-review-layer]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) { nodes.push({ node, start: full.length }); full += node.data; }
  return { full, nodes };
}
/** Whitespace-collapsed string plus a map from each collapsed index back to the original index. */
function collapse(text: string): { value: string; map: number[] } {
  let value = ""; const map: number[] = [];
  let space = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (/\s/.test(char)) { if (!space && value) { value += " "; map.push(index); } space = true; continue; }
    space = false; value += char; map.push(index);
  }
  return { value, map };
}
/** Finds one unambiguous occurrence of an exact field string inside the node's own text; never a document-wide search. */
function locate(index: TextIndex, text: string): ((offset: number) => number) | null {
  const first = index.full.indexOf(text);
  if (first >= 0 && index.full.indexOf(text, first + 1) < 0) return offset => first + offset;
  // Rendered text may differ only in whitespace (line breaks, indentation).
  const full = collapse(index.full), needle = collapse(text);
  if (!needle.value) return null;
  const at = full.value.indexOf(needle.value);
  if (at < 0 || full.value.indexOf(needle.value, at + 1) >= 0) return null;
  const inverse = new Map(needle.map.map((original, collapsed) => [original, collapsed]));
  return offset => {
    let cursor = offset;
    while (cursor < text.length && !inverse.has(cursor)) cursor++;
    const collapsed = inverse.get(cursor) ?? needle.value.length;
    return collapsed >= needle.value.length ? (full.map[at + needle.value.length - 1] ?? 0) + 1 : full.map[at + collapsed]!;
  };
}
function domRange(index: TextIndex, start: number, end: number): Range | null {
  const point = (offset: number, preferEnd: boolean) => {
    for (let i = 0; i < index.nodes.length; i++) {
      const { node, start: from } = index.nodes[i]!;
      const to = from + node.data.length;
      if (offset < to || (preferEnd && offset === to) || i === index.nodes.length - 1) return { node, offset: Math.max(0, Math.min(node.data.length, offset - from)) };
    }
    return null;
  };
  const a = point(start, false), b = point(end, true);
  if (!a || !b || end <= start) return null;
  const range = index.full.length ? new Range() : null;
  range?.setStart(a.node, a.offset); range?.setEnd(b.node, b.offset);
  return range;
}

/**
 * Editor-owned review decorations inside the preview document. Words use the
 * CSS Custom Highlight API (no DOM or layout change); blocks use an absolutely
 * positioned, non-interactive layer appended to <body>. Nothing touches the
 * rendered components' own markup.
 */
export function createReviewAnnotator(win: Window, canvas: () => Element | null, report: (key: string, results: Result[]) => void) {
  const doc = win.document;
  const highlights = (win as Window & { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
  const HighlightCtor = (win as Window & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  let layer: HTMLElement | null = null;
  let marked: Marked[] = [];
  let fallbackRects: { range: Range; tone: "insert" | "delete" }[] = [];
  let current: ReviewAnnotations | undefined;
  let frame = 0;
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => schedule()) : null;
  const mutation = typeof MutationObserver === "function" ? new MutationObserver(records => { if (records.some(record => !(record.target instanceof Element && record.target.closest("[data-zc-review-layer]")))) scheduleReapply(); }) : null;
  let reapplyTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleReapply = () => { clearTimeout(reapplyTimer); reapplyTimer = setTimeout(() => apply(current), 60); };
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; position(); }); };
  const ensureLayer = () => {
    if (layer?.isConnected) return layer;
    layer = doc.createElement("div");
    layer.className = "zc-review-layer";
    layer.setAttribute("data-zc-review-layer", "");
    layer.setAttribute("aria-hidden", "true");
    doc.body.append(layer);
    return layer;
  };
  const clear = () => {
    highlights?.delete(INSERT); highlights?.delete(DELETE);
    for (const item of marked) resize?.unobserve(item.wrapper);
    marked = []; fallbackRects = [];
    layer?.replaceChildren();
  };
  const position = () => {
    if (!layer) return;
    const scrollX = win.scrollX, scrollY = win.scrollY;
    for (const item of marked) {
      if (!item.wrapper.isConnected) { item.box.hidden = true; continue; }
      const rect = item.wrapper.getBoundingClientRect();
      const width = Math.max(rect.width, 24), height = Math.max(rect.height, 16);
      item.box.hidden = false;
      Object.assign(item.box.style, { left: `${rect.left + scrollX - 4}px`, top: `${rect.top + scrollY - 4}px`, width: `${width + 8}px`, height: `${height + 8}px` });
      // The label sits outside the box, above it unless the page edge is too close.
      item.badge.dataset.placement = rect.top + scrollY < 28 ? "below" : "above";
    }
    if (fallbackRects.length) {
      for (const node of [...layer.querySelectorAll(".zc-review-word")]) node.remove();
      for (const { range, tone } of fallbackRects) for (const rect of range.getClientRects()) {
        const mark = doc.createElement("div");
        mark.className = "zc-review-word"; mark.dataset.tone = tone;
        Object.assign(mark.style, { left: `${rect.left + scrollX}px`, top: `${rect.top + scrollY}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        layer.prepend(mark);
      }
    }
  };
  const apply = (review: ReviewAnnotations | undefined) => {
    current = review;
    clear();
    if (!review?.items.length) return;
    const root = canvas();
    if (!root) return;
    const container = ensureLayer();
    const ranges: Record<"insert" | "delete", Range[]> = { insert: [], delete: [] };
    const results: Result[] = [];
    for (const annotation of review.items) {
      const wrapper = root.querySelector<HTMLElement>(`[data-zc-owner="local"][data-zc-node-id="${CSS.escape(annotation.nodeId)}"]`);
      if (!wrapper) { results.push({ id: annotation.id, words: annotation.texts.some(text => text.ranges.length) ? "fallback" : "none", located: false }); continue; }
      const componentRoot = [...wrapper.children].find(child => !child.classList.contains("zc-chrome")) ?? wrapper;
      const index = indexText(componentRoot);
      let mapped = 0, wanted = 0;
      for (const entry of annotation.texts) {
        if (!entry.ranges.length) continue;
        const map = locate(index, entry.text);
        // Alternative text and titles are real field values but not visible words; the block marker covers them.
        if (!map && [...componentRoot.querySelectorAll("[alt], [title], [aria-label]")].some(element => ["alt", "title", "aria-label"].some(name => element.getAttribute(name) === entry.text))) continue;
        wanted++;
        if (!map) continue;
        let ok = true;
        for (const [start, end] of entry.ranges) {
          const range = domRange(index, map(start), map(end));
          if (range) ranges[entry.tone].push(range); else ok = false;
        }
        if (ok) mapped++;
      }
      const box = doc.createElement("div");
      box.className = "zc-review-box"; box.dataset.kind = annotation.kind; box.dataset.annotation = annotation.id;
      const badge = doc.createElement("div");
      badge.className = "zc-review-badge";
      badge.textContent = `${annotation.label} ${annotation.ordinal}/${annotation.total}`;
      box.append(badge);
      container.append(box);
      resize?.observe(wrapper);
      marked.push({ annotation, wrapper, box, badge });
      results.push({ id: annotation.id, words: !wanted ? "none" : mapped === wanted ? "mapped" : "fallback", located: true });
    }
    if (highlights && HighlightCtor) {
      if (ranges.insert.length) highlights.set(INSERT, new HighlightCtor(...ranges.insert));
      if (ranges.delete.length) highlights.set(DELETE, new HighlightCtor(...ranges.delete));
    } else fallbackRects = [...ranges.insert.map(range => ({ range, tone: "insert" as const })), ...ranges.delete.map(range => ({ range, tone: "delete" as const }))];
    position();
    report(review.key, results);
  };
  const onScroll = () => schedule();
  win.addEventListener("scroll", onScroll, { passive: true });
  win.addEventListener("resize", onScroll);
  doc.addEventListener("load", onScroll, true);
  const fonts = (doc as Document & { fonts?: EventTarget & { ready?: Promise<unknown> } }).fonts;
  fonts?.addEventListener?.("loadingdone", onScroll);
  void fonts?.ready?.then(onScroll);
  if (resize) resize.observe(doc.documentElement);
  return {
    apply(review: ReviewAnnotations | undefined) {
      const root = canvas();
      mutation?.disconnect();
      apply(review);
      if (root && review?.items.length) mutation?.observe(root, { subtree: true, childList: true, characterData: true });
    },
    focus(id: string) {
      const item = marked.find(entry => entry.annotation.id === id);
      if (!item) return;
      item.wrapper.scrollIntoView({ block: "center", inline: "nearest" });
      for (const entry of marked) delete entry.box.dataset.focus;
      item.box.dataset.focus = "";
      schedule();
      win.setTimeout(() => { delete item.box.dataset.focus; }, 1600);
    },
    dispose() {
      mutation?.disconnect(); resize?.disconnect(); clearTimeout(reapplyTimer);
      if (frame) win.cancelAnimationFrame(frame);
      win.removeEventListener("scroll", onScroll); win.removeEventListener("resize", onScroll); doc.removeEventListener("load", onScroll, true);
      fonts?.removeEventListener?.("loadingdone", onScroll);
      clear(); layer?.remove(); layer = null;
    },
  };
}
