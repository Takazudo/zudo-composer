import LinkedTemplate from "./composition-site-frame";

import { Callout, PageHeading, ProseBody } from "demo-blog/components";

function LocalCompositionContent() {
  return (
    <>
      <PageHeading eyebrow="About" />
      <ProseBody dropCap={false} />
      <Callout title="About this site" markdown="Margin Notes is a demo site built with [zudo-composer](https://zudo-composer.zudolab.dev). The essays are real; the comments, forms and newsletter are mocks that keep nothing." tone="soft" />
    </>
  );
}

export default function Composition() {
  return (
    <LinkedTemplate
      outlets={{
        "site-frame-outlet": <LocalCompositionContent />,
      }}
    />
  );
}
