/** @jsxRuntime automatic */
/** @jsxImportSource @takazudo/zfb/zudo-react */
import type { Child } from "@takazudo/zfb/zudo-react";
import type { OfferProjection } from "./project";
import { renderHostMarkdown } from "./markdown";

/** The same real host module is consumed by ZFB, the SG story and the preview iframe. */
export function OfferPage({ data }: { data: OfferProjection }) {
  return <article data-host-component="host:OfferPage">
    <h1>{data.title}</h1>
    <p data-price>{data.price}円</p>
    <figure><img src={data.image.url} alt={data.image.alt} width={320} height={180}
      data-asset-version={data.image.versionId} data-asset-checksum={data.image.checksum} />
      <figcaption>{data.image.caption}</figcaption></figure>
    <div data-host-notes rawHtml={renderHostMarkdown(data.notes)} />
    <section id={data.route.fragment} aria-label="よくある質問"><h2>よくある質問</h2>
      {data.questions.map((item) => <div key={item.id} data-faq-id={item.id}>
        <h3>{item.question}</h3><p>{item.answer}</p>
      </div>)}
    </section>
  </article>;
}
/** Linked approved layout owns the chrome; page composition fills only its main outlet. */
export function ApprovedLayout({ data, children }: { data: OfferProjection; children: Child }) {
  return <div data-template-id={data.template.id} data-template-version={data.template.version}>
    <header><a href="/">承認済みサイト</a></header>
    <main data-outlet={data.template.outlet} data-composition-id={data.composition.id}>{children}</main>
    <footer>固定レイアウト</footer>
  </div>;
}
export function HostDocumentBody({ data }: { data: OfferProjection }) {
  return <ApprovedLayout data={data}><OfferPage data={data} /></ApprovedLayout>;
}
export function VisitorDocument({ data }: { data: OfferProjection }) {
  return <html lang="ja"><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" /><title>{data.title}</title>
    <link rel="stylesheet" href="/visitor.css" /></head>
    <body><HostDocumentBody data={data} /></body></html>;
}
