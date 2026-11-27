import { computed, Show, signal } from "@takazudo/zfb/zudo-react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, settle, within } from "../../../test/render";
import "./library-test-environment";
import { ComposerIcon, TrashIcon } from "../../icons";
import { ConfirmDialog } from "../../overlay";
import { Button } from "../../ui";
import { BulkBar } from "../bulk-bar";
import { LibraryPage } from "../library-page";
import { LibraryPagination } from "../library-pagination";
import { createLibraryConfirm } from "../library-confirm";
import { createLibraryQuery } from "../library-query";
import { createLibrarySelection } from "../library-selection";
import { LibraryEmpty, LibraryNoMatch, LibraryRecoveryBanner, LibrarySkeleton, LibraryUnavailableBanner } from "../library-states";
import { LibraryTable } from "../library-table";
import { LibraryToolbar } from "../library-toolbar";
import { CONTRACT, KIND_FACET, RECORDS, SORTS, searchText, type Record_ } from "./library-fixtures";

// One route wearing the whole pattern, so the states are exercised where they
// actually meet: header → toolbar → table → bulk bar → pagination, with every
// destructive answer going through the one shared ConfirmDialog.

type Phase = "loading" | "unavailable" | "recovery" | "ready";

function FakeRoute({ phase: initialPhase = "ready" }: { phase?: Phase }) {
  const phase = signal<Phase>(initialPhase);
  const rows = signal<readonly Record_[]>(RECORDS);
  const query = createLibraryQuery({ rows, searchText, facets: [KIND_FACET], sorts: SORTS });
  const selection = createLibrarySelection({ rows, visibleRows: query.rows, rowId: CONTRACT.id });
  const confirm = createLibraryConfirm();

  function remove(ids: ReadonlySet<string>) {
    rows.value = rows.value.filter((row) => !ids.has(row.id));
  }

  const showTable = computed(() => phase.value === "ready" || phase.value === "recovery");
  return (
    <LibraryPage
      icon={ComposerIcon}
      title="Records"
      purpose="Everything this workspace can author."
      actions={<Button>Browser storage</Button>}
      primaryAction={<Button variant="primary">New record</Button>}
    >
      <Show when={computed(() => phase.value === "recovery")}>
        {() => (
          <LibraryRecoveryBanner
            title="Stored records need recovery."
            description="2 of 4 records could not be read."
            onRetry={() => {
              phase.value = "ready";
            }}
            onStartFresh={() =>
              confirm.request({
                title: "Start fresh?",
                message: "The quarantined records are discarded.",
                confirmLabel: "Start fresh",
                tone: "danger",
                onConfirm: () => {
                  rows.value = [];
                  phase.value = "ready";
                },
              })
            }
          />
        )}
      </Show>
      <Show when={computed(() => phase.value === "unavailable")}>
        {() => (
          <LibraryUnavailableBanner
            title="Record library unavailable."
            description="The store could not be opened in this browser session."
            onRetry={() => {
              phase.value = "ready";
            }}
          />
        )}
      </Show>
      <Show when={computed(() => phase.value === "loading")}>{() => <LibrarySkeleton label="Loading records…" />}</Show>
      <Show when={computed(() => showTable.value && rows.value.length === 0)}>
        {() => (
          <LibraryEmpty
            icon={ComposerIcon}
            title="No records yet"
            description="Everything this workspace can author lands here."
            action={<Button variant="primary">New record</Button>}
          />
        )}
      </Show>
      <Show when={computed(() => showTable.value && rows.value.length > 0)}>
        {() => (
          <>
            <LibraryToolbar query={query} />
            <LibraryTable
              caption="Records"
              rows={query.rows}
              contract={CONTRACT}
              selection={selection}
              empty={<LibraryNoMatch search={query.search} onClearFilters={query.clearFilters} />}
              bulkBar={computed(() =>
                selection.selectedCount.value > 0 ? (
                  <BulkBar
                    count={selection.selectedCount}
                    actions={[
                      {
                        id: "delete",
                        label: "Delete",
                        icon: TrashIcon,
                        tone: "danger",
                        onSelect: () =>
                          confirm.request({
                            title: `Delete ${selection.selectedCount.value} records?`,
                            message: "This cannot be undone.",
                            confirmLabel: "Delete",
                            tone: "danger",
                            onConfirm: () => remove(selection.selectedIds.value),
                          }),
                      },
                    ]}
                    onClear={selection.clear}
                  />
                ) : undefined,
              )}
              rowMenu={(row) => ({
                label: row.name,
                open: { id: "open", label: "Open", kbd: "↵", href: `/composer?record=${row.id}` },
                destructive: [
                  {
                    id: "delete",
                    label: "Delete…",
                    icon: TrashIcon,
                    onSelect: () =>
                      confirm.request({
                        title: `Delete ${row.name}?`,
                        message: "This cannot be undone.",
                        confirmLabel: "Delete",
                        tone: "danger",
                        onConfirm: () => remove(new Set([row.id])),
                      }),
                  },
                ],
              })}
            />
            <LibraryPagination summary={computed(() => `${query.rows.value.length} of ${rows.value.length} records · Browser storage`)} />
          </>
        )}
      </Show>
      <ConfirmDialog {...confirm.dialogProps} />
    </LibraryPage>
  );
}

const dataRows = () => screen.getAllByRole("row").slice(1);

describe("a route wearing the library pattern", () => {
  it("shows skeleton rows instead of a table while the store is read", async () => {
    render(<FakeRoute phase="loading" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading records…");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("offers a Retry that turns an unavailable store into the table", async () => {
    render(<FakeRoute phase="unavailable" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Record library unavailable.");
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(dataRows()).toHaveLength(RECORDS.length);
  });

  it("keeps the records readable behind the recovery banner and confirms Start fresh", async () => {
    render(<FakeRoute phase="recovery" />);
    expect(screen.getByRole("status")).toHaveTextContent("Stored records need recovery.");
    expect(dataRows()).toHaveLength(RECORDS.length);

    fireEvent.click(screen.getByRole("button", { name: "Start fresh…" }));
    await settle();
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Start fresh?" })).getByRole("button", { name: "Start fresh" }));
    await settle();

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No records yet")).toBeInTheDocument();
  });

  it("replaces the rows with the no-match state, and comes back from Clear filters", async () => {
    render(<FakeRoute />);
    fireEvent.input(screen.getByRole("searchbox", { name: "Filter records" }), { target: { value: "nothing here" } });
    await settle();

    expect(screen.queryByRole("link", { name: "Blog post" })).toBeNull();
    expect(screen.getByText("No matches for “nothing here”")).toBeInTheDocument();
    expect(screen.getByText("0 of 4 records · Browser storage")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await settle();
    expect(dataRows()).toHaveLength(RECORDS.length);
  });

  it("deletes one record through the row menu and the shared confirmation", async () => {
    render(<FakeRoute />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Blog post" }));
    await settle();
    fireEvent.click(within(screen.getByRole("menu", { name: "Blog post actions" })).getByRole("menuitem", { name: "Delete…" }));
    await settle();

    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Delete Blog post?" })).getByRole("button", { name: "Delete" }));
    await settle();
    expect(screen.queryByRole("link", { name: "Blog post" })).toBeNull();
    expect(screen.getByText("3 of 3 records · Browser storage")).toBeInTheDocument();
  });

  it("deletes a bulk selection and leaves the bulk bar behind with it", async () => {
    render(<FakeRoute />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Blog post" }));
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "Site frame" }));
    await settle();
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await settle();
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Delete 2 records?" })).getByRole("button", { name: "Delete" }));
    await settle();

    expect(dataRows()).toHaveLength(2);
    expect(screen.queryByText("2 selected")).toBeNull();
  });

  it("keeps a selected row picked while the filter hides it", async () => {
    render(<FakeRoute />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Blog post" }));
    await settle();
    fireEvent.input(screen.getByRole("searchbox", { name: "Filter records" }), { target: { value: "hero" } });
    await settle();

    expect(dataRows()).toHaveLength(1);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });
});
