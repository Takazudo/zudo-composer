/* global self, fetch, URL, MessageChannel, setTimeout, clearTimeout, Response, bundledAssetPaths */
/* Disposable demo byte delivery. No durable storage or response caches. */
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const config = self.__zudoAssetConfig;
  const authoring = config.authoringUrlPattern.test(url.pathname);
  const immutable = config.checksumUrlPattern.test(url.pathname);
  if (!authoring && !immutable) return;
  if (url.searchParams.has("hosted-demo-seed") && bundledAssetPaths.includes(url.pathname)) return;
  event.respondWith((async () => {
    const fallback = () => bundledAssetPaths.includes(url.pathname) ? fetch(event.request) : new Response("Demo asset unavailable in this tab", { status: 404 });
    if (!event.clientId) return fallback();
    const client = await self.clients.get(event.clientId);
    if (!client) return fallback();
    const result = await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 4000);
      channel.port1.onmessage = ({ data }) => { clearTimeout(timer); channel.port1.close(); resolve(data); };
      client.postMessage({ type: "hosted-demo-assets", pathname: url.pathname }, [channel.port2]);
    });
    if (!result) return fallback();
    if (authoring && config.checksumUrlPattern.test(result.url ?? "")) {
      return new Response(null, { status: 307, headers: { Location: result.url, "Cache-Control": "no-store", "X-Content-Type-Options": config.nosniff } });
    }
    const extension = url.pathname.slice(url.pathname.lastIndexOf(".") + 1).toLowerCase();
    const mimeType = result.mimeType ?? config.contentTypeByExtension[extension];
    const checksum = result.checksum ?? (immutable ? url.pathname.slice("/uploaded-assets/sha256-".length, url.pathname.lastIndexOf(".")) : undefined);
    const headers = {
      "Content-Type": mimeType,
      "Content-Length": String(result.byteLength ?? result.bytes.byteLength),
      "Cache-Control": config.immutableCacheControl,
      "X-Content-Type-Options": config.nosniff,
    };
    const descriptor = config.kindsByMime[mimeType];
    if (descriptor && !descriptor.inline && checksum) headers["Content-Disposition"] = `attachment; filename="${checksum}.${descriptor.extension}"`;
    return new Response(event.request.method === "HEAD" ? null : result.bytes, { headers });
  })());
});
