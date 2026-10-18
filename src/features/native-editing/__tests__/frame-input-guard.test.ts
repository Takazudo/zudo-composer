import { afterEach, describe, expect, it, vi } from "vitest";
import { createFrameInputGuard } from "../frame-input-guard";
import { authoringProbeMessage, authoringSettledMessage, renderMessage, type MessageEventLike } from "../../composer/preview/protocol";
import { createPreviewClient } from "../../composer/preview/client";
import { fixtureComponentManifest, createFixtureSampleDocument } from "../../composer/test-support/fixture-pack";

const pack = { packId: fixtureComponentManifest.packId, packVersion: fixtureComponentManifest.packVersion };
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
const fixture = () => {
  const root = document.createElement("main"), frame = document.createElement("iframe");
  root.append(frame); document.body.append(root);
  const guard = createFrameInputGuard(() => root, window, pack, 20);
  const post = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
  return { root, frame, guard, post };
};

describe("iframe authoring preparation", () => {
  it("blocks an explicit-save inline draft without consuming or rewriting it", async () => {
    const { frame, guard, post } = fixture();
    const draft = frame.contentDocument!.createElement("div");
    draft.setAttribute("data-zc-prose-editing", ""); draft.textContent = "未保存の日本語";
    frame.contentDocument!.body.append(draft);
    expect(guard.busy()).toBe(true); expect(await guard.settled()).toBe(false);
    expect(post).not.toHaveBeenCalled(); expect(draft.textContent).toBe("未保存の日本語");
    guard.dispose();
  });
  it("locks frame input and accepts only the exact peer, pack and nonce", async () => {
    const { frame, guard, post } = fixture();
    guard.lock(true); expect(frame.contentDocument!.documentElement.inert).toBe(true);
    const pending = guard.settled();
    const nonce = (post.mock.calls[0]![0] as { nonce: string }).nonce;
    const send = (source: Window, value: unknown) => window.dispatchEvent(new MessageEvent("message", { source, origin: window.location.origin, data: value }));
    send(window, authoringSettledMessage(pack, nonce, true));
    send(frame.contentWindow!, authoringSettledMessage(pack, "a".repeat(64), true));
    send(frame.contentWindow!, authoringSettledMessage({ ...pack, packVersion: "wrong" }, nonce, true));
    send(frame.contentWindow!, authoringSettledMessage(pack, nonce, true));
    expect(await pending).toBe(true); guard.lock(false);
    expect(frame.contentDocument!.documentElement.inert).toBe(false); guard.dispose();
  });
  it("blocks a stashed prose draft whose editor was replaced by a confirmation dialog", async () => {
    const { frame, guard, post } = fixture();
    const dialog = frame.contentDocument!.createElement("div");
    dialog.setAttribute("data-zc-prose-chrome", ""); dialog.setAttribute("role", "dialog");
    frame.contentDocument!.body.append(dialog);
    expect(guard.busy()).toBe(true); expect(await guard.settled()).toBe(false);
    expect(post).not.toHaveBeenCalled(); expect(dialog.isConnected).toBe(true); guard.dispose();
  });
  it("refuses a removed/replaced frame and an unresponsive frame", async () => {
    const { frame, guard, post } = fixture();
    const source = frame.contentWindow!;
    const pending = guard.settled(), nonce = (post.mock.calls[0]![0] as { nonce: string }).nonce;
    frame.remove();
    window.dispatchEvent(new MessageEvent("message", { source, origin: window.location.origin, data: authoringSettledMessage(pack, nonce, true) }));
    expect(await pending).toBe(false); guard.dispose();
    const next = fixture(); expect(await next.guard.settled()).toBe(false); next.guard.dispose();
  });
  it("sends prior inline commits before the clean reply without treating boot as settlement", () => {
    let listener!: (event: MessageEventLike) => void, clean = true;
    const posted: unknown[] = [], source = {};
    const client = createPreviewClient({ hostWindow: { addEventListener(_, fn) { listener = fn; }, removeEventListener() {} }, parentWindow: { postMessage(value) { posted.push(value); } }, expectedSource: source, expectedOrigin: window.location.origin, targetOrigin: window.location.origin, pack, onState() {}, isAuthoringClean: () => clean });
    const nonce = "a".repeat(64);
    const probe = () => listener({ source, origin: window.location.origin, data: authoringProbeMessage(pack, nonce) });
    probe(); expect(posted.at(-1)).toMatchObject({ type: "authoring-settled", clean: false });
    const document = createFixtureSampleDocument();
    listener({ source, origin: window.location.origin, data: renderMessage(pack, 1, { document, localRecordId: document.id }, { mode: "edit", theme: "light", selectedId: null }) });
    client.emitCommitInlineEdit("node", "text", "Supplied value", 1); probe();
    expect(posted.slice(-2)).toMatchObject([{ type: "commit-inline-edit" }, { type: "authoring-settled", nonce, clean: true }]);
    clean = false; probe(); expect(posted.at(-1)).toMatchObject({ clean: false }); client.dispose();
  });
});
