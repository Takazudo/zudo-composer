import type { WorkspaceSaveRegistry, WorkspaceSaveFailure } from "./workspace-sessions";

export type WorkspaceToken = string | number;
export interface WorkspaceSnapshotSource<T = unknown> {
  id: string;
  token(): Promise<WorkspaceToken>;
  read(): Promise<{ mutationToken: WorkspaceToken; value: T }>;
}
export interface WorkspaceCapture {
  workspaceId: string;
  sessionGeneration: number;
  tokens: Readonly<Record<string, WorkspaceToken>>;
  values: Readonly<Record<string, unknown>>;
}
export type WorkspaceCaptureOutcome =
  | { status: "ready"; capture: WorkspaceCapture }
  | { status: "changed"; sources: readonly string[] }
  | { status: "unavailable"; source: string; error: Error }
  | { status: "save-failed"; failures: readonly WorkspaceSaveFailure[] };

/** Establishes a common read interval by checking persisted before/embedded/after tokens. */
export async function captureWorkspaceSnapshot(workspaceId: string, sessions: WorkspaceSaveRegistry, sources: readonly WorkspaceSnapshotSource[], maxAttempts = 3): Promise<WorkspaceCaptureOutcome> {
  let changed: string[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const flushed = await sessions.flush();
    if (flushed.status === "failed") return { status: "save-failed", failures: flushed.failures };
    if (flushed.status === "changed") return { status: "changed", sources: ["editor-sessions"] };
    const before: Record<string, WorkspaceToken> = {};
    const values: Record<string, unknown> = {};
    const embedded: Record<string, WorkspaceToken> = {};
    let current = "workspace";
    try {
      for (const source of sources) { current = source.id; before[source.id] = await source.token(); }
      for (const source of sources) { current = source.id; const snapshot = await source.read(); values[source.id] = snapshot.value; embedded[source.id] = snapshot.mutationToken; }
      changed = [];
      for (const source of sources) {
        current = source.id;
        const after = await source.token();
        if (before[source.id] !== embedded[source.id] || after !== embedded[source.id]) changed.push(source.id);
      }
      if (sessions.generation !== flushed.generation) changed.push("editor-sessions");
      if (!changed.length) return { status: "ready", capture: { workspaceId, sessionGeneration: flushed.generation, tokens: embedded, values } };
    } catch (cause) {
      return { status: "unavailable", source: current, error: cause instanceof Error ? cause : new Error("Snapshot read failed.", { cause }) };
    }
  }
  return { status: "changed", sources: changed };
}

export async function checkWorkspaceCapture(capture: WorkspaceCapture, workspaceId: string, sessions: WorkspaceSaveRegistry, sources: readonly WorkspaceSnapshotSource[]): Promise<boolean> {
  if (capture.workspaceId !== workspaceId || capture.sessionGeneration !== sessions.generation || sources.length !== Object.keys(capture.tokens).length) return false;
  for (const source of sources) if (await source.token() !== capture.tokens[source.id]) return false;
  return capture.sessionGeneration === sessions.generation;
}
