/** Synchronous application-lifetime exclusion for workspace replacement and release work. */
export function createApplicationOperationGate() {
  let owner: symbol | null = null, kind: "replacement" | "release" | null = null, disposed = false;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) { try { listener(); } catch { /* Observers cannot release or interrupt the owner. */ } } };
  return {
    get busy() { return disposed || owner !== null; },
    get kind() { return kind; },
    get disposed() { return disposed; },
    claim(next: "replacement" | "release") { if (disposed || owner) return null; const token = Symbol(next); owner = token; kind = next; emit(); return () => { if (owner !== token) return; owner = null; kind = null; emit(); }; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; emit(); listeners.clear(); },
  };
}
export type ApplicationOperationGate = ReturnType<typeof createApplicationOperationGate>;
