// Vitest's stand-in for `virtual:zudo-composer-pack`.
//
// Unit tests have no host config and no Vite plugin, so they pin the dogfood
// host's pack directly. This file and the specs are the ONLY places the
// provider package name may still appear in `src`.
export { componentPack } from "@zudo-sg/ui/composer-pack";
