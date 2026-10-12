import { buildHostedPreviewLocation, createHostedPreviewController } from "zudo-composer/hosted-content/preview";
import { hostPack, hostRenderer } from "./identity";
import snapshot from "./snapshot.json";
import type { HostedSnapshot } from "zudo-composer/hosted-content";
// This generated JSON is the exact validated result of the trusted service capture.
// JSON module inference widens schema discriminator literals.
const authoritativeSnapshot = snapshot as unknown as HostedSnapshot;
const frame = document.querySelector<HTMLIFrameElement>("#snapshot-preview");
const status = document.querySelector<HTMLOutputElement>("#preview-status");
if (!frame || !status) throw Error("Missing review fixture elements");
const location = buildHostedPreviewLocation("/preview.html", window.location.origin);
const preview = createHostedPreviewController({ frame, location, hostWindow: window, pack: hostPack,
  renderer: hostRenderer, onState(state) { status.value = state.status; status.dataset.state = state.status; } });
frame.src = location.src;
void preview.render(authoritativeSnapshot, "home").then((receipt) => {
  status.dataset.snapshotId = receipt.snapshotId;
  status.dataset.digest = receipt.snapshotDigest;
}).catch((error: unknown) => { status.value = String(error); status.dataset.state = "error"; });
window.addEventListener("pagehide", () => preview.dispose(), { once: true });
