import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

export const SPA_ROUTES = ["/", "/composer", "/composer/preview", "/sitemapper"];
export const LIVE_ORIGIN = "https://zudo-composer.takazudomodular.com";

const MIME_BY_EXTENSION = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".wasm", "application/wasm"],
]);

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function expectedMime(path) {
  const mime = MIME_BY_EXTENSION.get(extname(path).toLowerCase());
  if (!mime) throw new Error(`No deployment MIME contract for ${path}`);
  return mime;
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return paths.flat();
}

export async function createArtifactManifest(distDirectory) {
  const dist = resolve(distDirectory);
  const files = (await filesUnder(dist)).sort((left, right) => left.localeCompare(right));
  const entries = await Promise.all(files.map(async (path) => {
    const bytes = await readFile(path);
    const relativePath = relative(dist, path).split(sep).join("/");
    return {
      path: relativePath,
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
      mime: expectedMime(relativePath),
    };
  }));
  if (!entries.some(({ path }) => path === "index.html")) {
    throw new Error(`Deployment artifact has no index.html: ${dist}`);
  }
  return { schemaVersion: 1, files: entries };
}

export function deploymentCredentialState(environment) {
  const token = Boolean(environment.CLOUDFLARE_API_TOKEN?.trim());
  const account = Boolean(environment.CLOUDFLARE_ACCOUNT_ID?.trim());
  if (token && account) return "complete";
  if (!token && !account) return "absent";
  return "partial";
}

export function responseMime(response) {
  return response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
}

export async function verifyDeployment({ baseUrl, distDirectory, fetchImpl = fetch }) {
  const manifest = await createArtifactManifest(distDirectory);
  const origin = new URL(baseUrl);
  const index = manifest.files.find(({ path }) => path === "index.html");
  const results = [];

  for (const route of SPA_ROUTES) {
    const url = new URL(route, origin);
    const response = await fetchImpl(url, { redirect: "error" });
    if (!response.ok) throw new Error(`${route}: expected HTTP 2xx, received ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== index.sha256) throw new Error(`${route}: response does not match index.html SHA-256`);
    if (responseMime(response) !== index.mime) {
      throw new Error(`${route}: expected ${index.mime}, received ${responseMime(response) || "no Content-Type"}`);
    }
    results.push({ path: route, sha256: index.sha256, mime: index.mime });
  }

  for (const file of manifest.files) {
    // Cloudflare canonically redirects /index.html to /. The index bytes and
    // MIME are already checked through every public SPA route above.
    if (file.path === "index.html") continue;
    const path = `/${file.path}`;
    const response = await fetchImpl(new URL(path, origin), { redirect: "error" });
    if (!response.ok) throw new Error(`${path}: expected HTTP 2xx, received ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== file.sha256) throw new Error(`${path}: response SHA-256 does not match the built artifact`);
    if (responseMime(response) !== file.mime) {
      throw new Error(`${path}: expected ${file.mime}, received ${responseMime(response) || "no Content-Type"}`);
    }
    results.push({ path, sha256: file.sha256, mime: file.mime });
  }

  return { manifest, results };
}
