import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContentStorageConformanceBaseline } from "../../../hosted-content/conformance";
import { createContentEditorStorage, type ContentEditorStorage } from "../../../hosted-content/editor-service";
import { CONTENT_EDITOR_LABELS_JA, canSubmitPreviewedSnapshot, contentEditorDisplayStatus, mountContentEditor, type ContentEditorHandle } from "../mount";
import { HostedContentForbiddenError, createHostedContentView } from "../view-provider";
import type { HostContentPolicy } from "../../../hosted-content/policy";
import { createMemoryContentDraftStorage, type ContentDraftStorageAdapter } from "../../../hosted-content/storage";

const policy: HostContentPolicy = {
  projectId: "conformance-site",
  providerId: "content-filesystem",
  models: { notes: { fields: ["title", "body"], operations: ["put-entry-values"] } },
};
const actor = { subject: "editor@example.test" };

let handle: ContentEditorHandle | null = null;
let host: HTMLElement;

beforeEach(() => {
  window.history.replaceState(null, "", "/admin/edit");
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  handle?.dispose();
  handle = null;
  host.remove();
  cleanup();
  await new Promise<void>((resolve) => { requestAnimationFrame(() => setTimeout(resolve, 0)); });
});

async function mount(storage?: (adapter: ContentDraftStorageAdapter) => ContentEditorStorage) {
  const adapter = await createMemoryContentDraftStorage(createContentStorageConformanceBaseline());
  handle = mountContentEditor(host, {
    project: { id: policy.projectId },
    revision: "baseline-1",
    policy,
    storage: storage ? storage(adapter) : createContentEditorStorage(adapter, { policy, actor }),
  });
  const tree = await screen.findByRole("tree", { name: "Content" });
  fireEvent.click(within(tree).getByRole("treeitem", { name: /^Notes/ }));
  fireEvent.click(await within(tree).findByRole("treeitem", { name: /^First/ }));
  await screen.findByRole("textbox", { name: "Entry title" });
  return { adapter };
}

async function storedTitle(adapter: ContentDraftStorageAdapter, id = "first") {
  const draft = await adapter.readDraft();
  return draft.status === "ok" ? draft.value.snapshot.entries.find((entry) => entry.id === id)?.values.title : undefined;
}

describe("mountContentEditor (restricted)", () => {
  it("renders the Content route without schema, relationship, raw or structural controls", async () => {
    await mount();
    expect(screen.queryByRole("radiogroup", { name: "Editor mode" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Schema" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Raw" })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Used by/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add model|Add entry/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /More actions for/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to Content" })).toBeNull();
    // The host owns the address bar: selection never rewrites it to /content.
    expect(window.location.pathname).toBe("/admin/edit");
  });

  it("renders protected fields read-only", async () => {
    await mount();
    const order = screen.getByRole("spinbutton", { name: "Order" });
    expect(order).toBeDisabled();
    expect(order.closest("[data-content-protected]")).toHaveAttribute("data-content-protected", "order");
    expect(screen.getByRole("textbox", { name: "Entry title" })).not.toBeDisabled();
  });

  it("saves through the expected-revision path and reports the durable revision", async () => {
    const { adapter } = await mount();
    const initial = (await adapter.readDraft());
    fireEvent.input(screen.getByRole("textbox", { name: "Title" }), { target: { value: "新しい題名" } });
    await waitFor(() => expect(handle!.state.status).toBe("saved"));
    expect(await storedTitle(adapter)).toBe("新しい題名");
    expect(handle!.state.revision).not.toBe(initial.status === "ok" ? initial.value.draftRevision : null);
    expect(host.querySelector("[data-save-status]")).toHaveAttribute("data-save-status", "saved");
  });

  it("offers use-latest and reapply-mine after a conflicting save", async () => {
    const { adapter } = await mount();
    const other = createContentEditorStorage(adapter, { policy, actor: { subject: "other@example.test" } });
    const current = await adapter.readDraft();
    if (current.status !== "ok") throw new Error("unreadable draft");
    await other.apply({ operationId: "theirs", expectedBaselineRevision: current.value.baselineRevision, request: { kind: "put-entry-values", projectId: policy.projectId, providerId: policy.providerId, modelId: "notes", entryId: "second", values: { title: "Theirs" }, expectedRevision: current.value.draftRevision } });

    fireEvent.input(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Mine" } });
    const reapply = await screen.findByRole("button", { name: "Reapply my draft" });
    expect(screen.getByRole("button", { name: "Use latest" })).toBeInTheDocument();
    expect(handle!.state.status).toBe("conflict");
    expect(await storedTitle(adapter)).toBe("First");

    fireEvent.click(reapply);
    await waitFor(() => expect(handle!.state.status).toBe("saved"));
    expect(await storedTitle(adapter)).toBe("Mine");
    expect(await storedTitle(adapter, "second")).toBe("Theirs");
  });

  it("discards local values only when the user chooses the latest version", async () => {
    const { adapter } = await mount();
    const other = createContentEditorStorage(adapter, { policy, actor: { subject: "other@example.test" } });
    const current = await adapter.readDraft();
    if (current.status !== "ok") throw new Error("unreadable draft");
    await other.apply({ operationId: "theirs", expectedBaselineRevision: current.value.baselineRevision, request: { kind: "put-entry-values", projectId: policy.projectId, providerId: policy.providerId, modelId: "notes", entryId: "first", values: { title: "Theirs" }, expectedRevision: current.value.draftRevision } });

    fireEvent.input(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Mine" } });
    fireEvent.click(await screen.findByRole("button", { name: "Use latest" }));
    await waitFor(() => expect(handle!.state.status).toBe("clean"));
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Theirs");
    expect(await storedTitle(adapter)).toBe("Theirs");
  });

  it("shows recovery for a lost acknowledgement and never reports saved before a receipt", async () => {
    let lose = true;
    const { adapter } = await mount((adapter) => {
      const real = createContentEditorStorage(adapter, { policy, actor });
      return {
        ...real,
        async apply(input) {
          const result = await real.apply(input);
          if (lose) throw new Error("connection reset");
          return result;
        },
        async readReceipt(operationId) {
          if (lose) throw new Error("offline");
          return real.readReceipt(operationId);
        },
      };
    });
    fireEvent.input(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Durable?" } });
    await waitFor(() => expect(handle!.state.status).toBe("recovering"));
    // The write landed, but the editor does not claim it.
    expect(await storedTitle(adapter)).toBe("Durable?");
    expect(host.querySelector("[data-save-status]")).toHaveAttribute("data-save-status", "recovering");
    lose = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(handle!.state.status).toBe("saved"));
    const draft = await adapter.readDraft();
    // Resolved through the receipt: one write, not a second application.
    expect(draft.status === "ok" && handle!.state.revision).toBe(draft.status === "ok" ? draft.value.draftRevision : -1);
  });

  it("uses host labels", async () => {
    const adapter = await createMemoryContentDraftStorage(createContentStorageConformanceBaseline());
    handle = mountContentEditor(host, { project: { id: policy.projectId }, policy, storage: createContentEditorStorage(adapter, { policy, actor }), labels: CONTENT_EDITOR_LABELS_JA });
    await waitFor(() => expect(host.querySelector("[data-save-status]")?.textContent).toBe("すべて保存済み"));
  });

  it("blocks a draft made for another baseline", async () => {
    const adapter = await createMemoryContentDraftStorage(createContentStorageConformanceBaseline("baseline-2"));
    handle = mountContentEditor(host, { project: { id: policy.projectId }, revision: "baseline-1", policy, storage: createContentEditorStorage(adapter, { policy, actor }) });
    await waitFor(() => expect(handle!.state.status).toBe("blocked"));
    expect(screen.queryByRole("tree", { name: "Content" })).toBeNull();
  });

  it("refuses to mount for another project", () => {
    expect(() => mountContentEditor(host, { project: { id: "other" }, policy, storage: {} as ContentEditorStorage })).toThrow(/does not match/);
  });
});

describe("approved asset selection", () => {
  it("picks only approved committed assets, without upload or library links", async () => {
    const baseline = createContentStorageConformanceBaseline();
    const content = baseline.project.providers.content[0]!;
    content.models[0]!.document.fields.push({ id: "image", key: "image", label: "Image", required: false, kind: "asset-use", use: "image" });
    const adapter = await createMemoryContentDraftStorage(baseline);
    const assetPolicy: HostContentPolicy = { ...policy, models: { notes: { fields: ["title", "body", "image"], operations: ["put-entry-values"] } }, assets: { providerId: "assets-filesystem", assetIds: ["hero"] } };
    handle = mountContentEditor(host, {
      project: { id: policy.projectId },
      policy: assetPolicy,
      storage: createContentEditorStorage(adapter, { policy: assetPolicy, actor }),
      assets: { providerId: "assets-filesystem", assets: [
        { assetId: "hero", fileName: "hero.png", mimeType: "image/png", byteLength: 10, url: "/approved/hero.png", label: "Hero" },
        { assetId: "secret", fileName: "secret.png", mimeType: "image/png", byteLength: 10, url: "/approved/secret.png", label: "Not approved" },
      ] },
    });
    const tree = await screen.findByRole("tree", { name: "Content" });
    fireEvent.click(within(tree).getByRole("treeitem", { name: /^Notes/ }));
    fireEvent.click(await within(tree).findByRole("treeitem", { name: /^First/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose from Assets" }));
    expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Not approved")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose: Hero" }));
    await waitFor(() => expect(handle!.state.status).toBe("saved"));
    const draft = await adapter.readDraft();
    expect(draft.status === "ok" && draft.value.snapshot.entries.find((entry) => entry.id === "first")!.values.image).toMatchObject({ kind: "image", asset: { providerId: "assets-filesystem", assetId: "hero" } });
    expect(screen.queryByRole("link", { name: /Open in Assets/ })).toBeNull();
    expect(screen.queryByText("Authoring URL")).toBeNull();
  });
});

describe("restricted Content view provider", () => {
  it("rejects every structural write", async () => {
    const baseline = createContentStorageConformanceBaseline();
    const provider = baseline.project.providers.content[0]!;
    const view = createHostedContentView({ providerId: provider.id, mutationToken: 0, models: provider.models, entries: provider.entries }, ["notes"], "Site");
    for (const write of [() => view.provider.store.putModel(provider.models[0]!), () => view.provider.store.putEntry(provider.entries[0]!), () => view.provider.store.deleteEntry("first"), () => view.provider.store.removeField("notes", "body"), () => view.provider.store.transact({ expectedMutationToken: 0, operations: [] }), () => view.provider.initialization.startFresh()]) {
      await expect(write()).rejects.toBeInstanceOf(HostedContentForbiddenError);
    }
    expect((await view.provider.store.listModels()).map((model) => model.id)).toEqual(["notes"]);
  });
});

describe("status and submit gating", () => {
  it("never shows saved while the form holds a newer edit", () => {
    const save = { status: "saved", revision: 3, receipt: {} } as never;
    expect(contentEditorDisplayStatus(save, { saveStatus: "dirty", conflictRecovery: null, message: "" }).status).toBe("unsaved");
    expect(contentEditorDisplayStatus(save, { saveStatus: "saved", conflictRecovery: null, message: "" }).status).toBe("saved");
  });

  it("allows submission only for the previewed snapshot at the adopted revision", () => {
    const snapshot = { snapshotId: "a".repeat(64), draftRevision: 4, baselineRevision: "b1" } as never;
    const draft = { draftRevision: 4, baselineRevision: "b1" } as never;
    const rendered = { status: "rendered", request: { snapshotId: "a".repeat(64), revision: 4, route: "/", frameLoadId: "f" } } as const;
    expect(canSubmitPreviewedSnapshot({ preview: rendered, snapshot, draft, status: "saved" })).toBe(true);
    expect(canSubmitPreviewedSnapshot({ preview: rendered, snapshot, draft: { draftRevision: 5, baselineRevision: "b1" } as never, status: "saved" })).toBe(false);
    expect(canSubmitPreviewedSnapshot({ preview: rendered, snapshot, draft, status: "unsaved" })).toBe(false);
    expect(canSubmitPreviewedSnapshot({ preview: { status: "pending", request: rendered.request }, snapshot, draft, status: "saved" })).toBe(false);
  });
});
