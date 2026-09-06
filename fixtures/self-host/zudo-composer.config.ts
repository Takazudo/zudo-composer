// The host self-reference shape. `pack` is this package's own exported subpath,
// so the components live in the host tree and still satisfy the contract's
// public-bare-import rule.
//
// It reaches `defineComposerConfig` relatively rather than through
// `zudo-composer/config`: this fixture is deliberately NOT a workspace package,
// because a self-referencing pack must be proven to need nothing installed.
import { defineComposerConfig } from "../../server/config/define.mjs";

export default defineComposerConfig({
  pack: "self-host/components",
});
