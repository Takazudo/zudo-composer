import type { Page } from "@playwright/test";

/**
 * The composer file provider answers a write or a listing with HTTP 409
 * `output-required` when it needs the client to compute the derived JSX for the
 * records it is about to verify; the client plans that batch and retries. It is
 * a designed round trip, not a failure — but the browser logs every non-2xx
 * response as a console error, so a lane that watched console output naively
 * would fail on ordinary authoring traffic.
 *
 * Only the file-provider endpoints are exempt, and only at 409: any other
 * status from them, and every 409 from anywhere else, is still a failure.
 */
const OUTPUT_HANDSHAKE = /Failed to load resource: the server responded with a status of 409/;

/**
 * Console errors, page errors and failed requests, collected as they happen.
 *
 * Shared by both browser lanes: six specs carried their own copy of this, and
 * the copies had already drifted over whether an aborted request counts.
 */
export function watchRuntimeFailures(page: Page): string[] {
  const failures: string[] = [];
  let handshakes = 0;
  page.on("response", (response) => {
    if (response.status() === 409 && response.url().includes("/__zudo_composer_")) handshakes += 1;
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // The console message carries no status of its own to match against, so the
    // count of observed handshake responses is what excuses one such line.
    if (OUTPUT_HANDSHAKE.test(message.text()) && handshakes > 0) {
      handshakes -= 1;
      return;
    }
    failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText;
    // A navigation that supersedes an in-flight request aborts it; that is the
    // browser doing its job, not the application failing.
    if (errorText === "net::ERR_ABORTED") return;
    failures.push(`request: ${request.url()} (${errorText})`);
  });
  return failures;
}
