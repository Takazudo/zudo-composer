import { useState } from "preact/hooks";

// Preact's useId counts per render root and restarts from P0-0 when a component
// that re-renders itself passes host children through (Preact 10.29.8), so ids
// from it collide; this sequence is unique for the whole document.
let nextDomId = 0;

export function useDomId(): string {
  const [id] = useState(() => `cms-id-${++nextDomId}`);
  return id;
}
