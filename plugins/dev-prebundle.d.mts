export declare const PREACT_DEV_ENTRIES: readonly string[];

export declare function componentPackNestedIncludes(options: {
  workspaceRoot: string;
  pack: string;
  exclude?: readonly string[];
}): string[];

export declare function devPrebundleIncludes(options: {
  workspaceRoot: string;
  pack: string;
  exclude?: readonly string[];
}): string[];
