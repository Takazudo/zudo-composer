/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory as FDBFactory } from "fake-indexeddb";
import {
  COMPOSITION_PROVIDERS,
  createIndexedDbCompositionProvider,
  summarizeComposition,
  type CompositionInitializationOutcome,
  type CompositionProvider,
  type CompositionRecord,
} from "../../../../composer/browser";
import { fixtureComponentProvider, createFixtureSampleDocument } from "../../test-support/fixture-pack";
import { createProductionComposerProviders } from "../../../../app/provider-integration";
import {
  readyMessage as protocolReadyMessage,
  requestHistoryMessage as protocolRequestHistoryMessage,
} from "../../preview/protocol";
import {
  ProductionComposerApp,
  type ComposerBrowserNavigation,
} from "../production-composer-app";
import { makeTestBridge } from "../test-support/preview-harness";

const TIMESTAMP = "2026-07-14T00:00:00.000Z";
const PREVIEW = {
  previewLocation: { src: "about:blank", targetOrigin: "https://composer.test" },
} as const;
const PREVIEW_PACK = fixtureComponentProvider.manifest;

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
  const document = createFixtureSampleDocument();
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

  constructor(url = "/composer#/") {
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
    expect(createProductionComposerProviders().map(({ descriptor }) => descriptor.id)).toEqual([
      "indexeddb",
    ]);
  });

  it("normalizes the document URL and keeps same record ids isolated by provider", async () => {
    const indexeddb = memoryProvider("indexeddb", [record("same", "Browser copy")]);
    const files = memoryProvider("files", [record("same", "File copy")]);
    const navigation = new FakeNavigation("/composer");
    const view = render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider} providers={[indexeddb, files]} navigation={navigation} preview={PREVIEW} />,
    );

    expect(await screen.findByRole("link", { name: "Browser copy" })).toBeInTheDocument();
    expect(navigation.replacements).toContain("/composer#/");
    fireEvent.click(screen.getByRole("button", { name: "Provider: Browser storage" }));
    expect(screen.getByRole("menuitemradio", { name: "Local files" })).toBeInTheDocument();

    view.unmount();
    navigation.visit("/composer#/composition/files/same");
    render(<ProductionComposerApp componentProvider={fixtureComponentProvider} providers={[indexeddb, files]} navigation={navigation} preview={PREVIEW} />);

    expect(await screen.findByRole("link", { name: "Back to Compositions" })).toBeInTheDocument();
    expect(screen.getByLabelText("Composition name")).toHaveValue("File copy");
    expect(indexeddb.store.get).not.toHaveBeenCalled();
    expect(files.store.get).toHaveBeenCalledWith("same");
  });

  it("creates an empty unbound schema-v2 record only after New-dialog confirmation", async () => {
    const indexeddb = memoryProvider("indexeddb", []);
    const navigation = new FakeNavigation();
    render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[indexeddb]}
        navigation={navigation}
        idFactory={() => "ordinary"}
        now={() => TIMESTAMP}
        preview={PREVIEW}
      />,
    );
    // Waiting for the static "Compositions" heading is not enough: the header's
    // "New composition" button stays disabled while the initial load is still
    // pending, so clicking it before the empty state settles is a silent no-op.
    await screen.findByText("No compositions yet");

    fireEvent.click(screen.getAllByRole("button", { name: "New composition" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    expect(indexeddb.records.has("ordinary")).toBe(false);
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: " Ordinary page " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create composition" }));

    expect(await screen.findByRole("link", { name: "Back to Compositions" })).toBeInTheDocument();
    expect(indexeddb.records.get("ordinary")?.document).toMatchObject({
      schemaVersion: 2,
      id: "ordinary",
      name: "Ordinary page",
      root: [],
    });
    expect(indexeddb.records.get("ordinary")?.document.binding).toBeUndefined();
    expect(navigation.pushes.at(-1)).toBe("/composer#/composition/indexeddb/ordinary");
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
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[indexeddb]}
        navigation={navigation}
        idFactory={() => "bound-page"}
        now={() => TIMESTAMP}
        preview={PREVIEW}
      />,
    );
    await screen.findByRole("link", { name: "Site shell" });
    fireEvent.click(screen.getAllByRole("button", { name: "New composition" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Site shell/ }));
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Bound page" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create composition" }));

    expect(await screen.findByRole("link", { name: "Back to Compositions" })).toBeInTheDocument();
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
    const navigation = new FakeNavigation("/composer#/composition/indexeddb/bound-page");
    let nodeId = 0;
    const view = render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[indexeddb]}
        navigation={navigation}
        nodeIdFactory={() => `detached-${++nodeId}`}
        now={() => TIMESTAMP}
        preview={PREVIEW}
      />,
    );

    expect(await screen.findByText("Linked template")).toBeInTheDocument();
    const inspector = view.container.querySelector(".cms-editor__region--insp") as HTMLElement;
    fireEvent.click(within(inspector).getByRole("tab", { name: /^Reuse/ }));
    fireEvent.click(await within(inspector).findByRole("button", { name: "Detach" }));

    await waitFor(() => {
      const detached = indexeddb.records.get("bound-page")!;
      expect(detached.document.binding).toBeUndefined();
      expect(detached.document.root[0]?.id).toMatch(/^detached-/);
    });
    expect((indexeddb.store as unknown as { saveLifecycleRecord: ReturnType<typeof vi.fn> }).saveLifecycleRecord).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(navigation.read()).toEqual({
        pathname: "/composer",
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
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[indexeddb]}
        navigation={new FakeNavigation()}
        idFactory={() => "never-saved"}
        now={() => TIMESTAMP}
        preview={PREVIEW}
      />,
    );
    await screen.findByRole("link", { name: "Site shell" });
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
    const navigation = new FakeNavigation("/composer#/composition/indexeddb/site-shell");
    render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[indexeddb, files]}
        navigation={navigation}
        preview={PREVIEW}
      />,
    );

    fireEvent.click(await screen.findByRole("tab", { name: /^Reuse/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Unpublish Global template" }));
    const confirm = screen.getByRole("alertdialog", { name: "Unpublish Global template?" });
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
      initialDocument: createFixtureSampleDocument,
      idFactory: () => "real-composition",
      now: () => TIMESTAMP,
    });
    const navigation = new FakeNavigation();
    const first = render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[provider]}
        navigation={navigation}
        now={() => TIMESTAMP}
        preview={PREVIEW}
      />,
    );

    // The row's name links to the real detail route; a jsdom `fireEvent.click`
    // on an `<a>` never drives the injected `FakeNavigation`, so opening the
    // seeded sample is simulated the same way browser-driven navigation is
    // elsewhere in this file: a real `navigation.visit` to its route, once the
    // seeded row (not just the static page header) has actually loaded.
    await screen.findByRole("link", { name: "Product overview" });
    navigation.visit("/composer#/composition/indexeddb/real-composition");
    await screen.findByRole("link", { name: "Back to Compositions" });
    const tree = first.container.querySelector(".cms-editor__region--nav") as HTMLElement;
    const inspector = first.container.querySelector(".cms-editor__region--insp") as HTMLElement;
    fireEvent.click(within(tree).getByRole("treeitem", { name: /^Button/ }));
    fireEvent.input(within(inspector).getByLabelText("Label"), {
      target: { value: "Persisted in IndexedDB" },
    });
    navigation.visit("/composer#/");
    await screen.findByRole("heading", { name: "Compositions" });
    first.unmount();

    navigation.visit("/composer#/composition/indexeddb/real-composition");
    const refreshed = render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[provider]}
        navigation={navigation}
        now={() => TIMESTAMP}
        preview={PREVIEW}
      />,
    );
    await screen.findByRole("link", { name: "Back to Compositions" });
    const refreshedTree = refreshed.container.querySelector(".cms-editor__region--nav") as HTMLElement;
    const refreshedInspector = refreshed.container.querySelector(".cms-editor__region--insp") as HTMLElement;
    fireEvent.click(within(refreshedTree).getByRole("treeitem", { name: /^Button/ }));
    expect(within(refreshedInspector).getByLabelText("Label")).toHaveValue(
      "Persisted in IndexedDB",
    );
  });

  it("wires mounted toolbar, parent keyboard, and canvas history requests to one controller", async () => {
    const initial = record("history", "History");
    const indexeddb = memoryProvider("indexeddb", [initial]);
    const navigation = new FakeNavigation("/composer#/composition/indexeddb/history");
    const bridge = makeTestBridge(PREVIEW.previewLocation);
    const view = render(
      <ProductionComposerApp
        componentProvider={fixtureComponentProvider}
        providers={[indexeddb]}
        navigation={navigation}
        preview={{ ...PREVIEW, createBridge: bridge.createBridge }}
      />,
    );

    await screen.findByRole("link", { name: "Back to Compositions" });
    act(() => bridge.deliver(protocolReadyMessage(PREVIEW_PACK)));
    const toolbar = () => view.container.querySelector(".cms-editor__toolbar") as HTMLElement;
    const undo = () => within(toolbar()).getByRole("button", { name: "Undo" });
    const redo = () => within(toolbar()).getByRole("button", { name: "Redo" });

    expect(undo()).toBeDisabled();
    expect(redo()).toBeDisabled();

    const tree = view.container.querySelector(".cms-editor__region--nav") as HTMLElement;
    const inspector = view.container.querySelector(".cms-editor__region--insp") as HTMLElement;
    fireEvent.click(within(tree).getByRole("treeitem", { name: /^Button/ }));
    fireEvent.click(within(inspector).getByRole("button", { name: "Delete" }));
    expect(undo()).toBeEnabled();
    expect(redo()).toBeDisabled();

    fireEvent.click(undo());
    expect(undo()).toBeDisabled();
    expect(redo()).toBeEnabled();

    fireEvent.keyDown(document, { key: "y", ctrlKey: true });
    expect(undo()).toBeEnabled();
    expect(redo()).toBeDisabled();

    act(() => bridge.deliver(protocolRequestHistoryMessage(PREVIEW_PACK, "undo")));
    expect(undo()).toBeDisabled();
    expect(redo()).toBeEnabled();

    fireEvent.click(within(toolbar()).getByRole("radio", { name: "Preview" }));
    expect(undo()).toBeDisabled();
    expect(redo()).toBeDisabled();

    view.unmount();
  });

  it("lands a debounce-pending inspector value before the save queue is flushed", async () => {
    const indexeddb = memoryProvider("indexeddb", [record("alpha", "Alpha")]);
    const navigation = new FakeNavigation("/composer#/composition/indexeddb/alpha");
    const view = render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[indexeddb]}
        navigation={navigation}
        preview={PREVIEW}
      />,
    );

    await screen.findByRole("link", { name: "Back to Compositions" });
    const tree = view.container.querySelector(".cms-editor__region--nav") as HTMLElement;
    const inspector = view.container.querySelector(".cms-editor__region--insp") as HTMLElement;
    fireEvent.click(within(tree).getByRole("treeitem", { name: /^Button/ }));
    fireEvent.input(within(inspector).getByLabelText("Label"), {
      target: { value: "Last keystroke before leaving" },
    });
    navigation.visit("/composer#/");

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
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[indexeddb, files]}
        navigation={navigation}
        idFactory={() => "file-copy"}
        nodeIdFactory={() => `copied-node-${++nodeId}`}
        preview={PREVIEW}
      />,
    );
    await screen.findByRole("link", { name: "Browser copy" });
    fireEvent.click(screen.getByRole("button", { name: "Provider: Browser storage" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Local files" }));
    await screen.findByRole("link", { name: "File copy" });
    fireEvent.click(screen.getByRole("button", { name: "More actions for File copy" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    expect(await screen.findByRole("link", { name: "Back to Compositions" })).toBeInTheDocument();
    expect(files.records.get("file-copy")?.document.name).toBe("File copy copy");
    expect(indexeddb.records.has("file-copy")).toBe(false);
    expect(navigation.pushes.at(-1)).toBe("/composer#/composition/files/file-copy");
  });



  it("duplicates the mounted composition into its active provider and opens its route", async () => {
    const indexeddb = memoryProvider("indexeddb", [record("same", "Browser copy")]);
    const files = memoryProvider("files", [record("same", "File copy")]);
    const navigation = new FakeNavigation("/composer#/composition/files/same");
    let nodeId = 0;
    const view = render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[indexeddb, files]}
        navigation={navigation}
        idFactory={() => "detail-copy"}
        nodeIdFactory={() => `detail-node-${++nodeId}`}
        preview={PREVIEW}
      />,
    );
    await screen.findByRole("link", { name: "Back to Compositions" });
    const tree = view.container.querySelector(".cms-editor__region--nav") as HTMLElement;
    const inspector = view.container.querySelector(".cms-editor__region--insp") as HTMLElement;
    fireEvent.click(within(tree).getByRole("treeitem", { name: /^Button/ }));
    fireEvent.input(within(inspector).getByLabelText("Label"), {
      target: { value: "Duplicated latest draft" },
    });

    fireEvent.click(screen.getByRole("button", { name: "More composition actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate composition" }));

    await waitFor(() =>
      expect(navigation.read()).toEqual({
        pathname: "/composer",
        hash: "#/composition/files/detail-copy",
      }),
    );
    expect(screen.getByLabelText("Composition name")).toHaveValue("File copy copy");
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
    render(<ProductionComposerApp componentProvider={fixtureComponentProvider} providers={[indexeddb, files]} navigation={navigation} preview={PREVIEW} />);
    await screen.findByRole("heading", { name: "Compositions" });

    navigation.visit("/composer#/composition/files/alpha");

    expect(await screen.findByRole("link", { name: "Back to Compositions" })).toBeInTheDocument();
    expect(screen.getByLabelText("Composition name")).toHaveValue("File Alpha");
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
    const navigation = new FakeNavigation("/composer#/composition/indexeddb/future");
    render(<ProductionComposerApp componentProvider={fixtureComponentProvider} providers={[indexeddb]} navigation={navigation} preview={PREVIEW} />);

    expect(await screen.findByText("Stored compositions need recovery.")).toBeInTheDocument();
    expect(screen.getByText(/Future source is quarantined unchanged\./)).toBeInTheDocument();
    expect(screen.getByText(/The original source has been preserved\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start fresh…" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Start fresh?" })).getByRole("button", { name: "Start fresh" }));

    expect(await screen.findByRole("link", { name: "Fresh sample" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Compositions" })).toBeInTheDocument();
    expect(navigation.replacements.at(-1)).toBe("/composer#/");
  });

  it("does not let slow direct-detail initialization override newer history", async () => {
    const initialization = deferred<CompositionInitializationOutcome>();
    const alpha = record("alpha", "Alpha");
    const indexeddb = memoryProvider("indexeddb", [alpha], {
      initialize: () => initialization.promise,
    });
    const navigation = new FakeNavigation("/composer#/composition/indexeddb/alpha");
    render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[indexeddb]}
        navigation={navigation}
        preview={PREVIEW}
      />,
    );

    navigation.visit("/composer#/");
    expect(await screen.findByRole("status")).toHaveTextContent("Loading compositions…");
    initialization.resolve(ready(indexeddb.records));

    expect(await screen.findByRole("heading", { name: "Compositions" })).toBeInTheDocument();
    await Promise.resolve();
    expect(navigation.read()).toEqual({ pathname: "/composer", hash: "#/" });
    expect(indexeddb.store.get).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Back to Compositions" })).not.toBeInTheDocument();
  });

  it("opens the New-composition dialog once for the /composer?new=1 route intent", async () => {
    const indexeddb = memoryProvider("indexeddb", [record("alpha", "Alpha")]);
    const navigation = new FakeNavigation();
    render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[indexeddb]}
        navigation={navigation}
        preview={PREVIEW}
        readIntentSearch={() => "?new=1"}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New composition" })).not.toBeInTheDocument());

    // A one-shot intent: navigating away and back to the index (remounting
    // CompositionLibrary) must not reopen the dialog a second time.
    navigation.visit("/composer#/composition/indexeddb/alpha");
    await screen.findByRole("link", { name: "Back to Compositions" });
    navigation.visit("/composer#/");
    await screen.findByRole("link", { name: "Alpha" });
    expect(screen.queryByRole("dialog", { name: "New composition" })).not.toBeInTheDocument();
  });

  it("reports a malformed /composer?new=0 route intent instead of silently opening the dialog", async () => {
    const indexeddb = memoryProvider("indexeddb", [record("alpha", "Alpha")]);
    render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[indexeddb]}
        navigation={new FakeNavigation()}
        preview={PREVIEW}
        readIntentSearch={() => "?new=0"}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("must be 1");
    expect(screen.queryByRole("dialog", { name: "New composition" })).not.toBeInTheDocument();
  });

});
