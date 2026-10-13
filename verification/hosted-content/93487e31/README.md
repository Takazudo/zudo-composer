# Partial hosted consumer verification

Exact installed Composer SHA: `93487e318c04f1e8487f14ff86a4d72a67986b1b`. Contract package-root SHA: `c0b452da075b66757c60bd0d721a47062d4354d0`, protocol 2.

Command: `node scripts/verify-hosted-consumer.mjs 93487e318c04f1e8487f14ff86a4d72a67986b1b /workspace/work/hosted-consumer-93487e31 --no-browser`, under the personal heavy guard, Node 24.19.0 and pnpm 11.5.2. Fresh independent install and frozen reinstall both passed Worker, public Node/CLI/declaration checks, disk/process SQLite proofs, actual ZFB and registered zudo-sg static rendering, and four A/B publication render cycles with 63 publication assertions. Installed complete payload hashes matched across reinstall.

This is incomplete verification. P4 real browser/renderer acknowledgement has not run because Chromium revision 1234 downloads return HTTP 403 Domain forbidden. Broad editor extraction, subsequent final exact-SHA proof, browser and aggregate gates, final review and PR delivery remain outstanding. D1 and live publication/deployment are not tested. Issue #903 stays open.

Both installed and packed inventories hash every delivered file, including package metadata, exports, dependencies, README/LICENSE, source, generated chunks, declarations and CSS. Installed inventory excludes only installer-owned root node_modules links. Packed and Git-installed package.json differ through pnpm packaging (packageManager removal, dependency ordering and workspace dev-dependency expansion); each inventory records its raw bytes separately. No installed-versus-packed equivalence is claimed. Evidence paths are excluded by the package files allowlist.

`payload-equivalence.json` compares the complete packed payload before and after excluded evidence addition. All files match byte-for-byte except package.json object key ordering emitted nondeterministically by pnpm workspace enumeration. That comparison retains every JSON key/value and normalizes object key ordering/whitespace only; it does not claim byte-identical package.json or that the evidence commit was installed.
