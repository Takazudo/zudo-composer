// A host-owned component pack.
//
// `pack` and every `source.module` are `"self-host/components"` — the host
// package's own name plus an exported subpath. Node resolves package
// self-references whenever `exports` is present, and Vite's resolver has the
// same branch, so nothing has to be installed. Two constraints fall out of the
// contract's `parseSource`: the host `name` must be a valid lowercase npm name,
// and no exported subpath segment may be `src`.
import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { Banner, type BannerProps } from "./components";

const bannerComposer = defineComponent<BannerProps>()(Banner, {
  id: "self.banner",
  schemaVersion: 1,
  title: "Banner",
  category: "Content",
  description: "The host's own headline component.",
  source: { module: "self-host/components", exportKind: "named", exportName: "Banner" },
  defaults: { headline: "Banner" },
  fields: [{ prop: "headline", label: "Headline", schema: { type: "string" }, editor: { kind: "text" } }],
});

export const componentPack = defineComponentPack({
  packId: "self-host",
  packVersion: "1.0.0",
  components: [bannerComposer],
});

export { Banner };
export type { BannerProps };
