# Catalog & editorial example

This optional, invented **Fieldwork Catalog** is a second SiteProject, not the
bundled Sample Studio deployment. It uses the installed component catalog and
normal Content, Mapping, Composer, Sitemap, Media and Review editors. There is
no checkout, hosted authoring API, custom image processing or model-specific UI.
Shop/support destinations use reserved `.test` domains; they are illustrative
external links, not live stores or promises of service.

## Create safely

1. Open the authoring dashboard `/`. Expand **Inspect detached example JSON
   (no writes)** to inspect the portable current-schema template. This works
   without local Media authoring. Its optional Media values are absent, not fake
   asset references.
2. In local development with the Media upload provider available, choose
   **Create catalog & editorial example**. The confirmation explains the exact
   effects: save existing edits, import/reuse one global Media asset, create a
   separate project, and switch to it. **Cancel** changes nothing. The button is
   unavailable while another release/replacement operation holds the app gate.
3. Confirm explicitly. The loader validates the template before any write,
   verifies the checked-in 321-byte PDF's SHA-256, uploads through the existing
   Media transport only if no active matching asset exists, verifies its exact
   version, binds the returned provider/asset identity, and validates again.
   It captures the active record revision, current version/checksum, exact pin
   and provider mutation token. The current `workspace.loadExample` service
   seeds and validates all four provider snapshots, then invokes `beforeComplete`
   to recheck that exact Media state immediately before selecting the project.
   Changed/trash/missing Media at that check rejects selection. A post-return
   recheck reports any subsequent drift as **Created workspace: Media changed**,
   not as a failed creation or a promise of permanent pinning. This does not
   apply, build or activate a release.

The final Media read is this optional authoring operation's pre-selection
validation boundary, not a cross-domain filesystem/IndexedDB lock. Media may
change during/after the ensuing selection transaction; the post-return check
then exposes that drift without falsely reporting an uncommitted workspace.
Release review, not example loading, is the exact immutable pin boundary.

This is **not destructive replacement**. Existing workspace databases and the
activated visitor build remain intact. After creation the dashboard shows the
prior workspace ID and a **Return to previous workspace** button for this app
session. Record that ID before reloading if you need it later; persistent
workspace listing is not added by this example. The existing workspace selection
service can reopen a known ID. This example introduces no delete, overwrite or purge action.
There is no automatic loading on startup or navigation.

Creation uses `example-catalog-editorial-v1` as its stable retry identity,
independent of mutable Media assets and project revision. Failed
seeding marks cleanup pending before deleting only that unselected attempt's
four scoped IndexedDB databases. Once all deletions complete, its seeding
metadata is removed. A blocked or uncertain deletion keeps that exact seed
identity and source; retries finish the queued deletions before idempotently
reseeding from the CURRENT requested, validated project/revision and Media guard.
An old cleanup-pending seed is returned solely to finish deletion, never to
reseed stale Media references. They cannot mint another example workspace or let a
late delete remove freshly reseeded data. Close blocking connections and retry
the same example. A ready workspace is never deleted, cleared or overwritten;
attempting to create an already completed identity reports its ID for explicit
opening instead. Other generic creation callers reuse matching unfinished seeds.

A persisted guard marker prevents a crash-interrupted example seed from being
selected through ordinary workspace opening or low-level completion without
repeating its original before-complete validation.

Media is global, not part of the four project provider snapshots. The one asset
is the repository's intentionally blank `deployment-sample.pdf`: it demonstrates
real byte/version integrity and per-use link labels, not a product photograph,
logo or useful support manual. Three Product uses and one Site settings use
share its identity but have different labels. If Media import succeeds and
later workspace creation fails, the asset remains in the library; retry verifies
and reuses it. It is never silently purged. Failed *workspace seed* databases are
separately eligible for the guarded cleanup above. Corrupt bytes, unavailable Media or
failed validation block creation without changing the selected workspace. A
cross-tab uncertain Media commit must settle through the Media provider's normal
recovery before creation can succeed.

Production/static inspection does not pretend to provide an upload or release
API. Full creation is disabled there. No committed deployment fixture or active
release is replaced by this optional example.

## Walkthrough: canonical data to output

1. **Content → Models**: inspect Products, Guides, News, Support resources,
   Series and the Site settings singleton. Open Raw fields, Grouped fields and
   Writing task views. These views address the same field IDs and entry values;
   they are not copies. Models combine Markdown, summary, date, slug, URL,
   provider-qualified references/reference-lists and per-use Media links.
2. **Products → Quiet Timer**: inspect its description, external shop URL,
   related Guides/Support and Series. Follow the canonical relations. Open
   **Series → Field notes**: its ordered Products are Quiet Timer, Atlas Notebook,
   River Lamp. **Everyday tools** orders River Lamp before Quiet Timer. Reordering
   this field changes its owning canonical relation, not copies of Product data.
   Inverse views are derived from named owning fields.
3. **Media**: locate `catalog-editorial-blank-sample.pdf` (or the existing matching
   asset reused by checksum). Inspect its immutable version and Used-by locations.
   Compare the Product labels with the singleton Site download label. The Media
   asset name and each use's label are separate values.
4. **Mapping**: open Product detail mapping, Guide detail mapping and Latest News
   collection attachment. Product title/summary/Markdown/shop URL are evaluated
   into real installed components. The Guide's related Product is a `route-link`
   projection, not an invented URL. Latest News uses published-only eligibility,
   descending date order and a limit of two; expected titles are **Field notes
   from a quieter launch**, then **Small routines, durable tools**. Collection
   query/pin order is explicit Mapping configuration, separate from Series order.
5. **Composer**: inspect Catalog site frame, Catalog home, Product detail and
   Latest news card. The home stack's attachment uses the collection Mapping;
   repeated cards are derived output, not manually copied nodes. Global-template
   binding uses the named `main-content` outlet. The Series page describes the
   canonical ordered list for editorial inspection; it does not claim a live
   relation-list component that the installed pack does not provide.
6. **Sitemap**: open Fieldwork Catalog sitemap. Expand Catalog → Products → Guides
   and Support. These are bounded nested route families with provider-qualified
   ancestor contexts (all eligible child entries per parent, not an implicit
   relation filter). For example the Quiet Timer guide route is
   `/catalog/products/quiet-timer/guides/starting-with-one-interval`. Its mapped
   related-product link is `/catalog/products/quiet-timer`. Primary navigation is
   Home/Catalog/Journal/Support; Footer independently contains Series/External
   shop/Support resources, with separate stable menu IDs.
7. **Working preview**: use the existing draft-preview links. The News route
   Mapping explicitly includes drafts for authoring preview; the latest-news
   attachment stays published-only. Inspect the draft **Supply notes for the next
   season** at `/journal/stories/supply-notes-for-the-next-season`. Its dependencies
   include two Guides, two Support resources and Atlas Notebook.
8. **Review**: on the first release of this new project there is no activated
   Content baseline. Select all intended published entries and their transitive
   dependencies; do not assume the fixture's `published` labels have activated
   anything. Selecting only the draft initially correctly produces missing-
   dependency Checks. Apply/build/activate the complete initial set using the
   normal explicit approvals. Then select only the draft over that baseline:
   Changes contains its publication, Checks validate the retained dependencies
   and exact PDF lock, and Affected contains the new evaluated News route and
   immutable Media dependency. The automated test also exercises this baseline
   directly without changing a local release store.
9. **Visitor**: release policy excludes the draft until its selected publication
   has been built and activated. Use **Activated website**, not Working preview,
   to inspect the completed build's cards, menus, product shop link and routes.
   Editing a newer draft after staging does not change the staged candidate or
   activated visitor. External `.test` shop links are inspectable URLs only.

## Reproducible focused verification

From the repository root after frozen dependency installation:

```sh
corepack pnpm exec vitest run src/site-project/sample/__tests__ src/app/__tests__/catalog-example-panel.test.tsx src/app/__tests__/app-workspace.test.tsx --maxWorkers=2
corepack pnpm exec tsc -b --pretty false
node scripts/check-headless-boundary.mjs
```

Tests use temporary filesystem Media roots and isolated fake IndexedDB factories;
they do not mutate the real Media catalog or selected browser workspace. They
check current-schema validation, actual mapped/repeated output, relation order,
external URLs, nested ancestors, draft policy, exact Media lock, selected-draft
dependency checks, cancel/unavailable/corrupt input, preserved prior workspace,
and deduplicated retry after an additive import, Media replace/trash immediately
before selection, blocked cleanup followed by same-ID retry, and truthful
post-selection Media drift. The manager owns the complete
interactive browser walkthrough and production artifact checks.
