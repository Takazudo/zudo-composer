/* global self, fetch, URL, MessageChannel, setTimeout, clearTimeout, Response, bundledMediaPaths */
/* Disposable demo byte delivery. No durable storage or response caches. */
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !/^\/uploaded-media\/(?:asset-[a-z0-9_-]+|sha256-[a-f0-9]{64}\.(?:png|jpg|gif|webp|pdf))$/.test(url.pathname)) return;
  if (url.searchParams.has("hosted-demo-seed") && bundledMediaPaths.includes(url.pathname)) return;
  event.respondWith((async () => {
    const fallback = () => bundledMediaPaths.includes(url.pathname) ? fetch(event.request) : new Response("Demo asset unavailable in this tab", { status: 404 });
    if (!event.clientId) return fallback();
    const client = await self.clients.get(event.clientId);
    if (!client) return fallback();
    const result = await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 4000);
      channel.port1.onmessage = ({ data }) => { clearTimeout(timer); channel.port1.close(); resolve(data); };
      client.postMessage({ type: "hosted-demo-media", pathname: url.pathname }, [channel.port2]);
    });
    if (!result) return fallback();
    return new Response(result.bytes, { headers: { "Content-Type": result.mediaType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  })());
});
