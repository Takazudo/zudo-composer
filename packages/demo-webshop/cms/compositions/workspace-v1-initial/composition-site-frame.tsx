import { CartButton, Container, Footer, Header, NavLink } from "demo-webshop/components";

export type CompositionOutlets = {
  "site-frame-outlet"?: import("preact").ComponentChildren;
};

export default function Composition({ outlets = {} }: { outlets?: CompositionOutlets }) {
  return (
    <>
      <Header
        brand="Nightjar Supply"
        brandHref="/"
        nav={
          <>
            <NavLink label="Desk" href="/desk" exact={false} />
            <NavLink label="Carry" href="/carry" exact={false} />
            <NavLink label="Light" href="/light" exact={false} />
            <NavLink label="All products" href="/products" exact={false} />
            <NavLink label="About" href="/about" exact={false} />
          </>
        }
        actions={<CartButton label="Cart" href="/cart" />}
      />
      <Container width="page">
        {outlets["site-frame-outlet"]}
      </Container>
      <Footer
        smallPrint="Nightjar Supply is a demo shop. Nothing here is for sale, and no data you enter is sent anywhere."
        creditLabel="Built with zudo-composer"
        creditHref="https://github.com/Takazudo/zudo-composer"
        nav={
          <>
            <NavLink label="About" href="/about" exact={false} />
            <NavLink label="FAQ" href="/faq" exact={false} />
            <NavLink label="Cart" href="/cart" exact={false} />
            <NavLink label="Checkout" href="/checkout" exact={false} />
          </>
        }
      />
    </>
  );
}
