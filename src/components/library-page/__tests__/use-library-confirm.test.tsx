import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import "./library-test-environment";
import { ConfirmDialog } from "../../overlay";
import { Button } from "../../ui";
import { useLibraryConfirm } from "../use-library-confirm";

function ConfirmHarness({ onDelete, onStartFresh }: { onDelete: () => void; onStartFresh: () => void }) {
  const confirm = useLibraryConfirm();
  return (
    <div>
      <Button
        onClick={() =>
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
        onClick={() =>
          confirm.request({ title: "Start fresh?", message: "Quarantined records are discarded.", onConfirm: onStartFresh })
        }
      >
        Start fresh…
      </Button>
      <ConfirmDialog {...confirm.dialogProps} />
    </div>
  );
}

describe("useLibraryConfirm", () => {
  function setup() {
    const onDelete = vi.fn();
    const onStartFresh = vi.fn();
    render(<ConfirmHarness onDelete={onDelete} onStartFresh={onStartFresh} />);
    return { onDelete, onStartFresh };
  }

  it("keeps the dialog shut until a question is asked", () => {
    setup();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks the requested question and runs the action on confirm", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));

    const dialog = screen.getByRole("alertdialog", { name: "Delete Blog post?" });
    expect(dialog).toHaveTextContent("This cannot be undone.");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("closes without running the action on cancel", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("reuses the one dialog for every destructive answer in the route", () => {
    const { onDelete, onStartFresh } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Start fresh…" }));
    expect(screen.getByRole("alertdialog", { name: "Start fresh?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onStartFresh).toHaveBeenCalledOnce();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
