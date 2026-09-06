export interface WorkspaceSaveHandle {
  flush(): Promise<void>;
  retry?(): void;
}
export interface WorkspaceSessionIdentity { feature: string; providerId: string; recordId?: string; workspaceId?: string }
export interface WorkspaceSaveFailure extends WorkspaceSessionIdentity { error: Error }
export type WorkspaceFlushOutcome = { status: "ready"; generation: number } | { status: "failed"; failures: readonly WorkspaceSaveFailure[] } | { status: "changed" };

/** Application lifetime owner. Unmount detaches presentation, never an outstanding save. */
export function createWorkspaceSaveRegistry() {
  let generation = 0;
  const listeners = new Set<() => void>();
  const sessions = new Map<symbol, { identity: WorkspaceSessionIdentity; handle: WorkspaceSaveHandle; detached: boolean; revision: number; saved: number; pending?: Promise<WorkspaceSaveFailure | undefined>; error?: Error }>();
  const emit = () => { for (const listener of listeners) { try { listener(); } catch { /* Observers cannot interrupt saving. */ } } };
  const changed = () => { generation++; emit(); };
  const settle = async (key: symbol): Promise<WorkspaceSaveFailure | undefined> => {
    const session = sessions.get(key);
    if (!session) return;
    if (session.pending) return session.pending;
    session.pending = (async () => {
      try {
        do { const revision = session.revision; await session.handle.flush(); session.saved = revision; } while (session.saved !== session.revision);
        delete session.error;
        if (session.detached) sessions.delete(key);
      } catch (cause) { session.error = cause instanceof Error ? cause : new Error("Save failed.", { cause }); return { ...session.identity, error: session.error }; }
      finally { session.pending = undefined; emit(); }
    })();
    return session.pending;
  };
  return {
    get generation() { return generation; },
    get hasPending() { return [...sessions.values()].some((session) => session.saved !== session.revision || !!session.pending || !!session.error); },
    get failures(): readonly WorkspaceSaveFailure[] { return [...sessions.values()].flatMap((session) => session.error ? [{ ...session.identity, error: session.error }] : []); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    register(identity: WorkspaceSessionIdentity, handle: WorkspaceSaveHandle) {
      const key = Symbol(identity.feature);
      sessions.set(key, { identity: { ...identity }, handle, detached: false, revision: 0, saved: 0 });
      emit();
      return {
        /** Call when an editor accepts a draft, before its debounce/write begins. */
        changed() { const session = sessions.get(key); if (!session) return; session.revision++; changed(); },
        retry() { handle.retry?.(); changed(); void settle(key); },
        detach() {
          const session = sessions.get(key);
          if (!session || session.detached) return;
          session.detached = true;
          // Keep the handle and failure until a successful flush, even after route unmount.
          void settle(key).then(emit);
        },
      };
    },
    async flush(maxAttempts = 3): Promise<WorkspaceFlushOutcome> {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const before = generation;
        const failures = (await Promise.all([...sessions.keys()].map(settle))).filter((failure): failure is WorkspaceSaveFailure => failure !== undefined);
        if (failures.length) return { status: "failed", failures };
        if (before === generation) return { status: "ready", generation };
      }
      return { status: "changed" };
    },
  };
}
export type WorkspaceSaveRegistry = ReturnType<typeof createWorkspaceSaveRegistry>;
