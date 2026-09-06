// The host config zudo-composer resolves at startup.
//
// It is written as a plain typed object rather than through
// `defineComposerConfig` because zudo-composer does not publish an `exports`
// map yet — packaging is a later step. Every path setting is left at its
// default; `pack` is the one setting with no default.
interface HostComposerConfig {
  pack: string;
}

const config: HostComposerConfig = {
  pack: "@zudo-sg/ui/composer-pack",
};

export default config;
