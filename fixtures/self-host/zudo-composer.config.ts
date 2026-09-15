// The host self-reference shape. `pack` is this package's own exported subpath,
// so the components live in the host tree and still satisfy the contract's
// public-bare-import rule.
//
// This fixture is deliberately NOT a workspace package, because a
// self-referencing pack must be proven to need nothing installed. The loader
// accepts the same plain config object returned by `defineComposerConfig`.
export default {
  pack: "self-host/components",
};
