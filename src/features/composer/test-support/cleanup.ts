// The shared render helper registers its own cleanup, so importing it is enough.
import "../../../test/render";

if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(): void {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(): void {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}
