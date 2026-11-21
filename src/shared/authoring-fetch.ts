/** Default filesystem transport hook, installed by the authoring shell only.
 * Domain stores stay independent of application UI and coordination state. */
let transport: typeof fetch | undefined;
let inFlight = 0;
const activityListeners = new Set<() => void>();
const changed = () => { for (const listener of activityListeners) listener(); };
export const authoringFetch: typeof fetch = async (input, init) => {
  inFlight++; changed();
  try { return await (transport ?? globalThis.fetch)(input, init); }
  finally { inFlight--; changed(); }
};
export function installAuthoringFetch(value: typeof fetch): () => void {
  transport = value;
  return () => { if (transport === value) transport = undefined; };
}
/** Requests currently in flight through `authoringFetch`; the shell's page-loading overlay waits on it. */
export function authoringRequestsInFlight(): number { return inFlight; }
export function subscribeAuthoringActivity(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => { activityListeners.delete(listener); };
}
