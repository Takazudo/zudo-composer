import "./cleanup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { ChromeContext, createChromeStore, useChrome } from "../../../app/chrome-context";
import type { EditorStatus } from "../../../app/chrome-context";
import { Button } from "../../ui/button";
import { EditorBody } from "../editor-body";
import { EditorChrome } from "../editor-chrome";
import { RecordTitle } from "../record-title";

function ChromeProbe() {
  const { editorStatus } = useChrome();
  return (
    <div>
      <p data-testid="status">{editorStatus ? editorStatus.state : "none"}</p>
      {editorStatus?.onRetry ? <button type="button" onClick={editorStatus.onRetry}>Retry</button> : null}
    </div>
  );
}

function withChrome(status: EditorStatus | null, dirty = false) {
  const store = createChromeStore();
  return render(
    <ChromeContext.Provider value={store}>
      <ChromeProbe />
      <EditorChrome editorKey="composer" status={status} dirty={dirty}>
        <EditorBody nav={<p>Structure</p>} main={<p>Canvas</p>} inspector={<p>Inspect</p>} />
      </EditorChrome>
    </ChromeContext.Provider>,
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
  it("renders the back link, the record name, and the two action slots", () => {
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

  it("omits every optional slot when the editor has nothing to put in it", () => {
    render(<EditorChrome editorKey="composer"><p>body</p></EditorChrome>);

    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector(".cms-editor__center")).toBeNull();
    expect(document.querySelector(".cms-editor__right")).toBeNull();
  });
});

describe("EditorChrome pane switch", () => {
  it("names the three panes as the editor calls them and starts on the main one", () => {
    render(
      <EditorChrome editorKey="composer" paneLabels={{ nav: "Structure", main: "Canvas", insp: "Inspect" }}>
        <p>body</p>
      </EditorChrome>,
    );

    expect(screen.getByRole("radiogroup", { name: "Pane" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Structure", "Canvas", "Inspect"]);
    expect(screen.getByRole("radio", { name: "Canvas", checked: true })).toBeInTheDocument();
  });

  it("switches which region the narrow layout shows", () => {
    render(
      <EditorChrome editorKey="composer" paneLabels={{ nav: "Structure", main: "Canvas", insp: "Inspect" }}>
        <EditorBody nav={<p>Structure</p>} main={<p>Canvas</p>} inspector={<p>Inspect</p>} />
      </EditorChrome>,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Structure" }));

    expect(document.querySelector('[data-pane="nav"]')).toHaveAttribute("data-pane-active", "true");
    expect(document.querySelector('[data-pane="main"]')).toHaveAttribute("data-pane-active", "false");
  });

  it("has nothing to switch when the editor is a single pane", () => {
    render(
      <EditorChrome editorKey="content" paneLabels={{ main: "Fields" }}>
        <p>body</p>
      </EditorChrome>,
    );

    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("lets the owning route drive the selection", () => {
    const onActivePaneChange = vi.fn();
    render(
      <EditorChrome
        editorKey="composer"
        activePane="main"
        onActivePaneChange={onActivePaneChange}
        paneLabels={{ nav: "Structure", main: "Canvas", insp: "Inspect" }}
      >
        <EditorBody nav={<p>Structure</p>} main={<p>Canvas</p>} inspector={<p>Inspect</p>} />
      </EditorChrome>,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Structure" }));

    expect(onActivePaneChange).toHaveBeenCalledExactlyOnceWith("nav");
    expect(document.querySelector('[data-pane="main"]')).toHaveAttribute("data-pane-active", "true");
  });
});

describe("EditorChrome save state", () => {
  function StatusHarness({ status, open = true }: { status: EditorStatus | null; open?: boolean }) {
    return (
      <ChromeContext.Provider value={store}>
        <ChromeProbe />
        {open ? (
          <EditorChrome editorKey="composer" status={status}>
            <p>body</p>
          </EditorChrome>
        ) : null}
      </ChromeContext.Provider>
    );
  }

  let store = createChromeStore();
  beforeEach(() => {
    store = createChromeStore();
  });

  it("publishes the editor's save state to the app chrome, and follows it", () => {
    const { rerender } = render(<StatusHarness status={{ state: "unsaved" }} />);
    expect(screen.getByTestId("status")).toHaveTextContent("unsaved");

    rerender(<StatusHarness status={{ state: "saving" }} />);
    expect(screen.getByTestId("status")).toHaveTextContent("saving");

    rerender(<StatusHarness status={{ state: "saved" }} />);
    expect(screen.getByTestId("status")).toHaveTextContent("saved");
  });

  it("publishes nothing for an editor that has no save state to report", () => {
    render(<StatusHarness status={null} />);
    expect(screen.getByTestId("status")).toHaveTextContent("none");
  });

  it("hands the chrome a retry the failed editor can act on", () => {
    const onRetry = vi.fn();
    render(<StatusHarness status={{ state: "failed", detail: "Network error", onRetry }} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("withdraws the status when the editor unmounts", () => {
    const { rerender } = render(<StatusHarness status={{ state: "unsaved" }} />);
    expect(screen.getByTestId("status")).toHaveTextContent("unsaved");

    rerender(<StatusHarness status={{ state: "unsaved" }} open={false} />);
    expect(screen.getByTestId("status")).toHaveTextContent("none");
  });
});

describe("EditorChrome unload guard", () => {
  it("guards the unload only while the record is dirty", () => {
    const { unmount } = withChrome({ state: "saved" });
    expect(unload()).toBe(false);
    unmount();

    withChrome({ state: "unsaved" }, true);
    expect(unload()).toBe(true);
  });
});
