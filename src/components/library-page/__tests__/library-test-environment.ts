// Shared setup for the library suite. Importing the render adapter registers
// its auto-cleanup, and jsdom ships `<dialog>` without its modal methods —
// `ConfirmDialog` needs the same stand-ins the overlay suite installs.
import "../../../test/render";

if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(): void {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(returnValue?: string): void {
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}
