// Shared by the three browser-lane runners that seed a disposable Assets
// store from the committed sample bytes. Deliberately excludes the sample
// `site-project.json` path: `check-sample-project.mjs`'s importer allowlist
// keys on that literal string, and a shared re-export of it would trip.
export const SAMPLE_ASSETS_DIR = "packages/demo-sample/cms/assets";
