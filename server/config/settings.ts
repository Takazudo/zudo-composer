// The host-facing settings table.
//
// A host project installs zudo-composer, writes one `zudo-composer.config.ts`
// at its root, and keeps everything else — components, templates and CMS data —
// in its own tree. Those three words split in a way that is not obvious, and
// the split is what this table encodes:
//
//   components  code. Either host-owned source (`components/pack.ts`, reached
//               through the host's own `exports` self-reference) or an
//               installed themeset package. Registered through `pack`, which
//               is always a module specifier and never a path.
//   templates   data, not code. A template is a Composer composition whose
//               `publication.kind` is `"global-template"` and which carries a
//               `GlobalTemplateOutlet`. It is stored under `compositionsDir`
//               like every other composition. There is no templates directory
//               and no template file format.
//   data        the four JSON domains (compositions, content, mappings,
//               sitemaps) plus assets, all under `dataDir`.

/**
 * Every setting a host may declare. Path settings are relative to the host
 * project root; `pack` is a module specifier.
 *
 * All fields are required. A resolved config always carries the complete table,
 * which is what makes the shallow top-level merge in `composer()` safe: a
 * supplied object replaces the default wholesale rather than leaving holes.
 */
export interface ComposerSettings {
  /**
   * Root for the CMS data domains. Changing it re-bases every domain directory
   * below that has not been set explicitly, so a host can move all CMS data
   * with one setting.
   *
   * @default "cms"
   */
  dataDir: string;
  /**
   * Composition JSON, including global templates.
   *
   * @default "cms/compositions"
   */
  compositionsDir: string;
  /**
   * Content-domain JSON.
   *
   * @default "cms/content"
   */
  contentDir: string;
  /**
   * Mapping-domain JSON.
   *
   * @default "cms/mappings"
   */
  mappingsDir: string;
  /**
   * Sitemapper-domain JSON.
   *
   * @default "cms/sitemaps"
   */
  sitemapsDir: string;
  /**
   * Assets content-addressed store: `catalog.json` plus `versions/`.
   *
   * @default "cms/assets"
   */
  assetsDir: string;
  /**
   * Published assets bytes the host commits and serves. Not re-based by
   * `dataDir` — it lives under the host's public directory, not its CMS data.
   *
   * @default "public/uploaded-assets"
   */
  publicAssetsDir: string;
  /**
   * The host's base CSS entry. It is the sole importer of the component pack's
   * CSS and the host's Tailwind `@source` declaration point.
   *
   * @default "styles/base.css"
   */
  styles: string;
  /**
   * Component-pack module specifier — a themeset package
   * (`"@acme/themeset/composer-pack"`) or a host self-reference
   * (`"my-site/components"`, backed by the host's own `exports` map).
   *
   * Required, with no default. zudo-composer never falls back to a bundled
   * provider pack.
   */
  pack: string;
}

/** The settings that carry a default. `pack` is required and has none. */
export type ComposerSettingDefaults = Omit<ComposerSettings, "pack">;

/**
 * The complete default table. Defaults are documented, with `@default` tags, on
 * the matching `ComposerSettings` fields — kept in one place so the prose and
 * the values cannot drift.
 */
export const DEFAULT_SETTINGS: Readonly<ComposerSettingDefaults> = Object.freeze({
  dataDir: "cms",
  compositionsDir: "cms/compositions",
  contentDir: "cms/content",
  mappingsDir: "cms/mappings",
  sitemapsDir: "cms/sitemaps",
  assetsDir: "cms/assets",
  publicAssetsDir: "public/uploaded-assets",
  styles: "styles/base.css",
});

/**
 * The domain directories that live beneath `dataDir`, and the segment each one
 * appends. `publicAssetsDir` and `styles` are deliberately absent: they are not
 * CMS data.
 */
export const DATA_DOMAIN_SEGMENTS: Readonly<Record<keyof ComposerSettings & `${string}Dir`, string | undefined>> = Object.freeze({
  dataDir: undefined,
  compositionsDir: "compositions",
  contentDir: "content",
  mappingsDir: "mappings",
  sitemapsDir: "sitemaps",
  assetsDir: "assets",
  publicAssetsDir: undefined,
});

/**
 * Per-setting environment override. Uniform by construction —
 * `ZUDO_COMPOSER_` plus the setting name in screaming snake case — so a reader
 * can derive the variable for any setting without consulting a table.
 *
 * Precedence is explicit config > environment override > default. Values follow
 * the same rules as the settings themselves: host-root-relative paths, and a
 * module specifier for `pack`. These are distinct from the absolute-root
 * variables the Vite plugins read (`ZUDO_COMPOSITIONS_ROOT`,
 * `ZUDO_ASSETS_STORE_ROOT`), which address a different layer.
 */
export const SETTING_ENVIRONMENT_KEYS: Readonly<Record<keyof ComposerSettings, string>> = Object.freeze({
  dataDir: "ZUDO_COMPOSER_DATA_DIR",
  compositionsDir: "ZUDO_COMPOSER_COMPOSITIONS_DIR",
  contentDir: "ZUDO_COMPOSER_CONTENT_DIR",
  mappingsDir: "ZUDO_COMPOSER_MAPPINGS_DIR",
  sitemapsDir: "ZUDO_COMPOSER_SITEMAPS_DIR",
  assetsDir: "ZUDO_COMPOSER_ASSETS_DIR",
  publicAssetsDir: "ZUDO_COMPOSER_PUBLIC_ASSETS_DIR",
  styles: "ZUDO_COMPOSER_STYLES",
  pack: "ZUDO_COMPOSER_PACK",
});

export const SETTING_KEYS: readonly (keyof ComposerSettings)[] = Object.freeze(
  Object.keys(SETTING_ENVIRONMENT_KEYS) as (keyof ComposerSettings)[],
);
