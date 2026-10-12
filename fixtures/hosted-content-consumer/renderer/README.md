This is an independent host renderer, outside Composer's package/workspace graph.
The consumer runner supplies its package identities, exact lock and durable
`src/snapshot.json`; it copies this directory into a fresh host directory.
No renderer source imports the Composer checkout or a sibling host project.

`src/project.ts` is the host's pure saved-snapshot projection. Its approved
route, linked layout, outlet, component and field mapping are authored once.
The service receives `projectHostedContent` as its `project` option, so a Worker
can prepare each new saved snapshot without compiling source. The page mapping
reads `content-filesystem/page/home`; the Content-owned `questions` reference
list determines FAQ membership/order. Newly created draft FAQ Entries appear
without a publication-only filter. Images resolve only through the supplied
approved version/checksum catalog.

`src/OfferPage.tsx` owns the actual zudo-react component and approved layout.
The ZFB visitor route, real `@takazudo/zudo-sg` story/registry route and isolated
preview iframe all import this exact module and consume the same immutable
snapshot projection. The styleguide fixture is a host-owned catalog route
using the engine's public registry and `Story` contract. It does not exercise
the optional full zudo-doc catalog chrome.

The preview uses Composer's public `zudo-composer/hosted-content/preview` guarded document receiver. This separate entry keeps Preact/editor code out of the visitor graph. Its render
callback mounts zudo-react, checks the fixed route and waits for approved image
decoding before the receiver acknowledges that exact snapshot. The parent review
fixture uses the public controller and displays its rendered state plus snapshot
ID/digest. Visitor CSS is host owned and the editor is a separate graph/document.

From the generated renderer host directory:

```sh
node scripts/build-preview.mjs
pnpm exec zfb build
node scripts/verify-static.mjs
node scripts/verify-browser.mjs http://127.0.0.1:PORT
```

Build/browser commands must run through the environment's heavy guard. Serve the
built `dist` directory for the browser proof. The browser must already be
installed; this fixture never downloads a browser or uses a live publication
provider. The static check executes actual emitted HTML assertions; the browser
check additionally disables JavaScript on the visitor and verifies decoded image
pixels, real SG story parity and the exact rendered iframe acknowledgement.
