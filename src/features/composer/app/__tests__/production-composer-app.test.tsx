/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory as FDBFactory } from "fake-indexeddb";
import {
  COMPOSITION_PROVIDERS,
  createIndexedDbCompositionProvider,
  summarizeComposition,
  type CompositionInitializationOutcome,
  type CompositionProvider,
  type CompositionRecord,
} from "../../../../composer";
import { activeComponentManifest, createActiveSampleDocument } from "../../active-pack";
import {
  ProductionComposerApp,
  createProductionComposerProviders,
  type ComposerBrowserNavigation,
} from "../production-composer-app";

const TIMESTAMP = "2026-07-14T00:00:00.000Z";
const PREVIEW = {
  previewLocation: { src: "about:blank", targetOrigin: "https://composer.test" },
} as const;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value) => resolve(value),
  };
}

function record(id: string, name: string): CompositionRecord {
  const document = createActiveSampleDocument();
  document.id = id;
  document.name = name;
  return { id, createdAt: TIMESTAMP, updatedAt: TIMESTAMP, document };
}

function ready(records: Map<string, CompositionRecord>): CompositionInitializationOutcome {
  return { status: "ready", summaries: [...records.values()].map(summarizeComposition) };
}

function memoryProvider(
  providerId: "indexeddb" | "files",
  initial: readonly CompositionRecord[],
  overrides: {
    initialize?: () => Promise<CompositionInitializationOutcome>;
    put?: (value: CompositionRecord) => Promise<void>;
    lifecycle?: boolean;
  } = {},
): CompositionProvider & { records: Map<string, CompositionRecord> } {
  const records = new Map(initial.map((value) => [value.id, structuredClone(value)]));
  const descriptor = COMPOSITION_PROVIDERS[providerId];
  const initialize = overrides.initialize ?? (async () => ready(records));
  const store = {
    provider: descriptor,
    list: vi.fn(async () => [...records.values()].map(summarizeComposition)),
    get: vi.fn(async (id) => {
      const value = records.get(id);
      return value
        ? { status: "loaded" as const, record: structuredClone(value) }
        : { status: "not-found" as const, id };
    }),
    put: vi.fn(async (value) => {
      if (overrides.put) await overrides.put(value);
      records.set(value.id, structuredClone(value));
      return { canonical: { status: "saved" as const }, derived: { status: "current" as const, records: [] } };
    }),
    delete: vi.fn(async (id) => records.delete(id)),
    clear: vi.fn(async () => records.clear()),
  };
  if (overrides.lifecycle) {
    Object.assign(store, {
      deleteWithDependencyCheck: vi.fn(async (id: string) => (
        records.delete(id) ? { status: "deleted" as const } : { status: "not-found" as const }
      )),
      unpublishWithDependencyCheck: vi.fn(async (id: string) => (
        records.has(id) ? { status: "unpublished" as const } : { status: "not-found" as const }
      )),
      saveLifecycleRecord: vi.fn(async (value: CompositionRecord) => {
        records.set(value.id, structuredClone(value));
      }),
    });
  }
  return {
    records,
    descriptor,
    initialization: { initialize, retry: initialize, startFresh: initialize },
    store,
  };
}

class FakeNavigation implements ComposerBrowserNavigation {
  private location: { pathname: string; hash: string };
  private readonly listeners = new Set<() => void>();
  readonly pushes: string[] = [];
  readonly replacements: string[] = [];

  constructor(url = "/composer/#/") {
    this.location = this.parse(url);
  }

  read() {
    return this.location;
  }

  push(url: string): void {
    this.pushes.push(url);
    this.location = this.parse(url);
  }

  replace(url: string): void {
    this.replacements.push(url);
    this.location = this.parse(url);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  visit(url: string): void {
    this.location = this.parse(url);
    for (const listener of this.listeners) listener();
  }

  private parse(url: string) {
    const parsed = new URL(url, "https://example.test");
    return { pathname: parsed.pathname, hash: parsed.hash };
  }
}

afterEach(() => {
  localStorage.clear();
});

describe("ProductionComposerApp", () => {
  it("registers only IndexedDB when the dev file capability is absent", () => {
    expect(createProductionComposerProviders(activeComponentManifest).map(({ descriptor }) => descriptor.id)).toEqual([
      "indexeddb",
    ]);
  });

  it("normalizes the document URL and keeps same record ids isolated by provider", async () => {
    const indexeddb = memoryProvider("indexeddb", [record("same", "Browser copy")]);
    const files = memoryProvider("files", [record("same", "File copy")]);
    const navigation = new FakeNavigation("/composer");
    const view = render(
      <ProductionComposerApp manifest={activeComponentManifest} providers={[indexeddb, files]} navigation={navigation} preview={PREVIEW} />,
    );

    expect(await screen.findByRole("heading", { name: "Compositions" })).toBeInTheDocument();
    expect(navigation.replacements).toContain("/composer/#/");
    expect(screen.getByRole("option", { name: "Local files" })).toBeInTheDocument();

    view.unmount();
    navigation.visit("/composer/#/composition/files/same");
    render(<ProductionComposerApp manifest={activeComponentManifest} providers={[indexeddb, files]} navigation={navigation} preview={PREVIEW} />);

    expect(await screen.findByRole("button", { name: "Library" })).toBeInTheDocument();
    expect(screen.getAllByText("File copy").length).toBeGreaterThan(0);
    expect(indexeddb.store.get).not.toHaveBeenCalled();
    expect(files.store.get).toHaveBeenCalledWith("same");
  });

  it("creates an empty unbound schema-v2 record only after New-dialog confirmation", async () => {
    const indexeddb = memoryProvider("indexeddb", []);
    const navigation = new FakeNavigation();
    render(
      <ProductionComposerApp manifest={activeComponentManifest}
        providers={[indexeddb]}
        navigation={navigation}
        idFactory={() => "ordinary"}
        now={() => TIMESTAMP}
        preview={PREVIEW}
      />,
    );
    await screen.findByRole("heading", { name: "Compositions" });

    fireEvent.click(screen.getAllByRole("button", { name: "New composition" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    expect(indexeddb.records.has("ordinary")).toBe(false);
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: " Ordinary page " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create composition" }));

    expect(await screen.findByRole("button", { name: "Library" })).toBeInTheDocument();
    expect(indexeddb.records.get("ordinary")?.document).toMatchObject({
      schemaVersion: 2,
      id: "ordinary",
      name: "Ordinary page",
      root: [],
    });
    expect(indexeddb.records.get("ordinary")?.document.binding).toBeUndefined();
    expect(navigation.pushes.at(-1)).toBe("/composer/#/composition/indexeddb/ordinary");
  });

  it("re-resolves a selected same-provider Global template, then persists only its source and outlet binding", async () => {
    const template = record("site-shell", "Site shell");
    template.document.publication = {
      kind: "global-template",
      outlet: {
        id: "main",
        label: "Main content",
        target: { parentId: "sample-section", slotId: "right" },
      },
    };
    const indexeddb = memoryProvider("indexeddb", [template]);
    const navigation = new FakeNavigation();
    render(
      <ProductionComposerApp manifest={activeComponentManifest}
        providers={[indexeddb]}
        navigation={navigation}
        idFactory={() => "bound-page"}
        now={() => TIMESTAMP}
        preview={PREVIEW}
      />,
    );
    await screen.findByRole("heading", { name: "Compositions" });
    fireEvent.click(screen.getAllByRole("button", { name: "New composition" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Site shell/ }));
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Bound page" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create composition" }));

    expect(await screen.findByRole("button", { name: "Library" })).toBeInTheDocument();
    expect(indexeddb.records.get("bound-page")?.document).toMatchObject({
      schemaVersion: 2,
      id: "bound-page",
      name: "Bound page",
      root: [],
      binding: { sourceRecordId: "site-shell", outletId: "main" },
    });
  });

  it("resolves a linked source through the active provider and remounts from its detached snapshot", async () => {
    const source = record("site-shell", "Site shell");
    source.document.root[0]!.slots.content = [];
    source.document.publication = {
      kind: "global-template",
      outlet: {
        id: "main",
        label: "Main content",
        target: { parentId: "sample-section", slotId: "content" },
      },
    };
    const consumer = record("bound-page", "Bound page");
    consumer.document.root = [consumer.document.root[0]!.slots.content![1]!];
    consumer.document.binding = { sourceRecordId: source.id, outletId: "main" };
    const indexeddb = memoryProvider("indexeddb", [source, consumer], { lifecycle: true });
    const navigation = new FakeNavigation("/composer/#/composition/indexeddb/bound-page");
    let nodeId = 0;
    const view = render(
      <ProductionComposerApp manifest={activeComponentManifest}
        providers={[indexeddb]}
        navigation={navigation}
        nodeIdFactory={() => `detached-${++nodeId}`}
        now={() => TIMESTAMP}
        preview={PREVIEW}
      />,
    );

    expect(await screen.findByText("Linked template")).toBeInTheDocument();
    expect(view.container.querySelector('[data-sg-linked-frame="resolved"]')).not.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Detach" }));

    await waitFor(() => {
      const detached = indexeddb.records.get("bound-page")!;
      expect(detached.document.binding).toBeUndefined();
      expect(detached.document.root[0]?.id).toMatch(/^detached-/);
    });
    expect((indexeddb.store as unknown as { saveLifecycleRecord: ReturnType<typeof vi.fn> }).saveLifecycleRecord).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(navigation.read()).toEqual({
        pathname: "/composer/",
        hash: "#/composition/indexeddb/bound-page",
      }),
    );
    expect(screen.queryByRole("button", { name: "Detach" })).not.toBeInTheDocument();
  });

  it("keeps the New dialog open and does not save when the selected template is deleted before submit", async () => {
    const template = record("site-shell", "Site shell");
    template.document.publication = {
      kind: "global-template",
      outlet: {
        id: "main",
        label: "Main content",
        target: { parentId: "sample-section", slotId: "right" },
      },
    };
    const indexeddb = memoryProvider("indexeddb", [template]);
    render(
      <ProductionComposerApp manifest={activeComponentManifest}
        providers={[indexeddb]}
        navigation={new FakeNavigation()}
        idFactory={() => "never-saved"}
        now={() => TIMESTAMP}
        preview={PREVIEW}
      />,
    );
    await screen.findByRole("heading", { name: "Compositions" });
    fireEvent.click(screen.getAllByRole("button", { name: "New composition" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Site shell/ }));
    indexeddb.records.delete("site-shell");
    vi.mocked(indexeddb.store.put).mockClear();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create composition" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("selected Global template changed");
    expect(indexeddb.store.put).not.toHaveBeenCalled();
    expect(indexeddb.records.has("never-saved")).toBe(false);
  });

  it("checks only the active provider's consumers before unpublishing a Global template", async () => {
    const source = record("site-shell", "Site shell");
    source.document.publication = {
      kind: "global-template",
      outlet: {
        id: "main",
        label: "Main content",
        target: { parentId: "sample-section", slotId: "right" },
      },
    };
    const consumer = record("bound-page", "Bound page");
    consumer.document.binding = { sourceRecordId: "site-shell", outletId: "main" };
    const indexeddb = memoryProvider("indexeddb", [source, consumer]);
    const files = memoryProvider("files", [record("unrelated", "Unrelated file")]);
    const navigation = new FakeNavigation("/composer/#/composition/indexeddb/site-shell");
    render(
      <ProductionComposerApp manifest={activeComponentManifest}
        providers={[indexeddb, files]}
        navigation={navigation}
        preview={PREVIEW}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Unpublish Global template" }));
    const confirm = screen.getByRole("group", { name: "Unpublish Global template?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Unpublish Global template" }));

    await waitFor(() =>
      expect(document.querySelector("[data-sg-reuse-feedback]")).toHaveTextContent(
        "Cannot unpublish this Global template while 1 consumer is still bound",
      ),
    );
    expect(indexeddb.store.list).toHaveBeenCalled();
    expect(indexeddb.store.get).toHaveBeenCalledWith("bound-page");
    expect(files.store.list).not.toHaveBeenCalled();
    expect(indexeddb.records.get("site-shell")?.document.publication).toMatchObject({
      kind: "global-template",
      outlet: { id: "main" },
    });
  });


  it("persists index-to-detail edits across a fresh mount with the real IndexedDB provider", async () => {
    const provider = createIndexedDbCompositionProvider({
      idbFactory: new FDBFactory(),
      initialDocument: createActiveSampleDocument,
      idFactory: () => "real-composition",
      now: () => TIMESTAMP,
    });
    const navigation = new FakeNavigation();
    const first = render(
      <ProductionComposerApp manifest={activeComponentManifest}
        providers={[provider]}
        navigation={navigation}
        now={() => TIMESTAMP}
        preview={PREVIEW}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Open Product overview" }));
    await screen.findByRole("button", { name: "Library" });
    const tree = first.container.querySelector("#sg-composer-tree") as HTMLElement;
    const inspector = first.container.querySelector("#sg-composer-inspector") as HTMLElement;
    fireEvent.click(within(tree).getByRole("button", { name: "Expand Section Product overview" }));
    fireEvent.click(within(tree).getByRole("button", { name: /^Button/ }));
    fireEvent.input(within(inspector).getByLabelText("Label"), {
      target: { value: "Persisted in IndexedDB" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    await screen.findByRole("heading", { name: "Compositions" });
    first.unmount();

    navigation.visit("/composer/#/composition/indexeddb/real-composition");
    const refreshed = render(
      <ProductionComposerApp manifest={activeComponentManifest}
        providers={[provider]}
        navigation={navigation}
        now={() => TIMESTAMP}
        preview={PREVIEW}
      />,
    );
    await screen.findByRole("button", { name: "Library" });
    const refreshedTree = refreshed.container.querySelector("#sg-composer-tree") as HTMLElement;
    const refreshedInspector = refreshed.container.querySelector(
      "#sg-composer-inspector",
    ) as HTMLElement;
    fireEvent.click(
      within(refreshedTree).getByRole("button", { name: "Expand Section Product overview" }),
    );
    fireEvent.click(within(refreshedTree).getByRole("button", { name: /^Button/ }));
    expect(within(refreshedInspector).getByLabelText("Label")).toHaveValue(
      "Persisted in IndexedDB",
    );
  });

  it("lands a debounce-pending inspector value before the save queue is flushed", async () => {
    const indexeddb = memoryProvider("indexeddb", [record("alpha", "Alpha")]);
    const navigation = new FakeNavigation("/composer/#/composition/indexeddb/alpha");
    const view = render(
      <ProductionComposerApp manifest={activeComponentManifest}
        providers={[indexeddb]}
        navigation={navigation}
        preview={PREVIEW}
      />,
    );

    await screen.findByRole("button", { name: "Library" });
    const tree = view.container.querySelector("#sg-composer-tree") as HTMLElement;
    const inspector = view.container.querySelector("#sg-composer-inspector") as HTMLElement;
    fireEvent.click(within(tree).getByRole("button", { name: "Expand Section Product overview" }));
    fireEvent.click(within(tree).getByRole("button", { name: /^Button/ }));
    fireEvent.input(within(inspector).getByLabelText("Label"), {
      target: { value: "Last keystroke before leaving" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Library" }));

    await screen.findByRole("heading", { name: "Compositions" });
    const saved = indexeddb.records.get("alpha")!;
    const cta = saved.document.root[0].slots.content?.find(
      (node) => node.id === "sample-button",
    );
    expect(cta?.props.children).toBe("Last keystroke before leaving");
  });

  it("duplicates and opens only inside the selected provider", async () => {
    const indexeddb = memoryProvider("indexeddb", [record("same", "Browser copy")]);
    const files = memoryProvider("files", [record("same", "File copy")]);
    const navigation = new FakeNavigation();
    let nodeId = 0;
    render(
      <ProductionComposerApp manifest={activeComponentManifest}
        providers={[indexeddb, files]}
        navigation={navigation}
        idFactory={() => "file-copy"}
        nodeIdFactory={() => `copied-node-${++nodeId}`}
        preview={PREVIEW}
      />,
    );
    await screen.findByRole("heading", { name: "Compositions" });
    fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), {
      target: { value: "files" },
    });
    await screen.findByRole("button", { name: "Open File copy" });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate File copy" }));

    expect(await screen.findByRole("button", { name: "Library" })).toBeInTheDocument();
    expect(files.records.get("file-copy")?.document.name).toBe("File copy copy");
    expect(indexeddb.records.has("file-copy")).toBe(false);
    expect(navigation.pushes.at(-1)).toBe("/composer/#/composition/files/file-copy");
  });



  it("duplicates the mounted composition into its active provider and opens its route", async () => {
    const indexeddb = memoryProvider("indexeddb", [record("same", "Browser copy")]);
    const files = memoryProvider("files", [record("same", "File copy")]);
    const navigation = new FakeNavigation("/composer/#/composition/files/same");
    let nodeId = 0;
    const view = render(
      <ProductionComposerApp manifest={activeComponentManifest}
        providers={[indexeddb, files]}
        navigation={navigation}
        idFactory={() => "detail-copy"}
        nodeIdFactory={() => `detail-node-${++nodeId}`}
        preview={PREVIEW}
      />,
    );
    await screen.findByRole("button", { name: "Duplicate composition" });
    const tree = view.container.querySelector("#sg-composer-tree") as HTMLElement;
    const inspector = view.container.querySelector("#sg-composer-inspector") as HTMLElement;
    fireEvent.click(within(tree).getByRole("button", { name: "Expand Section Product overview" }));
    fireEvent.click(within(tree).getByRole("button", { name: /^Button/ }));
    fireEvent.input(within(inspector).getByLabelText("Label"), {
      target: { value: "Duplicated latest draft" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Duplicate composition" }));

    await waitFor(() =>
      expect(navigation.read()).toEqual({
        pathname: "/composer/",
        hash: "#/composition/files/detail-copy",
      }),
    );
    expect(screen.getAllByText("File copy copy").length).toBeGreaterThan(0);
    expect(files.records.get("detail-copy")?.document.name).toBe("File copy copy");
    expect(files.records.get("detail-copy")?.document.root[0].id).not.toBe("sample-section");
    expect(
      files.records.get("detail-copy")?.document.root[0].slots.content?.find(
        (node) => node.componentId === "fixture.button",
      )?.props.children,
    ).toBe("Duplicated latest draft");
    expect(indexeddb.records.has("detail-copy")).toBe(false);
    expect(files.store.get).toHaveBeenCalledWith("detail-copy");
  });

  it("reopens provider-qualified detail routes delivered by browser history", async () => {
    const indexeddb = memoryProvider("indexeddb", [record("alpha", "Alpha")]);
    const files = memoryProvider("files", [record("alpha", "File Alpha")]);
    const navigation = new FakeNavigation();
    render(<ProductionComposerApp manifest={activeComponentManifest} providers={[indexeddb, files]} navigation={navigation} preview={PREVIEW} />);
    await screen.findByRole("heading", { name: "Compositions" });

    navigation.visit("/composer/#/composition/files/alpha");

    expect(await screen.findByRole("button", { name: "Library" })).toBeInTheDocument();
    expect(screen.getAllByText("File Alpha").length).toBeGreaterThan(0);
  });

  it("renders future-schema recovery on a direct detail load and returns safely after Start fresh", async () => {
    const records = new Map<string, CompositionRecord>();
    let quarantined = true;
    const recovered = record("fresh", "Fresh sample");
    const indexeddb = memoryProvider("indexeddb", [], {
      initialize: async () =>
        quarantined
          ? {
              status: "recovery-required",
              recovery: {
                kind: "quarantined",
                reason: "future-schema",
                foundSchemaVersion: 99,
                sourcePreserved: true,
                message: "Future source is quarantined unchanged.",
              },
            }
          : ready(records),
    });
    indexeddb.initialization.startFresh = vi.fn(async () => {
      quarantined = false;
      records.set(recovered.id, recovered);
      indexeddb.records.set(recovered.id, recovered);
      return ready(indexeddb.records);
    });
    const navigation = new FakeNavigation("/composer/#/composition/indexeddb/future");
    render(<ProductionComposerApp manifest={activeComponentManifest} providers={[indexeddb]} navigation={navigation} preview={PREVIEW} />);

    expect(await screen.findByRole("heading", { name: "Recovery required" })).toBeInTheDocument();
    expect(screen.getByText("Future source is quarantined unchanged.")).toBeInTheDocument();
    expect(screen.getByText("The original source has been preserved.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));

    expect(await screen.findByRole("heading", { name: "Compositions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Fresh sample" })).toBeInTheDocument();
    expect(navigation.replacements.at(-1)).toBe("/composer/#/");
  });

  it("does not let slow direct-detail initialization override newer history", async () => {
    const initialization = deferred<CompositionInitializationOutcome>();
    const alpha = record("alpha", "Alpha");
    const indexeddb = memoryProvider("indexeddb", [alpha], {
      initialize: () => initialization.promise,
    });
    const navigation = new FakeNavigation("/composer/#/composition/indexeddb/alpha");
    render(
      <ProductionComposerApp manifest={activeComponentManifest}
        providers={[indexeddb]}
        navigation={navigation}
        preview={PREVIEW}
      />,
    );

    navigation.visit("/composer/#/");
    expect(await screen.findByRole("heading", { name: "Loading compositions…" })).toBeInTheDocument();
    initialization.resolve(ready(indexeddb.records));

    expect(await screen.findByRole("heading", { name: "Compositions" })).toBeInTheDocument();
    await Promise.resolve();
    expect(navigation.read()).toEqual({ pathname: "/composer/", hash: "#/" });
    expect(indexeddb.store.get).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Library" })).not.toBeInTheDocument();
  });

});
