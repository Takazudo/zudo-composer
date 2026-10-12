// @ts-check
// The public entry tables, shared by the build and its scans. Kept apart from
// scripts/build-public-entries.mjs so importing them never runs a build.
export const PUBLIC_ENTRIES = {
  /** Node runtime entries: Vite SSR build targeting Node. */
  entries: { authoring: "server/public/authoring.mts", "site-build": "server/public/site-build.mts" },
  /**
   * Declaration-only inputs serve type-only subpaths or existing runtime
   * entries; neither needs a generated JavaScript stub.
   */
  declarationEntries: {
    authoring: "server/public/authoring.mts",
    "site-build": "server/public/site-build.mts",
    editing: "server/public/editing.mts",
    "site-project": "server/public/site-project.mts",
    vite: "server/public/vite.mts",
    "config-public": "server/public/config.mts",
  },
  /**
   * Platform-neutral entries: built without a Node target, Node externals or
   * Node/DOM type libraries, so a browser or Worker can import them. Their
   * emitted graph is proven by scripts/check-portable-entries.mjs.
   */
  portableEntries: {
    content: "server/public/content.mts",
    "host-storage": "server/public/host-storage.mts",
    "preview-protocol": "server/public/preview-protocol.mts",
    export: "server/public/export.mts",
  },
};
