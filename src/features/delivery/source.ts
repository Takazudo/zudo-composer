import type { MediaVersionPin } from "../../media/model";
import type { SiteProjectActiveSelection } from "../../site-project/api";
import type { SiteBuildPlan } from "../../site-project/compiler";
import type { SiteProject } from "../../site-project/model";

export interface ActivatedDeliveryArtifact {
  kind: "activated-local" | "bundled-static";
  identity: SiteProjectActiveSelection;
  project: SiteProject;
  build: SiteBuildPlan;
  completionDigest: string;
  files: Readonly<Record<string, string>>;
  mediaPins: readonly MediaVersionPin[];
}

export type ActivatedDeliverySource =
  | { status: "ready"; artifact: ActivatedDeliveryArtifact }
  | { status: "no-active"; message: string }
  | { status: "error"; message: string };

export type DeliverySourceContract =
  | { kind: "activated"; componentProvider: typeof import("../composer/active-pack").activeComponentProvider; read(): ActivatedDeliverySource; subscribe?(listener: () => void): () => void }
  | { kind: "working-preview"; providers: import("../../app/provider-integration").ProductionProviderIntegration };

const SHA = /^[a-f0-9]{64}$/;
export function validateActivatedDeliveryArtifact(artifact: ActivatedDeliveryArtifact): string | undefined {
  const { identity, project, build } = artifact;
  if (project.id !== identity.projectId || build.projectId !== identity.projectId || !SHA.test(identity.revision) || !SHA.test(identity.buildId) || !SHA.test(artifact.completionDigest)) return "Activated project, build, and pointer identity do not agree.";
  for (const [name, digest] of Object.entries(artifact.files)) if (!/^(?:build\.json|stage\.json|module-\d{4,8}\.mjs|media-sha256-[a-f0-9]{64}\.(?:png|jpg|gif|webp|pdf))$/.test(name) || !SHA.test(digest)) return "Activated completion manifest is malformed.";
  for (const pin of artifact.mediaPins) {
    const name = `media-${pin.url.split("/").at(-1) ?? ""}`;
    if (!/^\/uploaded-media\/sha256-[a-f0-9]{64}\.(?:png|jpg|gif|webp|pdf)$/.test(pin.url) || artifact.files[name] !== pin.checksum) return "Activated build does not contain every exact pinned Media URL.";
  }
  return undefined;
}
