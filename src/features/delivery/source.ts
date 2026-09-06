import type { MediaVersionPin } from "../../media/model";
import type { SiteProjectActiveSelection } from "../../site-project/api";
import type { ReleaseToolchain } from "../../site-project/api";
import { validateReleaseToolchain } from "../../site-project/api/validation";
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
  toolchain: ReleaseToolchain;
}

export type ActivatedDeliverySource =
  | { status: "ready"; artifact: ActivatedDeliveryArtifact }
  | { status: "no-active"; message: string }
  | { status: "error"; message: string };

export type DeliverySourceContract =
  | { kind: "activated"; componentProvider: typeof import("../composer/active-pack").activeComponentProvider; read(): ActivatedDeliverySource; subscribe?(listener: () => void): () => void }
  | { kind: "working-preview"; providers: import("../../app/provider-integration").ProductionProviderIntegration };

export function parseActivatedDeliverySource(value: unknown): ActivatedDeliverySource | undefined {
  if (!value || typeof value !== "object" || !("status" in value)) return undefined;
  if ((value.status === "no-active" || value.status === "error") && "message" in value && typeof value.message === "string") return value as ActivatedDeliverySource;
  if (value.status !== "ready" || !("artifact" in value)) return undefined;
  try { return validateActivatedDeliveryArtifact(value.artifact as ActivatedDeliveryArtifact) === undefined ? value as ActivatedDeliverySource : undefined; }
  catch { return undefined; }
}

const SHA = /^[a-f0-9]{64}$/;
export function validateActivatedDeliveryArtifact(artifact: ActivatedDeliveryArtifact, installedPack?: { packId: string; packVersion: string; contractVersion: number }): string | undefined {
  const { identity, project, build } = artifact;
  if (project.id !== identity.projectId || build.projectId !== identity.projectId || !SHA.test(identity.revision) || !SHA.test(identity.buildId) || !SHA.test(artifact.completionDigest)) return "Activated project, build, and pointer identity do not agree.";
  if (!validateReleaseToolchain(artifact.toolchain)) return "Activated release toolchain attestation is malformed.";
  if (installedPack && (artifact.toolchain.componentPack.packId !== installedPack.packId || artifact.toolchain.componentPack.packVersion !== installedPack.packVersion || artifact.toolchain.componentPack.contractVersion !== installedPack.contractVersion)) return "Activated release component runtime does not match the installed component pack.";
  for (const [name, digest] of Object.entries(artifact.files)) if (!/^(?:build\.json|stage\.json|module-\d{4,8}\.mjs|media-sha256-[a-f0-9]{64}\.(?:png|jpg|gif|webp|pdf))$/.test(name) || !SHA.test(digest)) return "Activated completion manifest is malformed.";
  if (!SHA.test(artifact.files["build.json"] ?? "") || !SHA.test(artifact.files["stage.json"] ?? "") || build.modules.some((_, index) => !SHA.test(artifact.files[`module-${String(index).padStart(4, "0")}.mjs`] ?? ""))) return "Activated completion manifest omits required build output.";
  for (const pin of artifact.mediaPins) {
    const name = `media-${pin.url.split("/").at(-1) ?? ""}`;
    if (!/^\/uploaded-media\/sha256-[a-f0-9]{64}\.(?:png|jpg|gif|webp|pdf)$/.test(pin.url) || artifact.files[name] !== pin.checksum) return "Activated build does not contain every exact pinned Media URL.";
  }
  return undefined;
}
