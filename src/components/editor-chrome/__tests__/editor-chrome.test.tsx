import "./cleanup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, getScope, Show, signal } from "@takazudo/zfb/zudo-react";
import { fireEvent, render, screen, settle } from "../../../test/render";
import { chromeSnapshot, createChromeStore } from "../../../app/chrome-context";
import type { ChromeStore, EditorStatus } from "../../../app/chrome-context";
import { Button } from "../../ui/button";
import { EditorBody } from "../editor-body";
import { EditorChrome } from "../editor-chrome";
import { createEditorChrome } from "../editor-chrome-controller";
import { RecordTitle } from "../record-title";

function ChromeProbe({ store }: { store: ChromeStore }) {
  const snapshot = chromeSnapshot(getScope(), store);
  const hasRetry = computed(() => snapshot.value.editorStatus?.onRetry !== undefined);
  return (
    <div>
      <p data-testid="status">{computed(() => snapshot.value.editorStatus?.state ?? "none")}</p>
      <Show when={hasRetry}>{() => <button type="button" on:click={() => snapshot.value.editorStatus?.onRetry?.()}>Retry</button>}</Show>
    </div>
  );
}

function withChrome(status: EditorStatus | null, dirty = false) {
  const store = createChromeStore();
  const chrome = createEditorChrome({ editorKey: "composer" });
  return render(
    <>
      <ChromeProbe store={store} />
      <EditorChrome chrome={chrome} appChrome={store} status={status} dirty={dirty}>
        <EditorBody chrome={chrome} nav={<p>Structure</p>} main={<p>Canvas</p>} inspector={<p>Inspect</p>} />
      </EditorChrome>
    </>,
  );
}

function unload(): boolean {
  return !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("innerWidth", 1600);
});

describe("EditorChrome toolbar", () => {
  it("renders the back link, the record name, and the two action slots", async () => {
    render(
      <EditorChrome
        editorKey="composer"
        back={{ href: "/composer", label: "Back to Compositions" }}
        title={<RecordTitle value="Product overview" onCommit={vi.fn()} label="Composition name" />}
        center={<Button>Preview</Button>}
        right={<Button variant="primary">Export JSX</Button>}
      >
        <p>body</p>
      </EditorChrome>,
    );

    expect(screen.getByRole("link", { name: "Back to Compositions" })).toHaveAttribute("href", "/composer");
    expect(screen.getByRole("textbox", { name: "Composition name" })).toHaveValue("Product overview");
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export JSX" })).toBeInTheDocument();
  });

  it("omits every optional slot when the editor has nothing to put in it", async () => {
    render(<EditorChrome editorKey="composer"><p>body</p></EditorChrome>);

    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector(".cms-editor__center")).toBeNull();
    expect(document.querySelector(".cms-editor__right")).toBeNull();
  });
});

describe("EditorChrome pane switch", () => {
  it("names the three panes as the editor calls them and starts on the main one", async () => {
    render(
      <EditorChrome editorKey="composer" paneLabels={{ nav: "Structure", main: "Canvas", insp: "Inspect" }}>
        <p>body</p>
      </EditorChrome>,
    );

    expect(screen.getByRole("radiogroup", { name: "Pane" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Structure", "Canvas", "Inspect"]);
    expect(screen.getByRole("radio", { name: "Canvas", checked: true })).toBeInTheDocument();
  });

  it("switches which region the narrow layout shows", async () => {
    const chrome = createEditorChrome({ editorKey: "composer" });
    render(
      <EditorChrome chrome={chrome} paneLabels={{ nav: "Structure", main: "Canvas", insp: "Inspect" }}>
        <EditorBody chrome={chrome} nav={<p>Structure</p>} main={<p>Canvas</p>} inspector={<p>Inspect</p>} />
      </EditorChrome>,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Structure" }));
    await settle();

    expect(document.querySelector('[data-pane="nav"]')).toHaveAttribute("data-pane-active", "true");
    expect(document.querySelector('[data-pane="main"]')).toHaveAttribute("data-pane-active", "false");
  });

  it("has nothing to switch when the editor is a single pane", async () => {
    render(
      <EditorChrome editorKey="content" paneLabels={{ main: "Fields" }}>
        <p>body</p>
      </EditorChrome>,
    );

    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("lets the owning route drive the selection", async () => {
    const onActivePaneChange = vi.fn();
    const chrome = createEditorChrome({ editorKey: "composer", activePane: "main", onActivePaneChange });
    render(
      <EditorChrome
        chrome={chrome}
        paneLabels={{ nav: "Structure", main: "Canvas", insp: "Inspect" }}
      >
        <EditorBody chrome={chrome} nav={<p>Structure</p>} main={<p>Canvas</p>} inspector={<p>Inspect</p>} />
      </EditorChrome>,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Structure" }));
    await settle();

    expect(onActivePaneChange).toHaveBeenCalledExactlyOnceWith("nav");
    expect(document.querySelector('[data-pane="main"]')).toHaveAttribute("data-pane-active", "true");
  });
});

describe("EditorChrome save state", () => {
  function StatusHarness({ status, open = true }: { status: EditorStatus | null | ReturnType<typeof signal<EditorStatus | null>>; open?: boolean | ReturnType<typeof signal<boolean>> }) {
    const shown = typeof open === "boolean" ? signal(open) : open;
    return (
      <>
        <ChromeProbe store={store} />
        <Show when={shown}>
          {() => (
            <EditorChrome editorKey="composer" appChrome={store} status={status}>
              <p>body</p>
            </EditorChrome>
          )}
        </Show>
      </>
    );
  }

  let store = createChromeStore();
  beforeEach(() => {
    store = createChromeStore();
  });

  it("publishes the editor's save state to the app chrome, and follows it", async () => {
    const status = signal<EditorStatus | null>({ state: "unsaved" });
    render(<StatusHarness status={status} />);
    await settle();
    expect(screen.getByTestId("status")).toHaveTextContent("unsaved");

    status.value = { state: "saving" };
    await settle();
    expect(screen.getByTestId("status")).toHaveTextContent("saving");

    status.value = { state: "saved" };
    await settle();
    expect(screen.getByTestId("status")).toHaveTextContent("saved");
  });

  it("publishes nothing for an editor that has no save state to report", async () => {
    render(<StatusHarness status={null} />);
    await settle();
    expect(screen.getByTestId("status")).toHaveTextContent("none");
  });

  it("hands the chrome a retry the failed editor can act on", async () => {
    const onRetry = vi.fn();
    render(<StatusHarness status={{ state: "failed", detail: "Network error", onRetry }} />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await settle();

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("withdraws the status when the editor unmounts", async () => {
    const open = signal(true);
    render(<StatusHarness status={{ state: "unsaved" }} open={open} />);
    await settle();
    expect(screen.getByTestId("status")).toHaveTextContent("unsaved");

    open.value = false;
    await settle();
    expect(screen.getByTestId("status")).toHaveTextContent("none");
  });
});

describe("EditorChrome unload guard", () => {
  it("guards the unload only while the record is dirty", async () => {
    const { unmount } = withChrome({ state: "saved" });
    await settle();
    expect(unload()).toBe(false);
    unmount();

    withChrome({ state: "unsaved" }, true);
    await settle();
    expect(unload()).toBe(true);
  });
});
