// The host self-reference shape: `pack` is this package's own exported subpath,
// so the components live in this tree and still satisfy the contract's
// public-bare-import rule. Every other setting keeps its default.
import { defineComposerConfig } from "zudo-composer/config";

export default defineComposerConfig({
  pack: "demo-webshop/components",
});
