// @ts-check
// Emitted graphs import the host's one zudo-react runtime; they never carry a copy.

/** The zudo-react subpaths a published browser graph may import, always external. */
export const ZUDO_REACT_EXTERNAL_ENTRIES = Object.freeze([
  "@takazudo/zfb/zudo-react",
  "@takazudo/zfb/zudo-react/jsx-runtime",
  "@takazudo/zfb/zudo-react/client",
]);

/**
 * Text only the runtime's own scheduler, reactive core and scope modules
 * contain (zfb 7.2.0 `dist/zudo-react/{scheduler,reactive,scope}.js`). A chunk
 * holding any of it inlined a private runtime copy, whose signals bind without
 * a diagnostic and never update.
 */
export const INLINED_RUNTIME_MARKER = /\bZR_(?:FLUSH_LIMIT|RUNTIME_DEFINITION|NO_SCOPE)\b/;

/** @param {string} id */
export function isZudoReactExternal(id) {
  return ZUDO_REACT_EXTERNAL_ENTRIES.includes(id);
}

/** @param {string} path @param {string} text */
export function assertNoInlinedRuntime(path, text) {
  const match = INLINED_RUNTIME_MARKER.exec(text);
  if (match) throw new Error(`${path}: emitted chunk inlines a zudo-react runtime copy (${match[0]}); keep @takazudo/zfb external.`);
}
