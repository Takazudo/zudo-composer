import { afterEach, describe, expect, it, vi } from "vitest";
import { createReviewAnnotator } from "../review-annotations";

class FakeHighlight { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges; } }
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
function canvas(html: string) {
  const root = document.createElement("div");
  root.setAttribute("data-composer-preview-root", "");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe("preview review annotations", () => {
  it("highlights changed words only inside the anchored node, never an identical phrase elsewhere", () => {
    const highlights = new Map<string, FakeHighlight>();
    vi.stubGlobal("CSS", { ...globalThis.CSS, escape: (value: string) => value, highlights });
    vi.stubGlobal("Highlight", FakeHighlight);
    const root = canvas(`
      <div class="zc-node" data-zc-owner="local" data-zc-node-id="a"><section><h2>Plan your week</h2><p>Plan your week</p></section></div>
      <div class="zc-node" data-zc-owner="local" data-zc-node-id="b"><p>Plan your <em>whole</em> week</p></div>`);
    const reports: unknown[] = [];
    const annotator = createReviewAnnotator(window, () => root, (_key, results) => reports.push(results));
    annotator.apply({ key: "k", view: "draft", items: [
      { id: "b", kind: "changed", nodeId: "b", label: "Changed", ordinal: 1, total: 2, texts: [{ text: "Plan your whole week", ranges: [[10, 15]], tone: "insert" }] },
      // Repeated twice inside node a: ambiguous, so it falls back to the explicit block marker.
      { id: "a", kind: "changed", nodeId: "a", label: "Changed", ordinal: 2, total: 2, texts: [{ text: "Plan your week", ranges: [[0, 4]], tone: "insert" }] },
    ] });
    const marked = highlights.get("zc-review-insert")!.ranges;
    expect(marked.map(range => range.toString())).toEqual(["whole"]);
    expect(root.querySelector('[data-zc-node-id="b"]')!.contains(marked[0]!.startContainer)).toBe(true);
    expect(reports).toEqual([[{ id: "b", words: "mapped", located: true }, { id: "a", words: "fallback", located: true }]]);
    const boxes = [...document.querySelectorAll(".zc-review-box")];
    expect(boxes.map(box => box.textContent)).toEqual(["Changed 1/2", "Changed 2/2"]);
    // Annotations never enter the rendered component markup.
    expect(root.innerHTML).not.toContain("zc-review");
    annotator.apply(undefined);
    expect(highlights.size).toBe(0);
    expect(document.querySelectorAll(".zc-review-box")).toHaveLength(0);
    annotator.dispose();
  });

  it("maps across inline markup and whitespace differences, including Japanese text", () => {
    const highlights = new Map<string, FakeHighlight>();
    vi.stubGlobal("CSS", { ...globalThis.CSS, escape: (value: string) => value, highlights });
    vi.stubGlobal("Highlight", FakeHighlight);
    const root = canvas(`<div class="zc-node" data-zc-owner="local" data-zc-node-id="j"><p>初心者に<strong>やさしい</strong>
      説明です。</p></div>`);
    const annotator = createReviewAnnotator(window, () => root, () => {});
    annotator.apply({ key: "k", view: "draft", items: [{ id: "j", kind: "changed", nodeId: "j", label: "Changed", ordinal: 1, total: 1, texts: [{ text: "初心者にやさしい 説明です。", ranges: [[3, 8]], tone: "insert" }] }] });
    expect(highlights.get("zc-review-insert")!.ranges.map(range => range.toString()).join("")).toBe("にやさしい");
    annotator.dispose();
  });

  it("reports an annotation whose node is absent as not located", () => {
    vi.stubGlobal("CSS", { ...globalThis.CSS, escape: (value: string) => value, highlights: new Map() });
    vi.stubGlobal("Highlight", FakeHighlight);
    const root = canvas("<p>Nothing</p>");
    const reports: unknown[] = [];
    const annotator = createReviewAnnotator(window, () => root, (_key, results) => reports.push(results));
    annotator.apply({ key: "k", view: "current", items: [{ id: "x", kind: "removed", nodeId: "x", label: "Removed", ordinal: 1, total: 1, texts: [] }] });
    expect(reports).toEqual([[{ id: "x", words: "none", located: false }]]);
    annotator.dispose();
  });
});
