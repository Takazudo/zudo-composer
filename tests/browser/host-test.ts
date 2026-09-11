import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { test as base, expect } from "@playwright/test";
import { createDocumentReady, finishReadiness, type DocumentReady } from "../document-readiness";
import { watchRuntimeFailures } from "../runtime-failures";

export type { DocumentReady } from "../document-readiness";
export const test = base.extend<{ documentReady: DocumentReady; hostRuntime: DocumentReady }>({
  hostRuntime: [async ({ page }, use, info) => {
    const failures = watchRuntimeFailures(page);
    const path = info.outputPath("document-readiness.jsonl");
    const identity = { testId: info.testId, testTitle: info.title, testFile: info.file,
      project: info.project.name, retry: info.retry, workerIndex: info.workerIndex };
    const report = (message: string) => console.error(`[document-readiness] ${message} (${path})`);
    const append = async (row: object) => {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify({ ...identity, ...row })}\n`, "utf8");
    };
    const documentReady = createDocumentReady({
      now: () => performance.now(), url: () => page.url(), failures, report, record: append,
      settleShell: ({ remainingMs }) => expect(page.locator('.cms-shell-main [aria-busy="true"]'))
        .toHaveCount(0, { timeout: remainingMs() }),
    });
    let primary = false;
    try { await use(documentReady); }
    catch (error) { primary = true; throw error; }
    finally {
      await finishReadiness({
        failures, hasPrimaryError: () => primary || info.errors.length > 0, report,
        persist: () => append({ schemaVersion: 1, gate: "host-document-ready/v1", kind: "test-summary",
          status: info.status, runtimeFailures: [...failures], errors: info.errors }),
        attach: () => info.attach("document-readiness", { path, contentType: "application/jsonl" }),
      });
    }
  }, { auto: true }],
  documentReady: async ({ hostRuntime }, use) => { await use(hostRuntime); },
});
