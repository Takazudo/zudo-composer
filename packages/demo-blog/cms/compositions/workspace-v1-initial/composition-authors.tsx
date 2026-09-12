import LinkedTemplate from "./composition-site-frame";

import { AuthorGrid, PageHeading, Section } from "demo-blog/components";

function LocalCompositionContent() {
  return (
    <>
      <PageHeading eyebrow="" heading="Authors" intro="Margin Notes has two writers. Each essay is signed." />
      <Section rule={false} content={<AuthorGrid />} />
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
