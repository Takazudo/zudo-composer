import { Button, Container, Footer, Header, NavLink } from "demo-landing/components";

export type CompositionOutlets = {
  "site-frame-outlet"?: import("preact").ComponentChildren;
};

export default function Composition({ outlets = {} }: { outlets?: CompositionOutlets }) {
  return (
    <>
      <Header
        brand="Orrery"
        brandHref="/"
        nav={
          <>
            <NavLink label="Features" href="/features" />
            <NavLink label="Pricing" href="/pricing" />
            <NavLink label="About" href="/about" />
          </>
        }
        action={<Button label="Start free" href="/#signup" variant="secondary" size="md" />}
      />
      <Container width="page" content={outlets["site-frame-outlet"]} />
      <Footer
        smallPrint="© 2026 Orrery. A fictional product for a demo site."
        creditLabel="Built with zudo-composer"
        creditHref="https://zudo-composer.zudolab.dev"
        nav={
          <>
            <NavLink label="Features" href="/features" />
            <NavLink label="Pricing" href="/pricing" />
            <NavLink label="About" href="/about" />
            <NavLink label="Privacy" href="/privacy" />
            <NavLink label="Terms" href="/terms" />
          </>
        }
      />
    </>
  );
}
