/* global HTMLAnchorElement, document, AbortController, setTimeout, URL, location, fetch, Blob, clearTimeout */
/**
 * Self-contained browser handler. JSX export embeds this function's source,
 * so keep every dependency inside the function or on browser globals.
 * @param {MouseEvent} event
 * @param {number} maxBytes
 */
export async function downloadAsset(event, maxBytes) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.currentTarget;
  if (!(anchor instanceof HTMLAnchorElement)) return;
  event.preventDefault();
  if (anchor.getAttribute("aria-busy") === "true") return;
  let status = anchor.querySelector("[data-asset-download-status]");
  if (!status || status.getAttribute("data-asset-download-status") !== "true") {
    status = document.createElement("span");
    status.setAttribute("data-asset-download-status", "true");
    status.setAttribute("role", "status");
    anchor.append(status);
  }
  status.textContent = " Downloading…";
  anchor.setAttribute("aria-busy", "true");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let reader;
  try {
    const url = new URL(anchor.href, document.baseURI);
    if (url.origin !== location.origin || (url.protocol !== "blob:" && !/^\/uploaded-assets\/sha256-[a-f0-9]{64}\.[a-z0-9]+$/.test(url.pathname))) throw new Error("Invalid asset URL");
    const response = await fetch(url.href, { signal: controller.signal, credentials: "same-origin", redirect: "error" });
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maxBytes) throw new Error("Asset unavailable or too large");
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Asset too large"); }
      chunks.push(new Uint8Array(value).buffer);
    }
    const blob = new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
    const objectUrl = URL.createObjectURL(blob);
    const temporary = document.createElement("a");
    temporary.href = objectUrl;
    temporary.download = anchor.download;
    temporary.hidden = true;
    try { document.body.append(temporary); temporary.click(); }
    finally { temporary.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }
    status.textContent = " Download started.";
  } catch {
    status.textContent = " Download failed. Select the link to retry.";
  } finally {
    controller.abort();
    reader?.releaseLock();
    clearTimeout(timeout);
    anchor.removeAttribute("aria-busy");
  }
}
