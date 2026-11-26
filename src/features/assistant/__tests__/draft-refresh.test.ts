import { describe, expect, it, vi } from "vitest";
import { createDraftRefreshController } from "../draft-refresh";
import type { DraftView } from "../types";
const deferred = () => {
  let resolve!: (view: DraftView) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<DraftView>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const view = (revision: number): DraftView => ({ generation: 0, permission: "apply", draft: { id: "draft", revision, status: "open", createdAt: "2026-01-01", updatedAt: "2026-01-01", applied: null, undone: null, dependenciesCurrent: true, operations: [], pages: [], changes: [], stale: [], buildError: null, candidateDigest: null } });
describe("Assistant authoritative draft responses", () => {
  it("shows the post-proposal draft while the overlapping completion read is still pending", async () => {
    const accept = vi.fn(), fail = vi.fn();
    const controller = createDraftRefreshController(accept, fail);
    const proposal = deferred(), completion = deferred();
    const proposalRead = controller.refresh(() => proposal.promise);
    const completionRead = controller.refresh(() => completion.promise);
    const staged = view(1), completed = view(2);

    proposal.resolve(staged);
    expect(await proposalRead).toEqual(staged);
    expect(accept).toHaveBeenCalledExactlyOnceWith(staged);

    completion.resolve(completed);
    await completionRead;
    expect(accept.mock.calls).toEqual([[staged], [completed]]);
    expect(fail).not.toHaveBeenCalled();
  });

  it("keeps a newer completed draft when an older successful read arrives late", async () => {
    const accept = vi.fn();
    const controller = createDraftRefreshController(accept, vi.fn());
    const older = deferred(), newer = deferred();
    const oldRead = controller.refresh(() => older.promise);
    const newRead = controller.refresh(() => newer.promise);
    const current = view(2);
    newer.resolve(current);
    await newRead;
    older.resolve(view(1));
    expect(await oldRead).toBeNull();
    expect(accept).toHaveBeenCalledExactlyOnceWith(current);
  });
  it("displays withdrawal immediately while older reads and follow-up reads remain pending", async () => {
    const shown: DraftView[] = [], errors = vi.fn();
    const controller = createDraftRefreshController(next => shown.push(next), errors);
    const old = deferred(), followup = deferred();
    const pendingOld = controller.refresh(() => old.promise);
    const withdrawn = view(3);
    controller.accept(withdrawn);
    const pendingFollowup = controller.refresh(() => followup.promise);
    expect(shown).toEqual([withdrawn]);
    old.resolve(view(2)); await pendingOld;
    expect(shown).toEqual([withdrawn]);
    followup.resolve(withdrawn); await pendingFollowup;
    expect(shown.at(-1)).toBe(withdrawn);
    expect(errors).not.toHaveBeenCalled();
  });
  it("ignores older refresh success/error and invalidated route responses", async () => {
    const accept = vi.fn(), fail = vi.fn();
    const controller = createDraftRefreshController(accept, fail);
    const first = deferred(), second = deferred();
    const one = controller.refresh(() => first.promise), two = controller.refresh(() => second.promise);
    second.resolve(view(4)); await two;
    first.reject(new Error("old failure")); await one;
    expect(accept).toHaveBeenCalledTimes(1); expect(accept).toHaveBeenCalledWith(view(4)); expect(fail).not.toHaveBeenCalled();
    const leaving = deferred(); const pending = controller.refresh(() => leaving.promise);
    controller.invalidate(); leaving.resolve(view(5)); await pending;
    expect(accept).toHaveBeenCalledTimes(1);
  });
});

it("does not publish a deferred mutation or read after the workspace controller is disposed", async () => {
  const accept = vi.fn(), fail = vi.fn(), controller = createDraftRefreshController(accept, fail);
  const mutation = deferred(), read = deferred();
  const mutationCompletion = mutation.promise.then(value => controller.accept(value));
  const pendingRead = controller.refresh(() => read.promise);
  controller.dispose();
  mutation.resolve(view(6)); read.resolve(view(5));
  await Promise.all([mutationCompletion, pendingRead]);
  const lateRead = vi.fn(async () => view(7));
  expect(await controller.refresh(lateRead)).toBeNull();
  expect(lateRead).not.toHaveBeenCalled(); expect(accept).not.toHaveBeenCalled(); expect(fail).not.toHaveBeenCalled();
});
