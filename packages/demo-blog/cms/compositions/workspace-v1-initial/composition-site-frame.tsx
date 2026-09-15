import { Container, Footer, Header, NavLink } from "demo-blog/components";

export type CompositionOutlets = {
  "site-frame-outlet"?: import("preact").ComponentChildren;
};

export default function Composition({ outlets = {} }: { outlets?: CompositionOutlets }) {
  return (
    <>
      <Header
        brand="Margin Notes"
        brandHref="/"
        nav={
          <>
            <NavLink label="Articles" href="/articles" />
            <NavLink label="Craft" href="/craft" />
            <NavLink label="Attention" href="/attention" />
            <NavLink label="Tools" href="/tools" />
            <NavLink label="About" href="/about" />
          </>
        }
      />
      <Container width="page" content={outlets["site-frame-outlet"]} />
      <Footer
        smallPrint="Margin Notes is a two-author journal about working with attention: short essays on craft, focus and the tools that hold up."
        creditLabel="Built with zudo-composer"
        creditHref="https://zudo-composer.zudolab.dev"
        nav={
          <>
            <NavLink label="About" href="/about" />
            <NavLink label="Authors" href="/authors" />
            <NavLink label="Newsletter" href="/newsletter" />
          </>
        }
      />
    </>
  );
}
