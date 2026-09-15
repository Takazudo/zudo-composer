export function resolveComposerModules(): {
  dedupe: string[];
  alias: { find: RegExp; replacement: string }[];
};
