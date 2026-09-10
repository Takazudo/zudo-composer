export const HOST_DOCUMENT_READY_TIMEOUT_MS = 47_000;
export type Deadline = { remainingMs: () => number };
export type DocumentReadyOptions<T> = {
  id: string;
  kind: "goto" | "reload" | "route-action";
  transition: (deadline: Deadline) => Promise<T>;
  ready: (deadline: Deadline) => Promise<unknown>;
  settle: "shell" | "none";
};
export type DocumentReady = <T>(options: DocumentReadyOptions<T>) => Promise<T>;
type Phase = "transition" | "ready" | "settle";
export type ReadinessRecord = {
  schemaVersion: 1; gate: "host-document-ready/v1"; id: string;
  kind: DocumentReadyOptions<unknown>["kind"]; ordinal: number;
  configuredBudgetMs: number; startUrl: string; endUrl: string;
  transitionMs: number | null; readyMs: number | null; settleMs: number | null;
  totalMs: number; outcome: "passed" | "failed";
  phase: Phase | null; error: string | null; runtimeFailures: string[];
};
export function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
export function runtimeError(failures: readonly string[]): Error | undefined {
  return failures.length ? new Error(`Host runtime failures: ${failures.join(" | ")}`) : undefined;
}
export type ReadinessDependencies = {
  now: () => number; url: () => string; failures: readonly string[];
  settleShell: (deadline: Deadline) => Promise<unknown>;
  record: (row: ReadinessRecord) => Promise<void>;
  report: (message: string) => void;
};
/** One controller per test. Each invocation receives a fresh, monotonic deadline. */
export function createDocumentReady(deps: ReadinessDependencies): DocumentReady {
  let ordinal = 0;
  return async <T>(options: DocumentReadyOptions<T>): Promise<T> => {
    const start = deps.now();
    const end = start + HOST_DOCUMENT_READY_TIMEOUT_MS;
    let phase: Phase = "transition";
    const deadline: Deadline = { remainingMs: () => {
      const remaining = end - deps.now();
      if (remaining <= 0) throw new Error(`Host document readiness deadline exhausted during ${phase}`);
      return remaining;
    } };
    const row: ReadinessRecord = {
      schemaVersion: 1, gate: "host-document-ready/v1", id: options.id, kind: options.kind,
      ordinal: ++ordinal, configuredBudgetMs: HOST_DOCUMENT_READY_TIMEOUT_MS,
      startUrl: deps.url(), endUrl: deps.url(), transitionMs: null, readyMs: null,
      settleMs: null, totalMs: 0, outcome: "failed", phase: null, error: null, runtimeFailures: [],
    };
    let failed = false;
    let failure: unknown;
    let result!: T;
    const run = async <R>(name: Phase, operation: (d: Deadline) => Promise<R>): Promise<R> => {
      phase = name;
      deadline.remainingMs();
      const began = deps.now();
      const result = await operation(deadline);
      // A callback that returns after the boundary is not a completed phase.
      deadline.remainingMs();
      row[`${name}Ms`] = deps.now() - began;
      const runtime = runtimeError(deps.failures);
      if (runtime) throw runtime;
      return result;
    };
    try {
      result = await run("transition", options.transition);
      await run("ready", options.ready);
      if (options.settle === "shell") await run("settle", deps.settleShell);
      row.outcome = "passed";
    } catch (error) {
      failed = true;
      row.phase = phase;
      row.error = errorText(error);
      failure = error;
    } finally {
      row.endUrl = deps.url();
      row.totalMs = deps.now() - start;
      row.runtimeFailures = [...deps.failures];
      if (failed) deps.report(`${options.id} #${row.ordinal} failed during ${phase}: ${row.error}`);
      try { await deps.record(row); }
      catch (error) {
        deps.report(`Artifact failure for ${options.id}: ${errorText(error)}`);
        if (!failed) { failed = true; failure = error; }
      }
    }
    if (failed) throw failure;
    return result;
  };
}

/** Finalize after the body and dependent fixture cleanup without masking its error. */
export async function finishReadiness(options: {
  failures: readonly string[]; hasPrimaryError: () => boolean;
  persist: () => Promise<void>; attach: () => Promise<void>; report: (message: string) => void;
}): Promise<void> {
  let artifactError: unknown;
  let artifactFailed = false;
  try { await options.persist(); }
  catch (error) { artifactFailed = true; artifactError = error; options.report(`Artifact write failure: ${errorText(error)}`); }
  finally {
    try { await options.attach(); }
    catch (error) { artifactFailed = true; artifactError ??= error; options.report(`Artifact attachment failure: ${errorText(error)}`); }
  }
  const runtime = runtimeError(options.failures);
  if (runtime) options.report(runtime.message);
  if (!options.hasPrimaryError()) {
    if (runtime) throw runtime;
    if (artifactFailed) throw artifactError;
  }
}
