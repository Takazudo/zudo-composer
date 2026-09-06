// The one module a host's `zudo-composer.config.ts` imports.
//
// It is plain JavaScript, and it is the whole `zudo-composer/config` runtime,
// because a host config is evaluated in contexts where the rest of the package
// is not loadable: Node externalizes bare imports out of `node_modules` and
// then refuses to strip types, so a `.ts` entry here would fail. Being an
// identity function, there is nothing else for it to do.

/**
 * @template {object} T
 * @param {T} config
 * @returns {T}
 */
export function defineComposerConfig(config) {
  return config;
}
