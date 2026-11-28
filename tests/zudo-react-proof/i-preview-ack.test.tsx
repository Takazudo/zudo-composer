import { afterEach, expect, it, vi } from "vitest";
import { computed, flush, getScope, signal, type Ref } from "@takazudo/zfb/zudo-react";
import { mountOwned, type OwnedRoot } from "../../src/runtime/root";

const roots: OwnedRoot[] = [];
afterEach(() => { for (const root of roots.splice(0)) root.stop(); });

interface Ack { type: "composer:rendered"; revision: number; route: string }

it("(i) the preview ack guard accepts only the current revision from its own frame and origin", async () => {
  const revision = signal(1);
  const route = signal("/about");
  const acked = signal<number | null>(null);
  const status = computed(() => (acked.value === revision.value ? "ready" : "pending"));
  const frame: Ref<HTMLIFrameElement> = { current: null };
  const posted: unknown[] = [];

  function PreviewHost() {
    const scope = getScope();
    scope.onActivate(() => {
      const receive = (event: MessageEvent) => {
        const data = event.data as Partial<Ack> | null;
        if (event.origin !== location.origin) return;
        if (event.source !== frame.current?.contentWindow) return;
        if (data?.type !== "composer:rendered" || data.route !== route.value) return;
        if (data.revision !== revision.value) return; // stale revision refused
        acked.value = data.revision;
      };
      window.addEventListener("message", receive);
      return () => window.removeEventListener("message", receive);
    });
    // Each revision change posts a render request after DOM commit.
    scope.effect(() => {
      const message = { type: "composer:render", revision: revision.value, route: route.value };
      frame.current?.contentWindow?.postMessage(message, location.origin);
    });
    return (
      <div>
        <iframe ref={frame} title="Preview" />
        <output data-status={status}>{status}</output>
      </div>
    );
  }
  const root = mountOwned(PreviewHost, {});
  roots.push(root);
  const win = frame.current!.contentWindow!;
  vi.spyOn(win, "postMessage").mockImplementation((message: unknown) => { posted.push(message); });
  revision.value = 2;
  await flush();
  expect(posted).toEqual([{ type: "composer:render", revision: 2, route: "/about" }]);

  const send = (data: Ack, init: { origin?: string; source?: Window | null } = {}) =>
    window.dispatchEvent(new MessageEvent("message", { data, origin: init.origin ?? location.origin, source: init.source === undefined ? win : init.source }));

  send({ type: "composer:rendered", revision: 1, route: "/about" });
  send({ type: "composer:rendered", revision: 2, route: "/about" }, { origin: "https://evil.example" });
  send({ type: "composer:rendered", revision: 2, route: "/about" }, { source: window });
  send({ type: "composer:rendered", revision: 2, route: "/other" });
  await flush();
  const output = root.host.querySelector("output")!;
  expect(output.textContent).toBe("pending");

  send({ type: "composer:rendered", revision: 2, route: "/about" });
  await flush();
  expect(output.textContent).toBe("ready");

  revision.value = 3;
  await flush();
  expect(output.dataset.status).toBe("pending");
  send({ type: "composer:rendered", revision: 2, route: "/about" });
  await flush();
  expect(output.textContent).toBe("pending");
  expect(posted.at(-1)).toEqual({ type: "composer:render", revision: 3, route: "/about" });
});
