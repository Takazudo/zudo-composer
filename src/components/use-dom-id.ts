// A document-wide id sequence. zudo-react has no `useId`, and every overlay
// layer is a separate root, so ids come from one module counter that is unique
// for the whole document; call it once in a component's setup.
let nextDomId = 0;

export function createDomId(): string {
  return `cms-id-${++nextDomId}`;
}
