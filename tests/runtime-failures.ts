import type { Page } from "@playwright/test";

/**
 * Console errors, page errors and failed requests, collected as they happen.
 *
 * Shared by the host, dev and site-project browser lanes. The composer file
 * provider's derived-output handshake returns HTTP 200 with a `needs-output`
 * outcome; the client plans that batch and retries. No console errors are
 * exempted for this ordinary authoring round trip.
 */
export function watchRuntimeFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
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
