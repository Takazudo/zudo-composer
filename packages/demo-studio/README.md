# Sample Studio

Sample Studio is a complete host project for `zudo-composer`. It uses the
installed `@zudo-sg/ui/composer-pack` themeset and its canonical stylesheet.
The compositions, two content models, four entries, two mappings and five
authored sitemap rows live in `site-project.ts`; longer copy lives in `content/`.

Run these commands from this directory:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm generate
corepack pnpm test
corepack pnpm seed
corepack pnpm dev
corepack pnpm build:site
```

The committed ready CMS opens the authoring libraries populated with Sample
Studio. `pnpm seed` activates a local website release in the ignored
`.zudo-site-project/` directory; it is needed for `/site` delivery.
Its image manifest is empty:
the sample uses the themeset's placeholder component and no uploaded images.
`build:site` emits the seven static routes from `/` into `dist-site` directly
from the generated project, without a local release.

Keep `site-project.json` and `cms/` generated. The repository's canonical CMS
regenerator discovers this host and owns its ready workspace alongside the
other demos. The fixed record IDs, timestamp and content preserve the original
Sample Studio JSON exactly; the package test records that original byte digest
without importing another host or a repository fixture.
