/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPOSITION_PROVIDERS,
  summarizeComposition,
  type CompositionInitializationOutcome,
  type CompositionDeleteOutcome,
  type CompositionProvider,
  type CompositionProviderDescriptor,
  type CompositionProviderId,
  type CompositionRecord,
} from "../../../../composer/browser";
import { fixtureComponentProvider, createFixtureSampleDocument } from "../../test-support/fixture-pack";
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
// The compositions domain ships a single provider descriptor; the Composer
// still routes, switches and scopes by provider id, so a second fixture
// descriptor is what exercises those paths.
const ALTERNATE_PROVIDER: CompositionProviderDescriptor = {
  id: "alternate" as CompositionProviderId,
  label: "Alternate storage",
  storageLabel: "Alternate fixture storage",
};
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
  providerId: "alternate" | "files",
  initial: readonly CompositionRecord[],
  overrides: {
    initialize?: () => Promise<CompositionInitializationOutcome>;
    put?: (value: CompositionRecord) => Promise<void>;
    lifecycle?: boolean;
    deleteWithDependencyCheck?: (id: string) => Promise<CompositionDeleteOutcome>;
  } = {},
): CompositionProvider & { records: Map<string, CompositionRecord> } {
  const records = new Map(initial.map((value) => [value.id, structuredClone(value)]));
  const descriptor = providerId === "files" ? COMPOSITION_PROVIDERS.files : ALTERNATE_PROVIDER;
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
      deleteWithDependencyCheck: vi.fn(overrides.deleteWithDependencyCheck ?? (async (id: string) => (
        records.delete(id) ? { status: "deleted" as const } : { status: "not-found" as const }
      ))),
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
  private location: { pathname: string; search: string; hash: string };
  private readonly listeners = new Set<() => void>();
  readonly pushes: string[] = [];
  readonly replacements: string[] = [];

  constructor(url = "/composer") {
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
    return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash };
  }
}

afterEach(() => {
  localStorage.clear();
});

describe("ProductionComposerApp", () => {
  it("normalizes the document URL and keeps same record ids isolated by provider", async () => {
    const alternate = memoryProvider("alternate", [record("same", "Browser copy")]);
    const files = memoryProvider("files", [record("same", "File copy")]);
    const navigation = new FakeNavigation("/composer");
    const view = render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider} providers={[alternate, files]} navigation={navigation} preview={PREVIEW} />,
    );

    expect(await screen.findByRole("link", { name: "Browser copy" })).toBeInTheDocument();
    expect(navigation.replacements).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Provider: Alternate storage" }));
    expect(screen.getByRole("menuitemradio", { name: "Local files" })).toBeInTheDocument();

    view.unmount();
    navigation.visit("/composer?provider=files&composition=same");
    render(<ProductionComposerApp componentProvider={fixtureComponentProvider} providers={[alternate, files]} navigation={navigation} preview={PREVIEW} />);

    expect(await screen.findByRole("link", { name: "Back to Compositions" })).toBeInTheDocument();
    expect(screen.getByLabelText("Composition name")).toHaveValue("File copy");
    expect(alternate.store.get).not.toHaveBeenCalled();
    expect(files.store.get).toHaveBeenCalledWith("same");
  });

  it("creates an empty unbound schema-v2 record only after New-dialog confirmation", async () => {
    const alternate = memoryProvider("alternate", []);
    const navigation = new FakeNavigation();
    render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[alternate]}
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
    expect(alternate.records.has("ordinary")).toBe(false);
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: " Ordinary page " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create composition" }));

    expect(await screen.findByRole("link", { name: "Back to Compositions" })).toBeInTheDocument();
    expect(alternate.records.get("ordinary")?.document).toMatchObject({
      schemaVersion: 2,
      id: "ordinary",
      name: "Ordinary page",
      root: [],
    });
    expect(alternate.records.get("ordinary")?.document.binding).toBeUndefined();
    expect(navigation.pushes.at(-1)).toBe("/composer?provider=alternate&composition=ordinary");
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
    const alternate = memoryProvider("alternate", [template]);
    const navigation = new FakeNavigation();
    render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[alternate]}
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
    expect(alternate.records.get("bound-page")?.document).toMatchObject({
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
    const alternate = memoryProvider("alternate", [source, consumer], { lifecycle: true });
    const navigation = new FakeNavigation("/composer?provider=alternate&composition=bound-page");
    let nodeId = 0;
    const view = render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[alternate]}
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
      const detached = alternate.records.get("bound-page")!;
      expect(detached.document.binding).toBeUndefined();
      expect(detached.document.root[0]?.id).toMatch(/^detached-/);
    });
    expect((alternate.store as unknown as { saveLifecycleRecord: ReturnType<typeof vi.fn> }).saveLifecycleRecord).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(navigation.read()).toEqual({
        pathname: "/composer",
        search: "?provider=alternate&composition=bound-page", hash: "",
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
    const alternate = memoryProvider("alternate", [template]);
    render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[alternate]}
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
    alternate.records.delete("site-shell");
    vi.mocked(alternate.store.put).mockClear();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create composition" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("selected Global template changed");
    expect(alternate.store.put).not.toHaveBeenCalled();
    expect(alternate.records.has("never-saved")).toBe(false);
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
    const alternate = memoryProvider("alternate", [source, consumer]);
    const files = memoryProvider("files", [record("unrelated", "Unrelated file")]);
    const navigation = new FakeNavigation("/composer?provider=alternate&composition=site-shell");
    render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[alternate, files]}
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
    expect(alternate.store.list).toHaveBeenCalled();
    expect(alternate.store.get).toHaveBeenCalledWith("bound-page");
    expect(files.store.list).not.toHaveBeenCalled();
    expect(alternate.records.get("site-shell")?.document.publication).toMatchObject({
      kind: "global-template",
      outlet: { id: "main" },
    });
  });


  it("wires mounted toolbar, parent keyboard, and canvas history requests to one controller", async () => {
    const initial = record("history", "History");
    const alternate = memoryProvider("alternate", [initial]);
    const navigation = new FakeNavigation("/composer?provider=alternate&composition=history");
    const bridge = makeTestBridge(PREVIEW.previewLocation);
    const view = render(
      <ProductionComposerApp
        componentProvider={fixtureComponentProvider}
        providers={[alternate]}
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
    const alternate = memoryProvider("alternate", [record("alpha", "Alpha")]);
    const navigation = new FakeNavigation("/composer?provider=alternate&composition=alpha");
    const view = render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[alternate]}
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
    navigation.visit("/composer");

    await screen.findByRole("heading", { name: "Compositions" });
    const saved = alternate.records.get("alpha")!;
    const cta = saved.document.root[0].slots.content?.find(
      (node) => node.id === "sample-button",
    );
    expect(cta?.props.children).toBe("Last keystroke before leaving");
  });

  it("duplicates and opens only inside the selected provider", async () => {
    const alternate = memoryProvider("alternate", [record("same", "Browser copy")]);
    const files = memoryProvider("files", [record("same", "File copy")]);
    const navigation = new FakeNavigation();
    let nodeId = 0;
    render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[alternate, files]}
        navigation={navigation}
        idFactory={() => "file-copy"}
        nodeIdFactory={() => `copied-node-${++nodeId}`}
        preview={PREVIEW}
      />,
    );
    await screen.findByRole("link", { name: "Browser copy" });
    fireEvent.click(screen.getByRole("button", { name: "Provider: Alternate storage" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Local files" }));
    await screen.findByRole("link", { name: "File copy" });
    fireEvent.click(screen.getByRole("button", { name: "More actions for File copy" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    expect(await screen.findByRole("link", { name: "Back to Compositions" })).toBeInTheDocument();
    expect(files.records.get("file-copy")?.document.name).toBe("File copy copy");
    expect(alternate.records.has("file-copy")).toBe(false);
    expect(navigation.pushes.at(-1)).toBe("/composer?provider=files&composition=file-copy");
  });



  it("duplicates the mounted composition into its active provider and opens its route", async () => {
    const alternate = memoryProvider("alternate", [record("same", "Browser copy")]);
    const files = memoryProvider("files", [record("same", "File copy")]);
    const navigation = new FakeNavigation("/composer?provider=files&composition=same");
    let nodeId = 0;
    const view = render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[alternate, files]}
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
        search: "?provider=files&composition=detail-copy", hash: "",
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
    expect(alternate.records.has("detail-copy")).toBe(false);
    expect(files.store.get).toHaveBeenCalledWith("detail-copy");
  });

  it("reopens provider-qualified detail routes delivered by browser history", async () => {
    const alternate = memoryProvider("alternate", [record("alpha", "Alpha")]);
    const files = memoryProvider("files", [record("alpha", "File Alpha")]);
    const navigation = new FakeNavigation();
    render(<ProductionComposerApp componentProvider={fixtureComponentProvider} providers={[alternate, files]} navigation={navigation} preview={PREVIEW} />);
    await screen.findByRole("heading", { name: "Compositions" });

    navigation.visit("/composer?provider=files&composition=alpha");

    expect(await screen.findByRole("link", { name: "Back to Compositions" })).toBeInTheDocument();
    expect(screen.getByLabelText("Composition name")).toHaveValue("File Alpha");
  });

  it("renders future-schema recovery on a direct detail load and returns safely after Start fresh", async () => {
    const records = new Map<string, CompositionRecord>();
    let quarantined = true;
    const recovered = record("fresh", "Fresh sample");
    const alternate = memoryProvider("alternate", [], {
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
    alternate.initialization.startFresh = vi.fn(async () => {
      quarantined = false;
      records.set(recovered.id, recovered);
      alternate.records.set(recovered.id, recovered);
      return ready(alternate.records);
    });
    const navigation = new FakeNavigation("/composer?provider=alternate&composition=future");
    render(<ProductionComposerApp componentProvider={fixtureComponentProvider} providers={[alternate]} navigation={navigation} preview={PREVIEW} />);

    expect(await screen.findByText("Stored compositions need recovery.")).toBeInTheDocument();
    expect(screen.getByText(/Future source is quarantined unchanged\./)).toBeInTheDocument();
    expect(screen.getByText(/The original source has been preserved\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start fresh…" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Start fresh?" })).getByRole("button", { name: "Start fresh" }));

    expect(await screen.findByRole("link", { name: "Fresh sample" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Compositions" })).toBeInTheDocument();
    expect(navigation.replacements.at(-1)).toBe("/composer");
  });

  it("does not let slow direct-detail initialization override newer history", async () => {
    const initialization = deferred<CompositionInitializationOutcome>();
    const alpha = record("alpha", "Alpha");
    const alternate = memoryProvider("alternate", [alpha], {
      initialize: () => initialization.promise,
    });
    const navigation = new FakeNavigation("/composer?provider=alternate&composition=alpha");
    render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[alternate]}
        navigation={navigation}
        preview={PREVIEW}
      />,
    );

    navigation.visit("/composer");
    expect(await screen.findByRole("status")).toHaveTextContent("Loading compositions…");
    initialization.resolve(ready(alternate.records));

    expect(await screen.findByRole("heading", { name: "Compositions" })).toBeInTheDocument();
    await Promise.resolve();
    expect(navigation.read()).toEqual({ pathname: "/composer", search: "", hash: "" });
    expect(alternate.store.get).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Back to Compositions" })).not.toBeInTheDocument();
  });

  it("opens the New-composition dialog once for the /composer?new=1 route intent", async () => {
    const alternate = memoryProvider("alternate", [record("alpha", "Alpha")]);
    const navigation = new FakeNavigation();
    render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[alternate]}
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
    navigation.visit("/composer?provider=alternate&composition=alpha");
    await screen.findByRole("link", { name: "Back to Compositions" });
    navigation.visit("/composer");
    await screen.findByRole("link", { name: "Alpha" });
    expect(screen.queryByRole("dialog", { name: "New composition" })).not.toBeInTheDocument();
  });

  it("dependency-checks deletion of a mounted Global template and keeps the editor open when blocked", async () => {
    const template = record("site-shell", "Site shell");
    template.document.publication = {
      kind: "global-template",
      outlet: { id: "main", label: "Main", target: { parentId: "sample-section", slotId: "content" } },
    };
    const consumer = record("consumer", "Consumer");
    consumer.document.binding = { sourceRecordId: template.id, outletId: "main" };
    const alternate = memoryProvider("alternate", [template, consumer], {
      lifecycle: true,
      deleteWithDependencyCheck: vi.fn(async () => ({
        status: "blocked" as const,
        dependents: [{ summary: summarizeComposition(consumer), binding: consumer.document.binding! }],
      })),
    });
    render(
      <ProductionComposerApp
        componentProvider={fixtureComponentProvider}
        providers={[alternate]}
        navigation={new FakeNavigation("/composer?provider=alternate&composition=site-shell")}
        preview={PREVIEW}
      />,
    );
    await screen.findByRole("link", { name: "Back to Compositions" });
    fireEvent.click(screen.getByRole("button", { name: "More composition actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete Site shell?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Cannot delete this Global template while 1 consumer is still linked.")).toBeInTheDocument();
    expect(alternate.records.has("site-shell")).toBe(true);
    expect(alternate.store.delete).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Back to Compositions" })).toBeInTheDocument();
  });

  it("reports a malformed /composer?new=0 route intent instead of silently opening the dialog", async () => {
    const alternate = memoryProvider("alternate", [record("alpha", "Alpha")]);
    render(
      <ProductionComposerApp componentProvider={fixtureComponentProvider}
        providers={[alternate]}
        navigation={new FakeNavigation()}
        preview={PREVIEW}
        readIntentSearch={() => "?new=0"}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("must be 1");
    expect(screen.queryByRole("dialog", { name: "New composition" })).not.toBeInTheDocument();
  });

});
