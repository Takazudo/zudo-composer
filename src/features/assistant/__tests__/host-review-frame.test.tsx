import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { HostReviewFrame } from "../host-review-frame";
import type { HostReviewPreview } from "../../../shared/host-review-types";
import type { ProductionProviderIntegration } from "../../../app/provider-integration";
afterEach(cleanup);
it("accepts only the exact displayed candidate and revokes fresh Apply on canonical or URL changes", async () => {
  const identity = { workspaceId: "proof", revision: "a".repeat(64), pathname: "/", packId: "pack", packVersion: "1", rendererId: "host", rendererVersion: "1", rendererDigest: "b".repeat(64) };
  const value: HostReviewPreview = { reviewId: "review", candidateDigest: "c".repeat(64), baseDigest: "d".repeat(64), documentUrl: window.location.origin + "/", preview: { identity, frameId: "exact-frame", targets: [], navigation: { url: "/", pathnames: ["/"] } } };
  let change!: (channel: string) => void;
  const integration = { subscribeChanges: (fn: typeof change) => { change = fn; return () => {}; } } as ProductionProviderIntegration;
  const ready = vi.fn();
  const view = render(<HostReviewFrame value={value} integration={integration} onReady={ready} />);
  const frame = view.container.querySelector("iframe")!;
  const document = frame.contentDocument!;
  document.open(); document.write('<html><head><meta name="zudo-host-document-frame" content="exact-frame"></head><body></body></html>'); document.close();
  // Supply the actual visitor URL used by the trusted bootstrap, without loading a network document.

  const send = (source: Window | null, extra = {}) => fireEvent(window, new MessageEvent("message", { source, origin: window.location.origin, data: { protocol: "zudo-host-document-v1", type: "ready", identity, frameId: "exact-frame", visitorUrl: "/", ...extra } }));
  await waitFor(() => expect(change).toBeDefined()); ready.mockClear();
  send(window); send(frame.contentWindow, { frameId: "stale" });
  expect(ready).not.toHaveBeenCalled();
  send(frame.contentWindow);
  expect(ready.mock.lastCall?.[0]).toMatchObject({ reviewId: "review", candidateDigest: value.candidateDigest });
  const current = ready.mock.lastCall?.[1] as () => boolean;
  expect(current()).toBe(true);
  change("sessions"); expect(current()).toBe(true);
  frame.contentWindow!.history.replaceState(null, "", "?changed=1");
  expect(current()).toBe(false);
  change("composition"); expect(ready.mock.lastCall?.[0]).toBeNull();
  send(frame.contentWindow); expect(ready.mock.lastCall?.[0]).toBeNull();
});
