/** Default filesystem transport hook, installed by the authoring shell only.
 * Domain stores stay independent of application UI and coordination state. */
let transport: typeof fetch | undefined;
export const authoringFetch: typeof fetch = (input, init) => (transport ?? globalThis.fetch)(input, init);
export function installAuthoringFetch(value: typeof fetch): () => void {
  transport = value;
  return () => { if (transport === value) transport = undefined; };
}
