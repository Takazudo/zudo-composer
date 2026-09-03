import "./cleanup";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ComposerIcon, SearchIcon } from "../../icons";
import { Banner } from "../banner";
import { Button } from "../button";
import { Chip } from "../chip";
import { CountBadge, Kbd } from "../badge";
import { DataTable } from "../data-table";
import { EmptyState } from "../empty-state";
import { Field } from "../field";
import { Checkbox, Input, Select, Switch, Textarea } from "../form-controls";
import { Pane, PaneBody, PaneHeader, PaneSection, PaneTabs } from "../pane";
import { SegmentedControl } from "../segmented-control";
import { StatusChip } from "../status-chip";

const UI_DIRECTORY = resolve("src/components/ui");
const uiCss = readFileSync(resolve(UI_DIRECTORY, "ui.css"), "utf8");
const appTokens = readFileSync(resolve("src/styles/app-tokens.css"), "utf8");

/** Comments legitimately mention issue numbers and colour names; rules do not. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function themeBlock(attribute: "light" | "dark"): string {
  const start = appTokens.indexOf(`:root[data-theme="${attribute}"] {`);
  expect(start).toBeGreaterThan(-1);
  return appTokens.slice(start, appTokens.indexOf("\n}", start));
}

function rootBlock(): string {
  return appTokens.slice(0, appTokens.indexOf("\n}"));
}

/** One render of every control, so both themes exercise the same markup. */
function Gallery() {
  return (
    <Pane label="Gallery">
      <PaneHeader title="Controls" count={12} actions={<Button size="xs">Add</Button>} />
      <PaneTabs label="Inspector" tabs={[{ id: "page", label: "Page" }, { id: "source", label: "Source" }]} activeId="page" onSelect={vi.fn()} />
      <PaneBody padded>
        <PaneSection title="Buttons" action={<Button size="xs">More</Button>}>
          <Button>Default</Button>
          <Button variant="primary">Primary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </PaneSection>
        <PaneSection title="Chips">
          <Chip tone="ok" dot>
            Published
          </Chip>
          <Chip tone="warn">Draft</Chip>
          <Chip tone="err">Broken</Chip>
          <Chip tone="accent">Pattern</Chip>
          <Chip tone="plain">Local</Chip>
          <CountBadge count={6} />
          <Kbd>{"⌘K"}</Kbd>
        </PaneSection>
        <PaneSection title="Status">
          <StatusChip state="saved" detail="Browser storage" />
          <StatusChip state="unsaved" />
          <StatusChip state="saving" />
          <StatusChip state="failed" onRetry={vi.fn()} />
        </PaneSection>
        <PaneSection title="Forms">
          <SegmentedControl label="View" options={[{ value: "table", label: "Table" }, { value: "cards", label: "Cards" }]} value="table" onChange={vi.fn()} />
          <Field label="Title" required kind="Text" help="Shown in the library." >
            <Input icon={SearchIcon} />
          </Field>
          <Field label="Kind" error="Pick a kind.">
            <Select onChange={vi.fn()}>
              <option value="page">Page</option>
            </Select>
          </Field>
          <Field label="Body">
            <Textarea />
          </Field>
          <Switch checked onCheckedChange={vi.fn()} label="Auto slug" />
          <Checkbox checked={false} onCheckedChange={vi.fn()} label="Include drafts" />
        </PaneSection>
        <PaneSection title="Surfaces">
          <Banner tone="warn" title="Stored compositions need recovery." action={<Button size="sm">Retry</Button>}>
            2 of 6 records could not be read.
          </Banner>
          <EmptyState icon={ComposerIcon} title="No compositions yet" description="Start from a blank document." action={<Button variant="primary">New</Button>} />
          <DataTable
            caption="Compositions"
            columns={[{ key: "name", header: "Name", variant: "name", cell: (row: { name: string }) => row.name }]}
            rows={[{ id: "c1", name: "Product overview" }]}
            rowKey={(row: { id: string }) => row.id}
            selection={{ selectedIds: new Set(["c1"]), rowLabel: (row: { name: string }) => row.name, onToggleRow: vi.fn(), onToggleAll: vi.fn() }}
            rowActions={() => <Button size="sm">Open</Button>}
            bulkBar={<span>1 selected</span>}
          />
        </PaneSection>
      </PaneBody>
    </Pane>
  );
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("both themes", () => {
  it("renders the same markup under light and dark, so colour comes only from tokens", () => {
    document.documentElement.setAttribute("data-theme", "light");
    const light = render(<Gallery />);
    const lightMarkup = light.container.innerHTML;
    expect(screen.getByRole("region", { name: "Gallery" })).toBeInTheDocument();
    light.unmount();

    document.documentElement.setAttribute("data-theme", "dark");
    const dark = render(<Gallery />);
    expect(screen.getByRole("region", { name: "Gallery" })).toBeInTheDocument();
    expect(dark.container.innerHTML).toBe(lightMarkup);
  });

  it("declares every themed token in both theme blocks", () => {
    const themed = [
      "--color-surface-3",
      "--color-faint",
      "--color-accent-soft",
      "--color-accent-line",
      "--color-success",
      "--color-success-soft",
      "--color-warning",
      "--color-warning-soft",
      "--color-warning-fg",
      "--color-danger",
      "--color-danger-soft",
      "--shadow-pop",
      "--shadow-modal",
    ];
    for (const token of themed) {
      expect(themeBlock("light")).toContain(`${token}:`);
      expect(themeBlock("dark")).toContain(`${token}:`);
    }
  });
});

describe("chrome geometry tokens", () => {
  it("declares both spacing ladders and the row, control and radius sizes", () => {
    const root = rootBlock();
    const expected: readonly [string, string][] = [
      ["--sp-1", "4px"],
      ["--sp-2", "8px"],
      ["--sp-3", "16px"],
      ["--sp-4", "32px"],
      ["--sp-b1", "6px"],
      ["--sp-b2", "12px"],
      ["--sp-b3", "24px"],
      ["--sp-b4", "48px"],
      ["--row-chrome", "32px"],
      ["--row-pick", "36px"],
      ["--control-h", "30px"],
      ["--radius", "5px"],
      ["--radius-sm", "3px"],
    ];
    for (const [token, value] of expected) expect(root).toContain(`${token}: ${value};`);
  });
});

describe("ui.css", () => {
  it("carries no colour literal — every colour is a token", () => {
    const rules = stripComments(uiCss);
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/);
  });

  it("reads only custom properties the app declares", () => {
    const declared = new Set(appTokens.match(/--[a-z0-9-]+(?=\s*:)/g) ?? []);
    const used = new Set(
      [...stripComments(uiCss).matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]),
    );
    expect([...used].filter((token) => !declared.has(token))).toEqual([]);
  });

  it("grows every target to 44px on a coarse pointer", () => {
    const start = uiCss.indexOf("@media (pointer: coarse)");
    expect(start).toBeGreaterThan(-1);
    const block = uiCss.slice(start, uiCss.indexOf("\n}", start));
    expect(block).toContain("44px");
    for (const selector of [".cms-btn", ".cms-seg__option", ".cms-pane__tab", ".cms-input", ".cms-select", ".cms-switch", ".cms-check"]) {
      expect(block).toContain(selector);
    }
  });
});

describe("components", () => {
  it("carry no colour literal of their own", () => {
    const sources = readdirSync(UI_DIRECTORY).filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"));
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const source = stripComments(readFileSync(resolve(UI_DIRECTORY, name), "utf8"));
      expect(source, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, name).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/);
    }
  });
});
