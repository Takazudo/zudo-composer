/** Only the isolated same-origin Composer iframe forwards requests to its host. */
export function installComposerDemoMedia() {
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type !== "hosted-demo-media" || !event.ports[0] || parent === window) return;
    parent.postMessage({ type: "hosted-demo-frame-media", pathname: event.data.pathname }, location.origin, [event.ports[0]]);
  });
}
