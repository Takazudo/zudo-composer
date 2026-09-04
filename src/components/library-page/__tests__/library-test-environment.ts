// Shared setup for the library suite. The vitest config does not enable
// globals, so @testing-library/preact cannot register its own auto-cleanup,
// and jsdom ships `<dialog>` without its modal methods — `ConfirmDialog`
// needs the same stand-ins the overlay suite installs.
import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

afterEach(cleanup);

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
