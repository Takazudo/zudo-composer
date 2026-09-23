import { createElement, type ComponentChildren, type ComponentType } from "preact";
import type { StoryMeta } from "@takazudo/zudo-sg/stories";
import {
  Button, ComparisonNote, ContactForm, Container, CtaBand, DemoNote, FaqAccordion, FaqItem,
  FeatureGrid, FeatureItem, Footer, Grid, Header, Hero, Image, LogoStrip, NavLink,
  PricingTable, PricingTier, Prose, Section, SectionHeading, SignupForm, Split, Stack,
  Stats, Step, StepsRow, Testimonial, Testimonials, componentPack,
} from "../src/generated/landing-pack";
import { assets } from "../src/generated/assets";

const photo = (name: string) => {
  const url = assets[name];
  if (!url) throw new Error(`Missing Landing asset: ${name}`);
  return url;
};
const app = photo("land-hero-app.webp");
const workflow = photo("land-workflow.webp");
const team = photo("land-team.webp");
const mara = photo("avatar-mara.webp");
const jonah = photo("avatar-jonah.webp");
const priya = photo("avatar-priya.webp");

type Definition = {
  id: string; title: string; category: string; description: string;
  defaults: Record<string, unknown>; source: { exportName: string };
  component: ComponentType<Record<string, unknown>>;
};
const definitions = componentPack.manifest.components.map((entry) => ({
  ...entry,
  component: componentPack.runtime.components[entry.id]?.component,
})) as unknown as Definition[];
function definition(id: string): Definition {
  const found = definitions.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing Landing pack component: ${id}`);
  return found;
}
export function storyMeta(id: string): StoryMeta {
  const entry = definition(id);
  return {
    title: entry.title,
    category: entry.category,
    description: entry.description,
    usage: `import { ${entry.source.exportName} } from "demo-landing/components";\n\nconst props = ${JSON.stringify(entry.defaults, null, 2)};\n<${entry.source.exportName} {...props} />`,
  };
}
export function packDefaults(id: string): ComponentChildren {
  const entry = definition(id);
  return createElement(entry.component, { ...entry.defaults });
}
const feature = (emphasis = false) => <FeatureItem icon="calendar" title="One calendar for the team" body="Keep deadlines, meetings and focused work together." emphasis={emphasis} />;
const features = () => <><FeatureItem icon="calendar" title="See the week" body="Everything in one clear view." emphasis /><FeatureItem icon="clock" title="Protect focus" body="Make room for work that matters." emphasis={false} /><FeatureItem icon="people" title="Plan together" body="Find time that works for everyone." emphasis={false} /></>;
const steps = () => <><Step number={1} title="Connect calendars" body="Bring your existing schedule." /><Step number={2} title="Find shared time" body="See availability at a glance." /><Step number={3} title="Protect focus" body="Keep your best hours clear." /></>;
const tier = (name: string, monthly: number, yearly: number, popular = false) => <PricingTier name={name} tagline={name === "Solo" ? "For one clear calendar." : "For teams planning together."} priceMonthly={monthly} priceYearly={yearly} currency="USD" ctaLabel="Start free" ctaHref="#signup" popular={popular} feature1="Calendar sync" feature2="Focus blocks" feature3={popular ? "Shared team calendar" : ""} feature4="" feature5="" feature6="" order={popular ? 2 : 1} />;
const tiers = () => <>{tier("Solo", 0, 0)}{tier("Studio", 12, 10, true)}{tier("Organization", 24, 20)}</>;
const faq = () => <><FaqItem question="Can I try Orrery for free?" answer="Yes. **Solo is free**, and Studio includes a trial." topic="general" order={1} /><FaqItem question="Can I change my billing period?" answer="You can switch between monthly and yearly billing." topic="billing" order={2} /><FaqItem question="Can I export my data?" answer="Yes, export your calendar at any time." topic="security" order={3} /></>;
const testimonial = (name: string, src: string, order: number) => <Testimonial quote="Our week finally makes sense at a glance." name={name} role="Operations lead" src={src} alt={`Portrait of ${name}`} order={order} />;
const testimonials = () => <>{testimonial("Mara Lind", mara, 1)}{testimonial("Jonah Lee", jonah, 2)}{testimonial("Priya Shah", priya, 3)}</>;
const heading = () => <SectionHeading eyebrow="How it works" heading="Make space for your best work" intro="A calmer way to plan the week." as="h2" align="start" />;

export function showcase(id: string, example: boolean): ComponentChildren {
  const entry = definition(id);
  const render = (props: Record<string, unknown> = {}) => createElement(entry.component, { ...entry.defaults, ...props });
  switch (id) {
    case "land.header": return <Header brand="Orrery" brandHref="#home" nav={<><NavLink label="Features" href="#features" /><NavLink label="Pricing" href="#pricing" /></>} action={<Button label={example ? "Try Orrery" : "Start free"} href="#signup" variant="secondary" size="md" />} />;
    case "land.nav-link": return <NavLink label={example ? "View pricing" : "Explore features"} href={example ? "#pricing" : "#features"} />;
    case "land.footer": return <Footer smallPrint="© 2026 Orrery. A fictional scheduling product." creditLabel="Built with zudo-composer" creditHref="https://zudo-composer.zudolab.dev" nav={<><NavLink label="Features" href="#features" /><NavLink label="Contact" href="#contact" /></>} />;
    case "land.button": return <Button label={example ? "Start your free trial" : "See pricing"} href={example ? "#signup" : "#pricing"} variant={example ? "primary" : "secondary"} size={example ? "lg" : "md"} />;
    case "land.demo-note": return <DemoNote text={example ? "Demo — signup and contact forms send nothing." : "Demo — no data is sent."} />;
    case "land.container": return <Container width={example ? "narrow" : "page"} content={heading()} />;
    case "land.stack": return <Stack gap={example ? "lg" : "sm"} align={example ? "center" : "start"} content={<>{heading()}<DemoNote text="Everything in one calm view." /></>} />;
    case "land.grid": return <Grid columns={example ? "2" : "3"} gap={example ? "lg" : "md"} items={features()} />;
    case "land.split": return <Split ratio={example ? "2/3" : "1/1"} reverse={example} media={<Image src={workflow} alt="Orrery workflow calendar" aspect="4/3" />} copy={<>{heading()}<Prose markdown="Connect calendars, then find time for the work that matters." /></>} />;
    case "land.section": return <Section anchor={example ? "features" : ""} band={example} content={<Container width="page" content={<>{heading()}<FeatureGrid columns="3" items={features()} /></>} />} />;
    case "land.section-heading": return <SectionHeading eyebrow="Features" heading={example ? "A calmer way to plan" : "Make space for work"} intro="One shared calendar for your team." as={example ? "h1" : "h2"} align={example ? "start" : "center"} />;
    case "land.image": return <Image src={example ? team : workflow} alt={example ? "Orrery team planning together" : "Orrery calendar workflow"} aspect={example ? "16/10" : "4/3"} />;
    case "land.prose": return <Prose markdown={example ? "## Plan together\n\nBring your team into one **clear view**.\n\n- See availability\n- Protect focus time" : "Keep meetings, deadlines and focused work in one place."} />;
    case "land.hero": return <Hero eyebrow="Team scheduling" heading={example ? "A calmer way to plan your week" : "Every moving part of your week, in one view"} emphasis={example ? "calmer" : "one view"} lead="Meetings, focus time and deadlines on one shared calendar." primaryLabel="Start free" primaryHref="#signup" secondaryLabel="See pricing" secondaryHref="#pricing" src={app} alt="Orrery calendar app interface" />;
    case "land.logo-strip": return <LogoStrip caption={example ? "Made for teams finding their rhythm" : "Teams planning with Orrery"} count={example ? 3 : 6} />;
    case "land.feature-grid": return <FeatureGrid columns={example ? "2" : "3"} items={features()} />;
    case "land.feature-item": return example ? <FeatureItem icon="lock" title="Your time stays yours" body="Control what the rest of your team can see." emphasis /> : feature();
    case "land.steps-row": return <StepsRow steps={steps()} />;
    case "land.step": return <Step number={example ? 2 : 1} title={example ? "Find shared time" : "Connect calendars"} body="Bring the week into focus, one step at a time." />;
    case "land.pricing-table": return <PricingTable defaultBilling={example ? "yearly" : "monthly"} currency="USD" yearlyNote="Save 20% when billed yearly" tiers={tiers()} />;
    case "land.pricing-tier": return example ? tier("Studio", 12, 10, true) : tier("Solo", 0, 0);
    case "land.testimonials": return <Testimonials testimonials={testimonials()} />;
    case "land.testimonial": return example ? testimonial("Priya Shah", priya, 3) : testimonial("Mara Lind", mara, 1);
    case "land.stats": return render(example ? { stat1Value: "4 hrs", stat2Value: "12k", stat3Value: "98%" } : {});
    case "land.faq-accordion": return <FaqAccordion allowMultiple={example} items={faq()} />;
    case "land.faq-item": return <FaqItem question={example ? "Can we change plans?" : "Can I try Orrery?"} answer="Yes. Change plans whenever your team needs to." topic={example ? "billing" : "general"} order={1} />;
    case "land.cta-band": return <CtaBand heading={example ? "Ready for a calmer week?" : "Plan next week in ten minutes"} lead="Free for one person. No card needed." buttonLabel="Start free" buttonHref="#signup" />;
    case "land.comparison-note": return <ComparisonNote markdown={example ? "All plans include **calendar sync**, focus blocks, and export at any time." : "Choose the plan that fits the way you work."} />;
    case "land.signup-form": return <SignupForm heading={example ? "Start your team trial" : "Start free"} lead="Try an email and team size, or submit empty fields to see validation." buttonLabel="Create my calendar" successHeading="Check your inbox" successText="This is a demo. Nothing was sent." />;
    case "land.contact-form": return <ContactForm heading={example ? "Ask us about Orrery" : "Write to us"} successText="Thanks. This is a demo; your message was not sent." />;
    default: return render();
  }
}
