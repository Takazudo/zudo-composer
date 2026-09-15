import LinkedTemplate from "./composition-site-frame";

import { ArticleList, PageHeading } from "demo-blog/components";

function LocalCompositionContent() {
  return (
    <>
      <PageHeading eyebrow="Archive" heading="All articles" intro="Every essay, newest first. Filter by the thread you are following." />
      <ArticleList chips={true} columns="3" mode="all" tagOptions={["craft","attention","tools"]} />
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
