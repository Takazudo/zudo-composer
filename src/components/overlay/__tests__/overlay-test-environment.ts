import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

// jsdom implements neither `<dialog>`'s modal methods nor the popover API, so
// the overlay suite installs the smallest stand-ins that keep the component's
// own branches — not weakened production code — under test.
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
