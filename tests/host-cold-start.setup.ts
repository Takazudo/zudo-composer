import { chromium, expect } from "@playwright/test";
import type { Browser, BrowserContext, FullConfig, Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  HOST_COLD_START_GATE,
  HOST_COLD_START_ROUTE,
  HOST_COLD_START_TIMEOUT_MS,
  HostColdStartGateError,
  type HostColdStartPage,
  assertHostColdStartRuntimeFailures,
  runHostColdStartGate,
} from "./host-cold-start";
import { watchRuntimeFailures } from "./runtime-failures";

const BROWSER_LAUNCH_TIMEOUT_MS = 30_000;
const RESULT_FILE = "host-cold-start.json";

type SetupPhase = "configuration" | "launch" | "context" | "page" | "navigation" | "heading" | "settle" | "cleanup" | "diagnostics";

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
}

interface HostColdStartResult {
  schemaVersion: 1;
  gate: typeof HOST_COLD_START_GATE;
  lane: "host";
  baseURL: string | null;
  route: typeof HOST_COLD_START_ROUTE;
  budgetMs: typeof HOST_COLD_START_TIMEOUT_MS;
  outcome: "passed" | "failed";
  browserLaunchDurationMs: number | null;
  navigationDurationMs: number | null;
  headingDurationMs: number | null;
  settleDurationMs: number | null;
  totalNavigationThroughSettleDurationMs: number | null;
  runtimeFailures: string[];
  phase: SetupPhase | null;
  error: SerializedError | null;
}

interface SetupFailure {
  phase: SetupPhase;
  cause: unknown;
  cleanupErrors: unknown[];
  runtimeFailures: string[];
}

function monotonicNow(): number {
  return performance.now();
}

function hostBaseURL(config: FullConfig): string {
  const urls = config.projects.map(({ use }) => use.baseURL);
  if (urls.length === 0 || urls.some((url) => typeof url !== "string" || url.length === 0)) {
    throw new Error("The host cold-start gate requires one configured baseURL for every project.");
  }
  const first = urls[0]!;
  if (urls.some((url) => url !== first)) {
    throw new Error(`The host cold-start gate requires one consistent baseURL; received ${urls.join(", ")}.`);
  }
  return first;
}

function outputDirectory(config: FullConfig): string {
  const outputDir = config.projects[0]?.outputDir;
  if (typeof outputDir !== "string" || outputDir.length === 0) {
    throw new Error("The host cold-start gate requires an effective project output directory.");
  }
  return outputDir;
}

function serializeError(value: unknown, seen = new Set<unknown>()): SerializedError {
  if (seen.has(value)) return { name: "CircularError", message: "Circular error cause omitted." };
  seen.add(value);
  if (value instanceof Error) {
    const result: SerializedError = { name: value.name, message: value.message };
    if (value.stack) result.stack = value.stack;
    if ("cause" in value && value.cause !== undefined) result.cause = serializeError(value.cause, seen);
    return result;
  }
  return { name: "UnknownError", message: String(value) };
}

function failureError(failure: SetupFailure): Error {
  const cleanup = failure.cleanupErrors.length === 0
    ? ""
    : ` Cleanup failures: ${failure.cleanupErrors.map((error) => serializeError(error).message).join(" | ")}.`;
  const diagnostics = failure.runtimeFailures.length === 0
    ? ""
    : ` Runtime failures: ${failure.runtimeFailures.join(" | ")}.`;
  const error = new Error(`Host cold-start ${failure.phase} failed.${diagnostics}${cleanup}`, { cause: failure.cause });
  error.name = "HostColdStartSetupError";
  return error;
}

function pageAdapter(page: Page): HostColdStartPage {
  return {
    goto: (route, options) => page.goto(route, options),
    getByRole: (role, options) => {
      const locator = page.getByRole(role, options);
      return {
        toBeVisible: (assertionOptions) => expect(locator).toBeVisible(assertionOptions),
        toHaveCount: (count, assertionOptions) => expect(locator).toHaveCount(count, assertionOptions),
      };
    },
    locator: (selector) => {
      const locator = page.locator(selector);
      return {
        toBeVisible: (assertionOptions) => expect(locator).toBeVisible(assertionOptions),
        toHaveCount: (count, assertionOptions) => expect(locator).toHaveCount(count, assertionOptions),
      };
    },
  };
}

function emptyResult(baseURL: string | null): HostColdStartResult {
  return {
    schemaVersion: 1,
    gate: HOST_COLD_START_GATE,
    lane: "host",
    baseURL,
    route: HOST_COLD_START_ROUTE,
    budgetMs: HOST_COLD_START_TIMEOUT_MS,
    outcome: "failed",
    browserLaunchDurationMs: null,
    navigationDurationMs: null,
    headingDurationMs: null,
    settleDurationMs: null,
    totalNavigationThroughSettleDurationMs: null,
    runtimeFailures: [],
    phase: null,
    error: null,
  };
}

async function closeResources(page: Page | undefined, context: BrowserContext | undefined, browser: Browser | undefined): Promise<unknown[]> {
  const errors: unknown[] = [];
  if (page) {
    try { await page.close(); }
    catch (error) { errors.push(error); }
  }
  if (context) {
    try { await context.close(); }
    catch (error) { errors.push(error); }
  }
  if (browser) {
    try { await browser.close(); }
    catch (error) { errors.push(error); }
  }
  return errors;
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const outputDir = outputDirectory(config);
  const artifactPath = join(outputDir, RESULT_FILE);
  const result = emptyResult(null);
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let runtimeFailures: string[] = [];
  let primaryFailure: SetupFailure | undefined;
  let browserLaunchStartedAt: number | undefined;

  try {
    const configuredBaseURL = hostBaseURL(config);
    result.baseURL = configuredBaseURL;

    browserLaunchStartedAt = monotonicNow();
    try {
      browser = await chromium.launch({ timeout: BROWSER_LAUNCH_TIMEOUT_MS });
      result.browserLaunchDurationMs = monotonicNow() - browserLaunchStartedAt;
    } catch (error) {
      primaryFailure = { phase: "launch", cause: error, cleanupErrors: [], runtimeFailures };
    }

    if (browser && !primaryFailure) {
      try {
        context = await browser.newContext({ baseURL: configuredBaseURL });
      } catch (error) {
        primaryFailure = { phase: "context", cause: error, cleanupErrors: [], runtimeFailures };
      }
    }

    if (context && !primaryFailure) {
      try {
        page = await context.newPage();
      } catch (error) {
        primaryFailure = { phase: "page", cause: error, cleanupErrors: [], runtimeFailures };
      }
    }

    if (page && !primaryFailure) {
      runtimeFailures = watchRuntimeFailures(page);
      try {
        const measurements = await runHostColdStartGate({
          page: pageAdapter(page),
          now: monotonicNow,
          runtimeFailures,
        });
        result.navigationDurationMs = measurements.navigationDurationMs;
        result.headingDurationMs = measurements.headingDurationMs;
        result.settleDurationMs = measurements.settleDurationMs;
        result.totalNavigationThroughSettleDurationMs = measurements.totalNavigationThroughSettleDurationMs;
      } catch (error) {
        if (error instanceof HostColdStartGateError) {
          result.navigationDurationMs = error.measurements.navigationDurationMs;
          result.headingDurationMs = error.measurements.headingDurationMs;
          result.settleDurationMs = error.measurements.settleDurationMs;
          result.totalNavigationThroughSettleDurationMs = error.measurements.totalNavigationThroughSettleDurationMs;
        }
        primaryFailure = {
          phase: error instanceof Error && "phase" in error ? error.phase as SetupPhase : "navigation",
          cause: error,
          cleanupErrors: [],
          runtimeFailures: [...runtimeFailures],
        };
      }
    }
  } catch (error) {
    primaryFailure = { phase: "configuration", cause: error, cleanupErrors: [], runtimeFailures: [...runtimeFailures] };
  }

  const cleanupErrors = await closeResources(page, context, browser);
  const finalRuntimeFailures = [...runtimeFailures];
  let postCleanupFailure: unknown;
  try {
    // Keep the collector alive through all resource teardown and assert it once
    // more so a late page error cannot turn a completed route into a green gate.
    assertHostColdStartRuntimeFailures(finalRuntimeFailures, "settle");
  } catch (error) {
    postCleanupFailure = error;
  }
  if (!primaryFailure && postCleanupFailure) {
    primaryFailure = {
      phase: "cleanup",
      cause: postCleanupFailure,
      cleanupErrors: [],
      runtimeFailures: finalRuntimeFailures,
    };
  }
  if (primaryFailure) primaryFailure = { ...primaryFailure, cleanupErrors, runtimeFailures: finalRuntimeFailures };
  else if (cleanupErrors.length > 0) {
    primaryFailure = {
      phase: "cleanup",
      cause: cleanupErrors[0],
      cleanupErrors,
      runtimeFailures: finalRuntimeFailures,
    };
  }

  result.runtimeFailures = finalRuntimeFailures;
  if (primaryFailure) {
    result.outcome = "failed";
    result.phase = primaryFailure.phase;
    result.error = serializeError(failureError(primaryFailure));
  } else {
    result.outcome = "passed";
  }

  let writeFailure: unknown;
  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } catch (error) {
    writeFailure = error;
  }
  if (writeFailure && !primaryFailure) {
    primaryFailure = {
      phase: "diagnostics",
      cause: writeFailure,
      cleanupErrors: [],
      runtimeFailures: finalRuntimeFailures,
    };
  }
  if (writeFailure) console.error(`[host cold-start] diagnostics unavailable at ${artifactPath}: ${serializeError(writeFailure).message}`);
  else console.log(`[host cold-start] ${result.outcome} ${artifactPath}`);

  if (primaryFailure) throw failureError(primaryFailure);
}
