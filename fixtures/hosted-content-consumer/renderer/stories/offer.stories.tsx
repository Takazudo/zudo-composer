/** @jsxRuntime automatic */
/** @jsxImportSource @takazudo/zfb/zudo-react */
import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { HostDocumentBody } from "../src/OfferPage";
import { offerProjection } from "../src/project";
import snapshot from "../src/snapshot.json";
export default { title: "Hosted Offer", category: "Host", description: "The immutable saved Content snapshot through the approved host layout.",
  usage: '<HostDocumentBody data={offerProjection(snapshot.renderData)} />' } satisfies StoryMeta;
export const SavedSnapshot: Story = { name: "Exact saved snapshot", render: () => <HostDocumentBody data={offerProjection(snapshot.renderData)} /> };
