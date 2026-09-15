import LinkedTemplate from "./composition-site-frame";

import { DemoNote, Newsletter, PageHeading, ProseBody } from "demo-blog/components";

function LocalCompositionContent() {
  return (
    <>
      <PageHeading eyebrow="Newsletter" heading="The Sunday note" intro="One short letter a week, on Sunday morning." />
      <ProseBody markdown={"Each Sunday the note brings the newest essay, one passage from a book we are reading slowly, and one small thing to try in the week ahead. It is short enough to read with the first cup of tea.\n\nThere is no tracking, no sponsor and no second email. If a week has nothing worth sending, nothing is sent."} dropCap={false} />
      <Newsletter heading="The Sunday note" lead="One short letter a week with the newest essay and one thing worth reading slowly. Nothing else." buttonLabel="Subscribe" successText="Subscribed locally — this demo keeps nothing." />
      <DemoNote text="Demo — no data is sent." />
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
