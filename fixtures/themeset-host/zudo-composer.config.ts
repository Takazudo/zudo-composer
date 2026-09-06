// The themeset swap, in full.
//
// This host differs from `fixtures/host` in exactly two places: the `pack`
// specifier below, and the `@import` in `styles/base.css`. No tool source, no
// contract version and no build wiring changes — which is the claim this
// fixture exists to make checkable.
import { defineComposerConfig } from "zudo-composer/config";

export default defineComposerConfig({
  pack: "@zudo-composer/fixture-themeset/composer-pack",
});
