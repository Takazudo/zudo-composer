export declare const ZUDO_REACT_JSX_IMPORT_SOURCE: "@takazudo/zfb/zudo-react";

export declare const ZUDO_REACT_PACKAGE: "@takazudo/zfb";

export function zudoReactOxc(importSource?: string): {
  jsx: { runtime: "automatic"; importSource: string };
};

export function resolveComposerModules(): {
  dedupe: string[];
  alias: { find: RegExp; replacement: string }[];
};

export function zudoReactSsr(): { external: string[] };
