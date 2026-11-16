import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterEach, expect, it, vi } from "vitest";
import { NativePageFrame } from "../page-frame";
import { ReviewPanel } from "../../assistant/review-panel";
import type { ReviewPanelProps } from "../../assistant/review-panel";
import { nativePageRenderedMessage, type ComposerPreviewSnapshot } from "../../composer/preview/protocol";
import type { ComposerComponentProvider } from "../../composer/component-provider";
import { createFixtureSampleDocument, fixtureComponentManifest } from "../../composer/test-support/fixture-pack";
const mock = vi.hoisted(() => ({ options: {} as Parameters<typeof import("../../composer/preview/bridge").createComposerPreviewBridge>[0], snapshot: {} as ComposerPreviewSnapshot, revision: 0 }));
vi.mock("../../../../theme/use-resolved-theme", () => ({ useResolvedTheme: () => "light" }));
vi.mock("../../composer/preview/bridge", () => ({
  buildComposerPreviewUrl: () => ({ src: "/preview", targetOrigin: "http://localhost" }),
  composerPreviewFrameProps: (_location: unknown, title: string) => ({ title }),
  createComposerPreviewBridge: (options: typeof mock.options) => {
    mock.options = options;
    return { get revision() { return mock.revision; }, render(snapshot: ComposerPreviewSnapshot) { mock.snapshot = snapshot; return ++mock.revision; }, dispose() {} };
  },
}));
afterEach(() => { cleanup(); mock.revision = 0; });
const identity = { workspaceId: "proof", sitemapId: "main", pageId: "home", providerId: "files" as const, recordId: "home" };
const provider = { manifest: fixtureComponentManifest } as ComposerComponentProvider;
const noop = () => {};
const panel: ReviewPanelProps = {
  view: { generation: 1, permission: "apply", draft: { id: "draft", revision: 1, status: "applied", createdAt: "2026-01-01", updatedAt: "2026-01-01", applied: { operationId: "apply", candidateDigest: "a".repeat(64), committedAt: "2026-01-01" }, undone: null, dependenciesCurrent: true, operations: [], pages: [], changes: [], stale: [], buildError: null, candidateDigest: null } },
  currentPage: "main/home", evidence: new Set(), fallback: new Set(), busy: false, frameReady: false, canApply: false, applyBlocker: null, error: null,
  onOpen: noop, onPage: noop, onWithdraw: noop, onApply: noop, onDiscard: noop, onRevalidate: noop, onUndo: noop, onRecover: noop, dependents: null, onConfirmDependents: noop, onCancelDependents: noop,
};
function Harness({ snapshot }: { snapshot: ComposerPreviewSnapshot }) {
  const [acknowledged, setAcknowledged] = useState<ComposerPreviewSnapshot | null>(null);
  return <><NativePageFrame provider={provider} snapshot={snapshot} selecting identity={identity} draftRevision={"b".repeat(64)} onSelect={noop} onEvidence={noop} onError={noop} onRenderReady={value => setAcknowledged(value ? snapshot : null)} /><ReviewPanel {...panel} frameReady={acknowledged === snapshot} /></>;
}
const ack = () => nativePageRenderedMessage(fixtureComponentManifest, mock.revision, structuredClone(mock.snapshot.nativePage!));
it("keeps Undo disabled until the exact delayed current frame renders, including load after acknowledgment", async () => {
  const first = { document: createFixtureSampleDocument(), localRecordId: "home" };
  const { rerender } = render(<Harness snapshot={first} />);
  await waitFor(() => expect(mock.revision).toBeGreaterThan(0));
  const undo = screen.getByRole("button", { name: "Undo apply" }) as HTMLButtonElement;
  expect(undo.disabled).toBe(true);
  await act(async () => { mock.options.onReady?.(); });
  expect(undo.disabled).toBe(true);
  const old = ack();
  await act(async () => { mock.options.onNativePageRendered?.(old); });
  expect(undo.disabled).toBe(false);
  // Post-Apply current snapshot must not inherit the previous frame's evidence.
  rerender(<Harness snapshot={{ localRecordId: "home", document: { ...first.document, name: "Saved after Apply" } }} />);
  expect(undo.disabled).toBe(true);
  await act(async () => { mock.options.onNativePageRendered?.(old); });
  expect(undo.disabled).toBe(true);
  await act(async () => { mock.options.onNativePageRendered?.(ack()); });
  expect(undo.disabled).toBe(false);
  const beforeLoad = ack();
  fireEvent.load(screen.getByTitle("Native page preview"));
  expect(undo.disabled).toBe(true);
  await act(async () => { mock.options.onNativePageRendered?.(beforeLoad); });
  expect(undo.disabled).toBe(true);
  await act(async () => { mock.options.onNativePageRendered?.(ack()); });
  expect(undo.disabled).toBe(false);
  await act(async () => { window.dispatchEvent(new CustomEvent("native-authoring-stale")); });
  await act(async () => { mock.options.onNativePageRendered?.(ack()); });
  expect(undo.disabled).toBe(true);
});

it("keeps draft cleanup and receipt recovery usable when rendering fails", () => {
  const onDiscard = vi.fn(), onWithdraw = vi.fn(), onRecover = vi.fn(), onRevalidate = vi.fn();
  const change = { id: "change", kind: "field" as const, page: { sitemapId: "main", pageId: "home" }, recordId: "home", nodeId: "title", componentId: "text", componentTitle: "Title", prop: "text", before: "Before", after: "After", operationIds: [], reasons: [] };
  render(<ReviewPanel {...panel} view={{ ...panel.view!, draft: { ...panel.view!.draft!, status: "open", changes: [change], stale: [{ page: change.page, reason: "Needs revalidation" }], buildError: { code: "render-failed", message: "Rendering failed" } } }} frameReady={false} canApply={true} onDiscard={onDiscard} onWithdraw={onWithdraw} onRecover={onRecover} onRevalidate={onRevalidate} />);
  for (const name of ["Discard all", "Withdraw", "Check receipt", "Revalidate against saved pages"]) {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(false); fireEvent.click(button);
  }
  expect(onDiscard).toHaveBeenCalledOnce(); expect(onWithdraw).toHaveBeenCalledWith(change); expect(onRecover).toHaveBeenCalledOnce(); expect(onRevalidate).toHaveBeenCalledOnce();
  expect((screen.getByRole("button", { name: "Apply to Composer" }) as HTMLButtonElement).disabled).toBe(true);
});
