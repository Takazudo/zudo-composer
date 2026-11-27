import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, settle } from "../../../test/render";
import "./library-test-environment";
import { ConfirmDialog } from "../../overlay";
import { Button } from "../../ui";
import { createLibraryConfirm } from "../library-confirm";

function ConfirmHarness({ onDelete, onStartFresh }: { onDelete: () => void; onStartFresh: () => void }) {
  const confirm = createLibraryConfirm();
  return (
    <div>
      <Button
        on:click={() =>
          confirm.request({
            title: "Delete Blog post?",
            message: "This cannot be undone.",
            confirmLabel: "Delete",
            tone: "danger",
            onConfirm: onDelete,
          })
        }
      >
        Delete…
      </Button>
      <Button
        on:click={() =>
          confirm.request({ title: "Start fresh?", message: "Quarantined records are discarded.", onConfirm: onStartFresh })
        }
      >
        Start fresh…
      </Button>
      <ConfirmDialog {...confirm.dialogProps} />
    </div>
  );
}

describe("createLibraryConfirm", () => {
  async function setup() {
    const onDelete = vi.fn();
    const onStartFresh = vi.fn();
    render(<ConfirmHarness onDelete={onDelete} onStartFresh={onStartFresh} />);
    await settle();
    return { onDelete, onStartFresh };
  }

  it("keeps the dialog shut until a question is asked", async () => {
    await setup();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks the requested question and runs the action on confirm", async () => {
    const { onDelete } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    await settle();

    const dialog = screen.getByRole("alertdialog", { name: "Delete Blog post?" });
    expect(dialog).toHaveTextContent("This cannot be undone.");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await settle();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("closes without running the action on cancel", async () => {
    const { onDelete } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("reuses the one dialog for every destructive answer in the route", async () => {
    const { onDelete, onStartFresh } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Start fresh…" }));
    await settle();
    expect(screen.getByRole("alertdialog", { name: "Start fresh?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await settle();
    expect(onStartFresh).toHaveBeenCalledOnce();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
