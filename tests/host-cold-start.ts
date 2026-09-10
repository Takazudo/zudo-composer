/** The host route's end-to-end cold-start policy budget, including settlement. */
export const HOST_COLD_START_TIMEOUT_MS = 47_000;
export const HOST_COLD_START_ROUTE = "/content" as const;
export const HOST_COLD_START_GATE = "host-global-setup/content-v1" as const;

export type HostColdStartPhase = "navigation" | "heading" | "settle";
export type MonotonicClock = () => number;

export interface HostColdStartLocator {
  toBeVisible(options: { timeout: number }): Promise<void>;
  toHaveCount(count: number, options: { timeout: number }): Promise<void>;
}

/**
 * The smallest page surface the gate needs. Keeping this adapter independent
 * of Playwright's test package lets Vitest exercise the real deadline logic.
 */
export interface HostColdStartPage {
  goto(url: typeof HOST_COLD_START_ROUTE, options: { waitUntil: "load"; timeout: number }): Promise<unknown>;
  getByRole(role: "heading", options: { name: "All models"; exact: true }): HostColdStartLocator;
  locator(selector: string): HostColdStartLocator;
}

export type RuntimeFailures = readonly string[] | (() => readonly string[]);

export interface HostColdStartGateOptions {
  page: HostColdStartPage;
  now?: MonotonicClock;
  runtimeFailures?: RuntimeFailures;
  budgetMs?: number;
}

export interface HostColdStartMeasurements {
  navigationDurationMs: number | null;
  headingDurationMs: number | null;
  settleDurationMs: number | null;
  totalNavigationThroughSettleDurationMs: number | null;
}

/** A fatal gate error retains both the failed operation and page diagnostics. */
export class HostColdStartGateError extends Error {
  readonly phase: HostColdStartPhase;
  readonly runtimeFailures: readonly string[];
  readonly measurements: HostColdStartMeasurements;

  constructor(
    message: string,
    phase: HostColdStartPhase,
    options: {
      cause?: unknown;
      runtimeFailures?: readonly string[];
      measurements?: HostColdStartMeasurements;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HostColdStartGateError";
    this.phase = phase;
    this.runtimeFailures = [...(options.runtimeFailures ?? [])];
    this.measurements = options.measurements ?? {
      navigationDurationMs: null,
      headingDurationMs: null,
      settleDurationMs: null,
      totalNavigationThroughSettleDurationMs: null,
    };
  }
}

/** Runtime errors are checked at each readiness boundary, never ignored. */
export class HostColdStartRuntimeError extends Error {
  readonly phase: HostColdStartPhase;
  readonly runtimeFailures: readonly string[];

  constructor(phase: HostColdStartPhase, runtimeFailures: readonly string[]) {
    super(`Runtime failures observed during host cold-start ${phase}: ${runtimeFailures.join(" | ")}`);
    this.name = "HostColdStartRuntimeError";
    this.phase = phase;
    this.runtimeFailures = [...runtimeFailures];
  }
}

function snapshotRuntimeFailures(source: RuntimeFailures): string[] {
  return [...(typeof source === "function" ? source() : source)];
}

export function assertHostColdStartRuntimeFailures(
  source: RuntimeFailures,
  phase: HostColdStartPhase,
): void {
  const failures = snapshotRuntimeFailures(source);
  if (failures.length > 0) throw new HostColdStartRuntimeError(phase, failures);
}

function phaseFailure(
  phase: HostColdStartPhase,
  cause: unknown,
  runtimeFailures: RuntimeFailures,
  measurements: HostColdStartMeasurements,
): HostColdStartGateError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new HostColdStartGateError(`Host cold-start ${phase} failed: ${message}`, phase, {
    cause,
    runtimeFailures: snapshotRuntimeFailures(runtimeFailures),
    measurements,
  });
}

/**
 * Run the one host preflight with one absolute deadline. The adapter's
 * assertion methods are Playwright-backed in global setup and fake-backed in
 * the unit tests; no test-runner declarations belong in this module.
 */
export async function runHostColdStartGate({
  page,
  now = () => performance.now(),
  runtimeFailures = [],
  budgetMs = HOST_COLD_START_TIMEOUT_MS,
}: HostColdStartGateOptions): Promise<HostColdStartMeasurements> {
  const startedAt = now();
  const deadline = startedAt + budgetMs;
  const measurements: HostColdStartMeasurements = {
    navigationDurationMs: null,
    headingDurationMs: null,
    settleDurationMs: null,
    totalNavigationThroughSettleDurationMs: null,
  };

  const deadlineNow = (phase: HostColdStartPhase): number => {
    const current = now();
    const remaining = deadline - current;
    if (!(remaining > 0)) {
      throw new HostColdStartGateError(
        `Host cold-start ${phase} deadline exhausted before the phase began.`,
        phase,
        { runtimeFailures: snapshotRuntimeFailures(runtimeFailures), measurements },
      );
    }
    return current;
  };

  const remainingTimeout = (phase: HostColdStartPhase): number => deadline - deadlineNow(phase);

  const completedAt = (phase: HostColdStartPhase): number => deadlineNow(phase);

  try {
    const timeout = remainingTimeout("navigation");
    await page.goto(HOST_COLD_START_ROUTE, { waitUntil: "load", timeout });
    measurements.navigationDurationMs = completedAt("navigation") - startedAt;
  } catch (error) {
    if (error instanceof HostColdStartGateError) {
      throw new HostColdStartGateError(error.message, error.phase, {
        cause: error.cause,
        runtimeFailures: snapshotRuntimeFailures(runtimeFailures),
        measurements,
      });
    }
    throw phaseFailure("navigation", error, runtimeFailures, measurements);
  }

  const headingStartedAt = now();
  try {
    const timeout = remainingTimeout("heading");
    await page.getByRole("heading", { name: "All models", exact: true }).toBeVisible({ timeout });
    measurements.headingDurationMs = completedAt("heading") - headingStartedAt;
    assertHostColdStartRuntimeFailures(runtimeFailures, "heading");
  } catch (error) {
    if (error instanceof HostColdStartGateError) {
      throw new HostColdStartGateError(error.message, error.phase, {
        cause: error.cause,
        runtimeFailures: snapshotRuntimeFailures(runtimeFailures),
        measurements,
      });
    }
    throw phaseFailure("heading", error, runtimeFailures, measurements);
  }

  const settleStartedAt = now();
  try {
    const timeout = remainingTimeout("settle");
    await page.locator('.cms-shell-main [aria-busy="true"]').toHaveCount(0, { timeout });
    const settledAt = completedAt("settle");
    measurements.settleDurationMs = settledAt - settleStartedAt;
    measurements.totalNavigationThroughSettleDurationMs = settledAt - startedAt;
    assertHostColdStartRuntimeFailures(runtimeFailures, "settle");
  } catch (error) {
    if (error instanceof HostColdStartGateError) {
      throw new HostColdStartGateError(error.message, error.phase, {
        cause: error.cause,
        runtimeFailures: snapshotRuntimeFailures(runtimeFailures),
        measurements,
      });
    }
    throw phaseFailure("settle", error, runtimeFailures, measurements);
  }

  return measurements;
}
