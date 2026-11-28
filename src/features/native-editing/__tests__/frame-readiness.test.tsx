import { computed, signal, type Signal } from "@takazudo/zfb/zudo-react";
import { fireEvent, render, screen, settle, settleTasks, waitFor } from "../../../test/render";
import { afterEach, expect, it, vi } from "vitest";
import { NativePageFrame } from "../page-frame";
import { ReviewPanel } from "../../assistant/review-panel";
import type { ReviewPanelProps } from "../../assistant/review-panel";
import type { DraftView } from "../../assistant/types";
import { nativePageRenderedMessage, type ComposerPreviewSnapshot } from "../../composer/preview/protocol";
import type { ComposerComponentProvider } from "../../composer/component-provider";
import { createFixtureSampleDocument, fixtureComponentManifest } from "../../composer/test-support/fixture-pack";
const mock = vi.hoisted(() => ({ options: {} as Parameters<typeof import("../../composer/preview/bridge").createComposerPreviewBridge>[0], snapshot: {} as ComposerPreviewSnapshot, revision: 0 }));
vi.mock("../../../theme/use-resolved-theme", async () => { const { signal } = await import("@takazudo/zfb/zudo-react"); return { resolvedThemeSignal: () => signal("light") }; });
vi.mock("../../composer/preview/bridge", () => ({
  buildComposerPreviewUrl: () => ({ src: "/preview", targetOrigin: "http://localhost" }),
  composerPreviewFrameProps: (_location: unknown, title: string) => ({ title }),
  createComposerPreviewBridge: (options: typeof mock.options) => {
    mock.options = options;
    return { get revision() { return mock.revision; }, render(snapshot: ComposerPreviewSnapshot) { mock.snapshot = snapshot; return ++mock.revision; }, dispose() {} };
  },
}));
afterEach(() => { mock.revision = 0; });
const identity = { workspaceId: "proof", sitemapId: "main", pageId: "home", providerId: "files" as const, recordId: "home" };
const provider = { manifest: fixtureComponentManifest } as ComposerComponentProvider;
const noop = () => {};
const panel: ReviewPanelProps & { view: DraftView } = {
  view: { generation: 1, permission: "apply", draft: { id: "draft", revision: 1, status: "applied", createdAt: "2026-01-01", updatedAt: "2026-01-01", applied: { operationId: "apply", candidateDigest: "a".repeat(64), committedAt: "2026-01-01" }, undone: null, dependenciesCurrent: true, operations: [], pages: [], changes: [], stale: [], buildError: null, candidateDigest: null } },
  currentPage: "main/home", evidence: new Set(), fallback: new Set(), busy: false, frameReady: false, canApply: false, applyBlocker: null, error: null,
  onOpen: noop, onPage: noop, onWithdraw: noop, onApply: noop, onDiscard: noop, onRevalidate: noop, onUndo: noop, onRecover: noop, dependents: null, onConfirmDependents: noop, onCancelDependents: noop,
};
function Harness({ snapshot }: { snapshot: Signal<ComposerPreviewSnapshot> }) {
  const acknowledged = signal<ComposerPreviewSnapshot | null>(null);
  return <><NativePageFrame provider={provider} snapshot={snapshot} selecting identity={computed(() => identity)} draftRevision={computed(() => "b".repeat(64))} onSelect={noop} onEvidence={noop} onError={noop} onRenderReady={value => { acknowledged.value = value ? snapshot.value : null; }} /><ReviewPanel {...panel} frameReady={computed(() => acknowledged.value === snapshot.value)} /></>;
}
const ack = () => nativePageRenderedMessage(fixtureComponentManifest, mock.revision, structuredClone(mock.snapshot.nativePage!));
it("keeps Undo disabled until the exact delayed current frame renders, including load after acknowledgment", async () => {
  const first = { document: createFixtureSampleDocument(), localRecordId: "home" };
  const snapshot = signal<ComposerPreviewSnapshot>(first);
  render(<Harness snapshot={snapshot} />);
  await waitFor(() => expect(mock.revision).toBeGreaterThan(0));
  const undo = screen.getByRole("button", { name: "Undo apply" }) as HTMLButtonElement;
  await settle();
  expect(undo.disabled).toBe(true);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toContain("Receipt apply");
  expect(screen.getByRole("status").textContent).toContain("Waiting for the current page");
  mock.options.onReady?.(); await settleTasks();
  expect(undo.disabled).toBe(true);
  const old = ack();
  mock.options.onNativePageRendered?.(old); await settleTasks();
  expect(undo.disabled).toBe(false);
  // Post-Apply current snapshot must not inherit the previous frame's evidence.
  snapshot.value = { localRecordId: "home", document: { ...first.document, name: "Saved after Apply" } };
  await settleTasks();
  expect(undo.disabled).toBe(true);
  mock.options.onNativePageRendered?.(old); await settleTasks();
  expect(undo.disabled).toBe(true);
  mock.options.onNativePageRendered?.(ack()); await settleTasks();
  expect(undo.disabled).toBe(false);
  const beforeLoad = ack();
  fireEvent.load(screen.getByTitle("Native page preview"));
  await settleTasks();
  expect(undo.disabled).toBe(true);
  mock.options.onNativePageRendered?.(beforeLoad); await settleTasks();
  expect(undo.disabled).toBe(true);
  mock.options.onNativePageRendered?.(ack()); await settleTasks();
  expect(undo.disabled).toBe(false);
  window.dispatchEvent(new CustomEvent("native-authoring-stale")); await settleTasks();
  mock.options.onNativePageRendered?.(ack()); await settleTasks();
  expect(undo.disabled).toBe(true);
});

it("keeps draft cleanup and receipt recovery usable when rendering fails", async () => {
  const onDiscard = vi.fn(), onWithdraw = vi.fn(), onRecover = vi.fn(), onRevalidate = vi.fn();
  const change = { id: "change", kind: "field" as const, page: { sitemapId: "main", pageId: "home" }, recordId: "home", nodeId: "title", componentId: "text", componentTitle: "Title", prop: "text", before: "Before", after: "After", operationIds: [], reasons: [] };
  render(<ReviewPanel {...panel} view={{ ...panel.view!, draft: { ...panel.view!.draft!, status: "open", changes: [change], stale: [{ page: change.page, reason: "Needs revalidation" }], buildError: { code: "render-failed", message: "Rendering failed" } } }} frameReady={false} canApply={true} onDiscard={onDiscard} onWithdraw={onWithdraw} onRecover={onRecover} onRevalidate={onRevalidate} />);
  await settle();
  for (const name of ["Discard all", "Withdraw", "Check receipt", "Revalidate against saved pages"]) {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(false); fireEvent.click(button);
  }
  await settle();
  expect(onDiscard).toHaveBeenCalledOnce(); expect(onWithdraw).toHaveBeenCalledWith(change); expect(onRecover).toHaveBeenCalledOnce(); expect(onRevalidate).toHaveBeenCalledOnce();
  expect((screen.getByRole("button", { name: "Apply to Composer" }) as HTMLButtonElement).disabled).toBe(true);
});
