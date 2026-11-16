import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { HostReviewCard } from "../host-review-card";
import type { HostReviewAcknowledgement, HostReviewPreview } from "../host-review-types";
import type { ProductionProviderIntegration } from "../../../app/provider-integration";
const mocks = vi.hoisted(() => ({ request: vi.fn(), current: true }));
vi.mock("../../native-editing/session", () => ({ assistantRequest: mocks.request }));
vi.mock("../host-review-frame", () => ({ HostReviewFrame: ({ value, onReady }: { value: HostReviewPreview; onReady: (ack: HostReviewAcknowledgement, current: () => boolean) => void }) => <button onClick={() => onReady({ reviewId: value.reviewId, candidateDigest: value.candidateDigest, baseDigest: value.baseDigest, identity: value.preview.identity, frameId: "frame" }, () => mocks.current)}>Acknowledge fixture</button> }));
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); mocks.current = true; });
it("retains the exact lost Apply across remount and replays it without issuing a new review", async () => {
  const card = { id: "review", ownerLabel: "Course price", operation: { domain: "content" }, summary: "Price", affectedUses: [], routes: [{ pathname: "/", title: "Home" }], status: "open" };
  const preview = { reviewId: "review", candidateDigest: "candidate", baseDigest: "base", preview: { identity: { pathname: "/" } } };
  const requests: unknown[] = []; let lost = true;
  mocks.request.mockImplementation(async (operation, _workspace, input) => {
    if (operation === "hostReview") return card;
    if (operation === "previewHostReview") return preview;
    if (operation === "applyHostReview") { requests.push(input); if (lost) { lost = false; throw new Error("response lost"); } card.status = "applied"; return { recovered: true }; }
    throw new Error(operation);
  });
  const props = { reviewId: "review", workspaceId: "proof", integration: {} as ProductionProviderIntegration, blocked: false };
  let view = render(<HostReviewCard {...props} />);
  fireEvent.click(await view.findByRole("button", { name: "Render candidate" }));
  fireEvent.click(await view.findByRole("button", { name: "Acknowledge fixture" }));
  fireEvent.click(view.getByRole("button", { name: "Apply content" }));
  await view.findByRole("button", { name: "Recover retained Apply" });
  await waitFor(() => expect(requests).toHaveLength(1));
  view.unmount(); sessionStorage.clear();
  view = render(<HostReviewCard {...props} />);
  fireEvent.click(await view.findByRole("button", { name: "Recover retained Apply" }));
  await view.findByRole("button", { name: "Undo content" });
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  expect(localStorage.length).toBe(0);
});
