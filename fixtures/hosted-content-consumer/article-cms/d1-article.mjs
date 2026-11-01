/* global TextEncoder */
// Article host tables and the bounded local publication for the Worker/D1 host. Runtime-neutral: it uses only a
// D1 binding and the public service, so the Worker runs it and the Node launcher uses the initializer.
import { D1_LIMITS, HostedD1Error, initializeD1Database } from "../d1-storage.mjs";
import { articleActor } from "./article-core.mjs";
import { renderArticlesHtml } from "./render.mjs";

const ARTIFACT_TABLE = `CREATE TABLE IF NOT EXISTS article_artifact (
  publication_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, snapshot_digest TEXT NOT NULL, html_digest TEXT NOT NULL, html TEXT NOT NULL)`;

/** Explicit local initialization of one site database: current schema, seed only when absent, host artifact table. */
export async function initializeArticleD1(db, seed) {
  const result = await initializeD1Database(db, seed);
  await db.prepare(ARTIFACT_TABLE).run();
  return result;
}

const hex = async (algorithm, text) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
export const sha256Hex = text => hex("SHA-256", text);

/** Writes the artifact once (insert-only); an existing one is accepted only when it is exactly this snapshot. Returns its digest. */
async function ensureArtifact(db, publicationId, snapshot) {
  const html = renderArticlesHtml(snapshot.renderData);
  if (new TextEncoder().encode(html).length > D1_LIMITS.maxBoundBytes) throw new HostedD1Error("limit", "The local artifact exceeds D1's row limit; nothing was written.");
  const digest = await sha256Hex(html);
  await db.prepare("INSERT INTO article_artifact (publication_id, snapshot_id, snapshot_digest, html_digest, html) VALUES (?, ?, ?, ?, ?) ON CONFLICT (publication_id) DO NOTHING")
    .bind(publicationId, snapshot.id, snapshot.digest, digest, html).run();
  const row = await db.prepare("SELECT snapshot_id, snapshot_digest, html_digest FROM article_artifact WHERE publication_id = ?").bind(publicationId).first();
  if (row?.snapshot_id !== snapshot.id || row.snapshot_digest !== snapshot.digest) throw new Error("A different artifact is already recorded for this publication; it was preserved.");
  return row.html_digest;
}

export async function readArticleArtifact(db, publicationId) {
  const row = await db.prepare("SELECT html FROM article_artifact WHERE publication_id = ?").bind(publicationId).first();
  return row ? row.html : null;
}

/**
 * Local publication: submitted → artifact recorded with its digest (verified) → activated as the local baseline
 * (integrated). The persisted publication record is the intent; every step resumes from its persisted status, so a
 * stop at any point completes once on a later request after a restart. Nothing is deployed.
 */
export async function advanceArticlePublication({ db, service, storage, publicationId, faults = {} }) {
  let publication = await service.getPublication(articleActor, publicationId);
  if (!["submitted", "verified"].includes(publication.status)) return publication.status;
  const snapshot = await storage.readSnapshot(publication.snapshotId);
  const artifactDigest = await ensureArtifact(db, publicationId, snapshot);
  if (publication.status === "submitted") {
    await service.recordStatus({ publicationId, snapshotId: snapshot.id, statusVersion: publication.statusVersion + 1, status: "verified", facts: { artifact: publicationId, artifactDigest } });
    publication = await service.getPublication(articleActor, publicationId);
  }
  // Proof-only: this runtime's publisher stops after verification, as a crash would; a restarted runtime resumes.
  if (faults.stopAfterVerified) throw new Error("Interrupted after verification (proof fault)");
  // A deterministic local commit identity for the activated snapshot; no Git repository is involved.
  const gitSha = await hex("SHA-1", snapshot.digest);
  await service.recordConfirmedIntegration({ publicationId, snapshotId: snapshot.id, expectedBaseline: publication.expectedBaseline, gitSha, contentDigest: snapshot.digest });
  return "integrated";
}

/** Resume a persisted, unfinished publication; concurrent attempts are refused by the service's own guards. */
export async function resumeArticlePublication(options) {
  const pending = (await options.service.readPublicationStatus(articleActor)).submission;
  if (!pending || !["submitted", "verified"].includes(pending.status)) return null;
  return advanceArticlePublication({ ...options, publicationId: pending.publicationId });
}
