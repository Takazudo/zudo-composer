import "./cleanup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { SettingsIcon } from "../../icons";
import { Button } from "../button";
import { Pane, PaneBody, PaneHeader, PaneSection, PaneTabs } from "../pane";
import type { PaneTab } from "../pane";

describe("Pane", () => {
  it("is a named region carrying its variant", () => {
    render(
      <Pane label="Structure" variant="main">
        <PaneBody>Body</PaneBody>
      </Pane>,
    );
    const pane = screen.getByRole("region", { name: "Structure" });
    expect(pane.className).toBe("cms-pane cms-pane--main");
  });

  it("stays unnamed and unvaried by default", () => {
    const { container } = render(<Pane>Body</Pane>);
    const pane = container.querySelector("section")!;
    expect(pane.className).toBe("cms-pane");
    expect(pane).not.toHaveAttribute("aria-label");
  });
});

describe("PaneHeader", () => {
  it("shows the title, its count and the trailing actions", () => {
    const onSettings = vi.fn();
    render(
      <PaneHeader
        title="Components"
        count={12}
        actions={
          <Button size="xs" iconOnly aria-label="Pane settings" onClick={onSettings}>
            <SettingsIcon size="sm" />
          </Button>
        }
      />,
    );
    expect(screen.getByText("Components").className).toBe("cms-pane__title");
    expect(screen.getByText("12").className).toBe("cms-count-badge");
    fireEvent.click(screen.getByRole("button", { name: "Pane settings" }));
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it("omits the badge when no count is given", () => {
    const { container } = render(<PaneHeader title="Components" />);
    expect(container.querySelector(".cms-count-badge")).toBeNull();
  });

  it("can expose the title as a semantic heading", () => {
    render(<PaneHeader title="Content" as="h1" />);
    const heading = screen.getByRole("heading", { name: "Content", level: 1 });
    expect(heading).toHaveClass("cms-pane__title");
  });

  it("collapses a large count so the badge stays one row wide", () => {
    render(<PaneHeader title="Entries" count={1200} />);
    expect(screen.getByText("999+")).toBeInTheDocument();
  });
});

const TABS: readonly PaneTab<"page" | "source" | "diagnostics">[] = [
  { id: "page", label: "Page" },
  { id: "source", label: "Source" },
  { id: "diagnostics", label: "Diagnostics", count: 2 },
];

function TabsHarness({ tabs = TABS, initial = "page" as "page" | "source" | "diagnostics" }) {
  const [activeId, setActiveId] = useState(initial);
  return (
    <>
      <PaneTabs label="Inspector" tabs={tabs} activeId={activeId} onSelect={setActiveId} panelId={(id) => `panel-${id}`} />
      <div id={`panel-${activeId}`} role="tabpanel">
        {activeId}
      </div>
    </>
  );
}

describe("PaneTabs", () => {
  it("is a named tablist whose tabs point at their panel", () => {
    render(<TabsHarness />);
    const tablist = screen.getByRole("tablist", { name: "Inspector" });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "Page", selected: true })).toHaveAttribute("aria-controls", "panel-page");
  });

  it("keeps the only tab stop on the selected tab", () => {
    render(<TabsHarness initial="source" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("tabindex", "-1");
    expect(tabs[1]).toHaveAttribute("tabindex", "0");
  });

  it("activates the tab the arrow keys move to, and wraps", () => {
    render(<TabsHarness />);
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Source", selected: true })).toBe(document.activeElement);
    fireEvent.keyDown(tabs[1], { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Page", selected: true })).toBe(document.activeElement);
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: /Diagnostics/, selected: true })).toBe(document.activeElement);
  });

  it("jumps to the ends with Home and End", () => {
    render(<TabsHarness initial="source" />);
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[1], { key: "End" });
    expect(screen.getByRole("tab", { name: /Diagnostics/, selected: true })).toBeInTheDocument();
    fireEvent.keyDown(tabs[2], { key: "Home" });
    expect(screen.getByRole("tab", { name: "Page", selected: true })).toBeInTheDocument();
  });

  it("ignores the vertical arrows a horizontal tablist does not own", () => {
    render(<TabsHarness />);
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(tabs[0]);
    expect(screen.getByRole("tab", { name: "Page", selected: true })).toBeInTheDocument();
  });

  it("skips a disabled tab and never selects it", () => {
    render(
      <TabsHarness
        tabs={[
          { id: "page", label: "Page" },
          { id: "source", label: "Source", disabled: true },
          { id: "diagnostics", label: "Diagnostics" },
        ]}
      />,
    );
    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Diagnostics", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Source" })).toBeDisabled();
  });

  it("selects on click", () => {
    render(<TabsHarness />);
    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    expect(screen.getByRole("tab", { name: "Source", selected: true })).toBeInTheDocument();
  });

  it("shows a tab count badge", () => {
    render(<TabsHarness />);
    expect(within(screen.getByRole("tab", { name: /Diagnostics/ })).getByText("2")).toBeInTheDocument();
  });
});

describe("PaneSection", () => {
  it("titles its content and hosts a trailing action", () => {
    const onAdd = vi.fn();
    render(
      <PaneSection title="Bindings" action={<Button size="xs" onClick={onAdd}>Add</Button>}>
        <p>Two bindings applied.</p>
      </PaneSection>,
    );
    expect(screen.getByRole("heading", { name: /Bindings/ })).toBeInTheDocument();
    expect(screen.getByText("Two bindings applied.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("renders without an action", () => {
    const { container } = render(<PaneSection title="Bindings">Body</PaneSection>);
    expect(container.querySelector(".cms-pane__section-action")).toBeNull();
  });
});
