// Compile-time assertions for the config contract. Nothing here runs; the
// program is checked by `tsconfig.host-config.json`, and a regression shows up
// as a typecheck failure.

import { composer, defineComposerConfig, type ComposerConfig, type ComposerPaths, type ComposerSettings, type ResolvedComposerConfig } from "../index";

type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];

/** `never` unless every property of `T` is required — one optional field is enough to fail. */
type AllRequired<T> = [OptionalKeys<T>] extends [never] ? true : never;

// The all-required-fields rule, applied to every object type in the contract.
// A shallow merge over optional nested fields silently drops host settings, so
// a nested object must be impossible to supply partially.
const settingsAllRequired: AllRequired<ComposerSettings> = true;
const pathsAllRequired: AllRequired<ComposerPaths> = true;
const resolvedAllRequired: AllRequired<ResolvedComposerConfig> = true;
void settingsAllRequired;
void pathsAllRequired;
void resolvedAllRequired;

const resolved = composer({ pack: "my-site/components" });

// The resolved nested objects cannot be partially specified: assigning a subset
// to the nested type is a compile error, which is what keeps a host override
// from quietly dropping the settings it did not repeat.
// @ts-expect-error `settings` is all-required; a partial object is not one.
const partialSettings: ComposerSettings = { compositionsDir: "cms/compositions" };
void partialSettings;

// @ts-expect-error `paths` is all-required; a partial object is not one.
const partialPaths: ComposerPaths = { workspaceRoot: resolved.workspaceRoot };
void partialPaths;

// Overriding by spreading the resolved table stays complete.
const spread: ComposerSettings = { ...resolved.settings, contentDir: "cms/copy" };
void spread;

// `ComposerConfig` is what a host authors: `pack` required, the rest optional.
const authored: ComposerConfig = { pack: "my-site/components" };
void authored;

// `pack` is required in the host-authored config.
defineComposerConfig({ pack: "@acme/themeset/composer-pack" });
// @ts-expect-error `pack` has no default and must be declared by the host.
defineComposerConfig({ contentDir: "cms/content" });

// Unknown settings are rejected rather than silently ignored.
// @ts-expect-error `templatesDir` is not a setting — templates are compositions.
defineComposerConfig({ pack: "my-site/components", templatesDir: "templates" });
