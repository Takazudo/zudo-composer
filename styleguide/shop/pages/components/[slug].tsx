import { Island } from "@takazudo/zfb";
import { StyleguideLayout } from "@takazudo/zudo-sg/chrome";
import { CodePanel } from "@takazudo/zudo-sg/code-panel";
import ShopWorkbench from "../lib/_shop-workbench";
import { externalPreview } from "../../src/config/preview.mjs";
import { catalog, shopChrome } from "../lib/_shop-chrome";
import { sourceBySlug } from "../../src/styleguide/sources";
export const frontmatter = { title: "Component" };
export function paths() {
  return catalog
    .getAllSlugs()
    .map((slug) => ({ params: { slug }, props: { slug } }));
}
export default function ShopDetail({ slug }: { slug: string }) {
  const entry = catalog.getStoryBySlug(slug);
  if (!entry) throw Error(`Unknown component: ${slug}`);
  const previewUrl = externalPreview.url;
  const panel = (
    <aside id="sg-code-panel" class="sg-code-panel" aria-label="Code panel">
      <div
        class="sg-code-panel-resizer"
        data-sg-code-panel-resizer
        role="separator"
        aria-label="Resize code panel"
        aria-orientation="vertical"
        tabindex={0}
      />
      <Island when="load">
        <CodePanel
          storyTitle={entry.title}
          variants={sourceBySlug[slug]}
          previewUrl={previewUrl}
          slug={slug}
        />
      </Island>
    </aside>
  );
  return (
    <StyleguideLayout
      {...shopChrome(entry.title, slug)}
      activeSlug={slug}
      contentWide
      codePanel={panel}
    >
      <header class="mb-vsp-lg">
        <h1 class="text-2xl font-bold">{entry.title}</h1>
        <p class="mt-vsp-xs text-sg-muted">{entry.description}</p>
        <span class="mt-vsp-xs inline-block rounded-full border border-sg-border px-hsp-sm py-vsp-3xs text-caption text-sg-muted">
          {entry.category}
        </span>
      </header>
      <Island when="load">
        <ShopWorkbench
          slug={slug}
          variants={entry.variants}
          previewUrl={previewUrl}
          toolbar={{ codePanel: true, tokenPanel: true }}
        />
      </Island>
    </StyleguideLayout>
  );
}
