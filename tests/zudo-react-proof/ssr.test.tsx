import { expect, it } from "vitest";
import { signal } from "@takazudo/zfb/zudo-react";
import { renderToString } from "@takazudo/zfb/zudo-react/server";
import { PackCard } from "./fixtures/pack/pack-card";

it("renderToString renders a pack component through the shared runtime with no protocol markers", () => {
  const html = renderToString(
    <section style={{ "max-width": "20rem", opacity: 0.5 }}>
      <PackCard label={signal("ssr")} />
      <div rawHtml={"<em>trusted</em>"} />
    </section>,
  );
  expect(html).toBe('<section style="max-width:20rem;opacity:0.5;"><b class="pack-card">ssr:0</b><div><em>trusted</em></div></section>');
});

it("Preact spellings fail loudly instead of being emitted", () => {
  const props = { className: "x" } as unknown as Record<string, never>;
  expect(() => renderToString(<div {...props} />)).toThrow(/ZR_PROP_DIALECT|class/);
});
