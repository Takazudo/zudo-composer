// The host's base stylesheet is the only importer of pack CSS, so a host that
// has not written one is a configuration error, not a silently empty cascade.

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HOST_STYLES_ID, hostStylesPlugin } from "../host-styles-plugin.mjs";

const options = (stylesPath: string) => ({ stylesPath, styles: "styles/base.css", configPath: resolve("zudo-composer.config.ts") });

describe("virtual:zudo-composer-host-styles", () => {
  it("resolves to the host's real file so its @import and @source bases are the host's", () => {
    const stylesPath = resolve("styles/base.css");
    const plugin = hostStylesPlugin(options(stylesPath));
    expect((plugin.resolveId as (id: string) => string | undefined)(HOST_STYLES_ID)).toBe(stylesPath);
    expect((plugin.resolveId as (id: string) => string | undefined)("./other.css")).toBeUndefined();
    expect(() => (plugin.buildStart as () => void)()).not.toThrow();
  });

  it("fails loudly when the configured stylesheet does not exist", () => {
    const missing = resolve("styles/nope.css");
    const plugin = hostStylesPlugin({ ...options(missing), styles: "styles/nope.css" });
    expect(() => (plugin.buildStart as () => void)()).toThrow(
      `zudo-composer config: \`styles\` points at "styles/nope.css", which does not exist at ${missing}. It is the host's base stylesheet — the only importer of the component pack's CSS and the host's Tailwind \`@source\` point. Create it, or set \`styles\` in ${resolve("zudo-composer.config.ts")}.`,
    );
  });
});
