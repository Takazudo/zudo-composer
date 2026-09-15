import LinkedTemplate from "./composition-site-frame";

import { CtaBand, FaqAccordion, FeatureGrid, FeatureItem, Hero, Image, LogoStrip, PricingTable, Section, SectionHeading, SignupForm, Stats, Step, StepsRow, Testimonials } from "demo-landing/components";

function LocalCompositionContent() {
  return (
    <>
      <Hero eyebrow="Team scheduling" heading="Every moving part of your week, in one view" emphasis="one view" lead="Orrery puts your team's meetings, focus time and deadlines on one calendar, so planning the week takes minutes instead of a meeting about meetings." primaryLabel="Start free" primaryHref="#signup" secondaryLabel="See pricing" secondaryHref="/pricing" src="/uploaded-assets/asset-assets-465686d0-7f71-43d2-ae46-d8e56a175a30" alt="Stylised calendar app window with a week grid and one highlighted block" />
      <LogoStrip caption="Teams planning with Orrery" count={6} />
      <Section
        anchor="features"
        band={false}
        content={
          <>
            <SectionHeading eyebrow="Views" heading="Three views, one calendar" intro="Zoom from today's agenda to the quarter without switching tools or losing your place." as="h2" align="center" />
            <FeatureGrid
              columns="3"
              items={
                <>
                  <FeatureItem icon="calendar" title="Day, week and month" body="One timeline that zooms. Drag a block from the week view into next month and everyone sees it move." emphasis={true} />
                  <FeatureItem icon="people" title="Everyone at a glance" body="Stack your team's calendars side by side and spot the one hour on Thursday when all six of you are free." emphasis={false} />
                  <FeatureItem icon="clock" title="Focus time that holds" body="Protected blocks turn busy for everyone else, so deep work stops losing to the next invite." emphasis={false} />
                </>
              }
            />
          </>
        }
      />
      <Section
        anchor="how"
        band={false}
        content={
          <>
            <SectionHeading eyebrow="Setup" heading="How it works" intro="Most teams are planning their first week within fifteen minutes." as="h2" align="center" />
            <StepsRow
              steps={
                <>
                  <Step number={1} title="Connect your calendars" body="Sign in with Google or Microsoft. Orrery reads your existing events; nothing is copied or moved." />
                  <Step number={2} title="Mark what matters" body="Set focus hours, working days and the meetings that repeat. Orrery learns the shape of your week." />
                  <Step number={3} title="Plan on Monday, done by 9:15" body="Open the week view together, move a few blocks, and every calendar underneath updates at once." />
                </>
              }
            />
          </>
        }
      />
      <Section anchor="" band={false} content={<Image src="/uploaded-assets/asset-assets-c0782606-10cc-42f1-a223-ff461548f313" alt="Three overlapping cards for day, week and month views connected by arrows" aspect="16/10" />} />
      <Section
        anchor="pricing"
        band={false}
        content={
          <>
            <SectionHeading eyebrow="Pricing" heading="Simple pricing" intro="Start free on your own. Bring your team when the week gets crowded." as="h2" align="center" />
            <PricingTable defaultBilling="monthly" currency="USD" yearlyNote="Save 20% when billed yearly" />
          </>
        }
      />
      <Section anchor="" band={false} content={<Stats stat1Value="4 hrs" stat1Label="saved per person each week" stat2Value="12,000" stat2Label="teams planning every Monday" stat3Value="98%" stat3Label="of meetings start on time" />} />
      <Section
        anchor=""
        band={false}
        content={
          <>
            <SectionHeading eyebrow="Customers" heading="What teams say" intro="" as="h2" align="center" />
            <Testimonials />
          </>
        }
      />
      <CtaBand heading="Plan next week in ten minutes" lead="Free for one person, forever. No card needed." buttonLabel="Start free" buttonHref="/#signup" />
      <Section
        anchor="faq"
        band={false}
        content={
          <>
            <SectionHeading eyebrow="FAQ" heading="Questions" intro="" as="h2" align="center" />
            <FaqAccordion allowMultiple={false} />
          </>
        }
      />
      <Section anchor="signup" band={false} content={<SignupForm heading="Start free" lead="Tell us where to send your invite. Solo is free; you can add your team later." buttonLabel="Create my calendar" successHeading="Check your inbox" successText="Check your inbox — in this demo, nothing was sent." />} />
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
