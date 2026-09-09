/** Only the isolated same-origin Composer iframe forwards requests to its host. */
export function installComposerDemoAsset() {
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type !== "hosted-demo-assets" || !event.ports[0] || parent === window) return;
    parent.postMessage({ type: "hosted-demo-frame-assets", pathname: event.data.pathname }, location.origin, [event.ports[0]]);
  });
}
