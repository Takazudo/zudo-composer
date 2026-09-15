import LinkedTemplate from "./composition-site-frame";

import { CtaBand, FeatureGrid, FeatureItem, Image, Prose, Section, SectionHeading, Split } from "demo-landing/components";

function LocalCompositionContent() {
  return (
    <>
      <Section
        anchor=""
        band={false}
        content={
          <>
            <SectionHeading eyebrow="Product" heading="Features" intro="Six things Orrery does so that nobody on your team has to do them by hand." as="h1" align="center" />
            <FeatureGrid
              columns="3"
              items={
                <>
                  <FeatureItem icon="calendar" title="One zoomable timeline" body="Day, week and month are the same surface. Zoom out to see the quarter; zoom in to move a single meeting." emphasis={true} />
                  <FeatureItem icon="people" title="Team overlay" body="Layer any set of calendars and see shared free time highlighted, across time zones." emphasis={false} />
                  <FeatureItem icon="clock" title="Protected focus" body="Focus blocks show as busy to others and move out of the way when a real deadline needs the hour." emphasis={false} />
                  <FeatureItem icon="bell" title="Quiet reminders" body="One summary before the day starts instead of a notification for every event." emphasis={false} />
                  <FeatureItem icon="layers" title="Workload view" body="Hours booked per person, per week. Spot the overloaded before the Friday crunch." emphasis={false} />
                  <FeatureItem icon="lock" title="Private by default" body="Colleagues see busy, not details, unless you share them. Org adds SSO and an audit log." emphasis={false} />
                </>
              }
            />
          </>
        }
      />
      <Section
        anchor=""
        band={false}
        content={
          <Split
            ratio="1/1"
            reverse={false}
            media={<Image src="/uploaded-assets/asset-assets-c0782606-10cc-42f1-a223-ff461548f313" alt="Three overlapping cards for day, week and month views connected by arrows" aspect="16/10" />}
            copy={
              <>
                <SectionHeading eyebrow="Views" heading="Move a block once, everywhere" intro="" as="h2" align="start" />
                <Prose markdown={"Every view reads from the same week. Drag a planning session from Tuesday to Thursday in the week view and it moves in the month view, on your colleague's overlay and in the calendar app on their phone.\n\nNo copies, no duplicate invites, no \"which version is right?\""} />
              </>
            }
          />
        }
      />
      <CtaBand heading="Plan next week in ten minutes" lead="Free for one person, forever. No card needed." buttonLabel="Start free" buttonHref="/#signup" />
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
