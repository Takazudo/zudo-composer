"use client";

import { computed, getScope, signal } from "@takazudo/zfb/zudo-react";
import {
  DetailWorkbench,
  isReadyMessage,
  PROTOCOL_VERSION,
  type DetailWorkbenchProps,
} from "@takazudo/zudo-sg/preview";
import { previewFrameSelector } from "../../src/config/preview.mjs";

export default function BlogWorkbench(props: DetailWorkbenchProps) {
  const ready = signal(false);
  const container = { current: null as HTMLFieldSetElement | null };

  getScope().onActivate(() => {
    const frames = [
      ...container.current!.querySelectorAll<HTMLIFrameElement>(
        previewFrameSelector,
      ),
    ];
    const pending = new Set(frames);
    function receive(event: MessageEvent) {
      if (
        event.origin !== location.origin ||
        event.data?.v !== PROTOCOL_VERSION ||
        !isReadyMessage(event.data)
      )
        return;
      const frame = frames.find(
        (frame) => frame.contentWindow === event.source,
      );
      if (!frame) return;
      const url = new URL(frame.src);
      if (
        event.data.slug !== url.searchParams.get("slug") ||
        event.data.variant !== url.searchParams.get("variant")
      )
        return;
      pending.delete(frame);
      ready.value = pending.size === 0;
    }
    window.addEventListener("message", receive);
    for (const frame of frames) {
      // Controls must not become editable before a lazy frame can receive them.
      frame.loading = "eager";
      frame.contentWindow?.postMessage(
        { type: "sg:requestReady", v: PROTOCOL_VERSION },
        location.origin,
      );
    }
    return () => window.removeEventListener("message", receive);
  });

  // SSR controls are visible but cannot lose an edit before island activation.
  const pending = computed(() => !ready.value);
  return (
    <fieldset
      ref={container}
      disabled={pending}
      aria-busy={pending}
      class="m-0 min-w-0 border-0 p-0"
    >
      <DetailWorkbench {...props} />
    </fieldset>
  );
}
