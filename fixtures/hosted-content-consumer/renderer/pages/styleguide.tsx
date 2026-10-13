/** @jsxRuntime automatic */
/** @jsxImportSource @takazudo/zfb/zudo-react */
import { createRegistry } from "@takazudo/zudo-sg/registry";
import * as offer from "../stories/offer.stories";
const registry = createRegistry({ "./stories/offer.stories.tsx": offer });
export default function Styleguide() {
  const story = registry.getStoryBySlug("hosted-offer");
  if (!story || story.variants[0]?.exportName !== "SavedSnapshot") throw Error("The real SG registry lost its saved-snapshot story");
  return <html lang="ja"><head><meta charset="utf-8" /><title>{story.meta.title}</title><link rel="stylesheet" href="/visitor.css" /></head>
    <body><nav aria-label="Styleguide"><a href="/">Visitor</a><p>{story.meta.title} / {story.variants[0].name}</p></nav>
      <div data-sg-story={story.slug} data-sg-variant="SavedSnapshot">{story.variants[0].story.render()}</div>
    </body></html>;
}
