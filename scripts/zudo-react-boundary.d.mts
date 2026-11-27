export declare const ZUDO_REACT_EXTERNAL_ENTRIES: readonly string[];

export declare const INLINED_RUNTIME_MARKER: RegExp;

export function isZudoReactExternal(id: string): boolean;

export function assertNoInlinedRuntime(path: string, text: string): void;
