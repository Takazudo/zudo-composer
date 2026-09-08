import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContentModelRecord } from "../../../content";
import { ContentApp } from "../content-app";
import { createContentAuthoringController } from "../controller";
import { createMemoryContentProvider } from "../fixtures";

afterEach(cleanup);
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function fixture() {
  window.history.replaceState(null, "", "/content");
  const provider = createMemoryContentProvider();
  await provider.store.putModel(createContentModelRecord({ name: "Other", kind: "collection" }, { id: "other" }));
  const controller = createContentAuthoringController(provider);
  await controller.initialize(); await controller.openModel("articles");
  render(<ContentApp provider={provider} controller={controller} />);
  return { provider, controller };
}

describe("Content entry action boundary", () => {
  it("withdraws Add entry while new model selection is waiting for its reads", async () => {
    const { provider, controller } = await fixture();
    expect(screen.getByRole("button", { name: "Add entry" })).toBeInTheDocument();
    const started = deferred(), release = deferred();
    const page = provider.store.pageEntries.bind(provider.store);
    vi.spyOn(provider.store, "pageEntries").mockImplementation(async (id, options) => {
      started.resolve(); await release.promise; return page(id, options);
    });
    const creating = controller.createModel("Single", "single");
    await started.promise;
    await waitFor(() => expect(screen.queryByRole("button", { name: "Add entry" })).toBeNull());
    release.resolve(); await creating;
    await screen.findByRole("button", { name: "Add entry" });
    expect(controller.state.model?.document.name).toBe("Single");
  });

  it("visibly reports the durable location of a creation completed after navigation", async () => {
    const { provider, controller } = await fixture();
    const started = deferred(), release = deferred();
    const put = provider.store.putEntry.bind(provider.store);
    vi.spyOn(provider.store, "putEntry").mockImplementationOnce(async (entry) => {
      await put(entry); started.resolve(); await release.promise;
    });
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    await started.promise; await controller.openModel("other"); release.resolve();
    expect(await screen.findByText(/was saved in model "Articles".*newer selection was kept/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry save" })).toBeNull();
    expect(controller.state.model?.id).toBe("other");
    expect(controller.state.entries).toEqual([]);
  });
});
