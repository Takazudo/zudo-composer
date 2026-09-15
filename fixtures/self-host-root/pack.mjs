// A host-owned component pack whose module lives at the package root, not in
// a subdirectory. Component metadata is written by hand rather than through
// `defineComponentPack`/`defineComponent` so this fixture stays plain
// JavaScript — no `@zudo-composer/component-contract` resolution needed — and
// so a disposable temp copy can be built without extra installed packages.
import { Banner } from "./lib/banner.mjs";
import "./lib/banner.css";

export const componentPack = {
  manifest: {
    kind: "zudo-composer/component-pack",
    contractVersion: 2,
    packId: "self-host-root",
    packVersion: "1.0.0",
    components: [
      {
        id: "self-host-root.banner",
        schemaVersion: 1,
        title: "Banner",
        category: "Content",
        description: "The host's own root-level banner component.",
        source: { module: "self-host-root/pack", exportKind: "named", exportName: "Banner" },
        defaults: { headline: "Banner" },
        fields: [{ prop: "headline", label: "Headline", schema: { type: "string" }, editor: { kind: "text" } }],
        slots: [],
      },
    ],
  },
};

export { Banner };
