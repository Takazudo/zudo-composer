// The host config zudo-composer resolves at startup.
//
// `defineComposerConfig` comes from the package's `./config` subpath: an
// identity function whose only job is to type this object. Every path setting
// is left at its default; `pack` is the one setting with no default.
import { defineComposerConfig } from "zudo-composer/config";

export default defineComposerConfig({
  pack: "@zudo-sg/ui/composer-pack",
});
