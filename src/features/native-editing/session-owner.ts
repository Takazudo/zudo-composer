export interface NativeBrowserOwner { clientId: string; epoch: number; capability: string }
const key = Symbol.for("zudo-composer.native-browser-owner.v1");
/** HMR preserves the revision owner. A new server capability requires reopening
 * records; its reset epoch zero must never authorize the old in-memory draft. */
export function nativeBrowserOwner(scope: { [key: symbol]: NativeBrowserOwner | undefined }, capability: string, id: () => string) {
  const owner = scope[key] ??= { clientId: id(), epoch: -1, capability };
  return { owner, changedServer: owner.capability !== capability };
}
