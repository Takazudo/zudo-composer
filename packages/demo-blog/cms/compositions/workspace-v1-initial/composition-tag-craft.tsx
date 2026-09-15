import LinkedTemplate from "./composition-site-frame";

import { ArticleList, PageHeading } from "demo-blog/components";

function LocalCompositionContent() {
  return (
    <>
      <PageHeading eyebrow="Tag" heading="Craft" intro="How good work gets made: sharpening, drafting and reading with a pencil." />
      <ArticleList chips={false} columns="2" mode="all" />
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
