import { afterEach, describe, expect, it, vi } from "vitest";
import { minify } from "vite";
import { downloadAsset } from "../../browser/asset-download.mjs";

const url = "/uploaded-assets/sha256-" + "a".repeat(64) + ".zip";
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function anchorFor(handler = downloadAsset, maxBytes = 25 * 1024 * 1024) {
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "Release.v2.zip"; anchor.textContent = "Download"; document.body.append(anchor);
  let pending: Promise<void> | undefined;
  anchor.addEventListener("click", (event) => { pending = handler(event, maxBytes); });
  return { anchor, click(options: MouseEventInit = {}) { const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...options }); anchor.dispatchEvent(event); return { event, pending }; } };
}
function response(bytes: Uint8Array, length?: string) {
  return { ok: true, headers: new Headers({ "content-type": "application/zip", ...(length ? { "content-length": length } : {}) }), body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
}

describe("human filename download bridge", () => {
  it("preserves bytes and filename and revokes the Blob URL, including minified emitted code", async () => {
    const minified = await minify("download.js", `globalThis.handler = ${downloadAsset.toString()};`, { compress: true, mangle: true });
    const isolated: { handler?: typeof downloadAsset } = {}; new Function("globalThis", minified.code)(isolated);
    for (const handler of [downloadAsset, isolated.handler!]) {
      const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
      const fetch = vi.fn<(url: string, options: RequestInit) => Promise<ReturnType<typeof response>>>(async () => response(bytes)); vi.stubGlobal("fetch", fetch);
      const create = vi.fn<(blob: Blob) => string>(() => "blob:test-download"); const revoke = vi.fn();
      vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
      const saved = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.href).toBe("blob:test-download"); expect(this.download).toBe("Release.v2.zip");
      });
      const item = anchorFor(handler); const clicked = item.click(); expect(clicked.event.defaultPrevented).toBe(true); await clicked.pending;
      expect(fetch).toHaveBeenCalledWith(new URL(url, document.baseURI).href, expect.objectContaining({ redirect: "error" }));
      expect(fetch.mock.calls[0]![1].signal!.aborted).toBe(true);
      expect(saved).toHaveBeenCalledOnce();
      const blob = create.mock.calls[0]![0] as Blob;
      const data = await new Promise<ArrayBuffer>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(blob); });
      expect(new Uint8Array(data)).toEqual(bytes);
      expect(item.anchor).toHaveAttribute("href", url); expect(item.anchor).toHaveAttribute("download", "Release.v2.zip");
      expect(item.anchor).not.toHaveAttribute("aria-busy");
      await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:test-download"), { timeout: 2000 });
      item.anchor.remove(); expect(document.querySelector("[role=status]")).toBeNull();
      saved.mockRestore(); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals();
    }
  });
  it.each(["declared", "stream", "network"])("shows a retryable failure and aborts the %s response", async (failure) => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn(async (_url: string, options: RequestInit) => { signal = options.signal ?? undefined; if (failure === "network") throw new Error("Offline"); return response(new Uint8Array(8), failure === "declared" ? "100" : undefined); });
    vi.stubGlobal("fetch", fetch);
    const item = anchorFor(downloadAsset, 4); await item.click().pending;
    expect(signal!.aborted).toBe(true); expect(item.anchor).not.toHaveAttribute("aria-busy");
    expect(item.anchor.querySelector("[role=status]")).toHaveTextContent("Download failed. Select the link to retry.");
    await item.click().pending; expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("leaves modified clicks native and suppresses duplicate normal clicks", async () => {
    const fetch = vi.fn<(url: string, options: RequestInit) => Promise<unknown>>(() => new Promise(() => undefined)); vi.stubGlobal("fetch", fetch);
    const item = anchorFor();
    item.anchor.removeAttribute("href"); // jsdom need not perform a native navigation.
    const modified = item.click({ ctrlKey: true }); expect(modified.event.defaultPrevented).toBe(false); expect(fetch).not.toHaveBeenCalled();
    item.anchor.href = url;
    // Abort-aware failure lets the pending operation clean up without waiting on its timeout.
    fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(new Error("aborted")))));
    vi.useFakeTimers(); const first = item.click(); item.click(); expect(fetch).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(30000); await first.pending;
    expect(item.anchor).not.toHaveAttribute("aria-busy");
  });
});
