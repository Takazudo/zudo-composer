// The two host-owned seams, as modules TypeScript can see.
//
// `virtual:zudo-composer-pack` is filled by `plugins/component-pack-plugin.mjs`
// from the host's configured `pack`; `virtual:zudo-composer-host-styles`
// resolves to the host's configured base stylesheet. Neither has a file in this
// package, which is exactly why they are the swap point.

declare module "virtual:zudo-composer-pack" {
  export const componentPack: import("@zudo-composer/component-contract").TrustedComponentPack;
}

declare module "virtual:zudo-composer-host-styles";
