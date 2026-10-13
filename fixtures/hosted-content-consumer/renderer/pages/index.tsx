/** @jsxRuntime automatic */
/** @jsxImportSource @takazudo/zfb/zudo-react */
import { VisitorDocument } from "../src/OfferPage";
import { offerProjection } from "../src/project";
import snapshot from "../src/snapshot.json";
export default function Home() { return <VisitorDocument data={offerProjection(snapshot.renderData)} />; }
