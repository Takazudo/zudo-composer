import { authoringProbeMessage, readPreviewToParent, type PreviewPackIdentity } from "../composer/preview/protocol";

const editing = '[data-zc-inline-editing], [data-zc-prose-editing], [data-zc-prose-chrome], [contenteditable]:not([contenteditable="false"])';

/** The parent registry cannot see unsaved inline drafts inside a preview. */
export function createFrameInputGuard(root: () => HTMLElement | null, host: Window, pack: PreviewPackIdentity, probeMs = 2000) {
  const locked = new Set<HTMLElement>();
  let inputLocked = false;
  const frames = () => [...(root()?.querySelectorAll<HTMLIFrameElement>("iframe") ?? [])];
  const documentOf = (frame: HTMLIFrameElement) => {
    try { return new URL(frame.src, host.location.href).origin === host.location.origin ? frame.contentDocument : null; } catch { return null; }
  };
  const lockFrame = (frame: HTMLIFrameElement) => {
    const element = documentOf(frame)?.documentElement;
    if (element && !element.inert) { locked.add(element); element.inert = true; }
  };
  // A new document must not create an unlocked input lane during preparation.
  const loaded = (event: Event) => {
    if (inputLocked && event.target instanceof HTMLIFrameElement && root()?.contains(event.target)) lockFrame(event.target);
  };
  host.addEventListener("load", loaded, true);
  return {
    busy() { return frames().some(frame => { const document = documentOf(frame); return !document || !!document.querySelector(editing); }); },
    lock(value: boolean) {
      inputLocked = value;
      if (value) for (const frame of frames()) lockFrame(frame);
      else { for (const element of locked) element.inert = false; locked.clear(); }
    },
    async settled(): Promise<boolean> {
      const answers = await Promise.all(frames().map(frame => new Promise<boolean>(resolve => {
        const source = frame.contentWindow, document = documentOf(frame);
        if (!source || !document || document.querySelector(editing)) return resolve(false);
        const nonce = [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, "0")).join("");
        const finish = (clean: boolean) => { clearTimeout(timer); host.removeEventListener("message", answer); resolve(clean); };
        const answer = (event: MessageEvent) => {
          const result = readPreviewToParent(event, { source, origin: host.location.origin, pack });
          if (!result.ok || result.message.type !== "authoring-settled" || result.message.nonce !== nonce) return;
          finish(result.message.clean && !!root()?.contains(frame) && frame.contentWindow === source && frame.contentDocument === document && !document.querySelector(editing));
        };
        const timer = setTimeout(() => finish(false), probeMs);
        host.addEventListener("message", answer);
        source.postMessage(authoringProbeMessage(pack, nonce), host.location.origin);
      })));
      return answers.every(Boolean);
    },
    dispose() { this.lock(false); host.removeEventListener("load", loaded, true); },
  };
}
