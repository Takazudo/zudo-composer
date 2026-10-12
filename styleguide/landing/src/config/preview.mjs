/** @satisfies {NonNullable<import("@takazudo/zudo-sg/config").ZudoSgComposeOptions["externalPreview"]>} */
export const externalPreview = {
  url: "/components/preview",
  trailingSlash: "never",
};

const parsed = new URL(externalPreview.url, "https://landing.invalid");
if (
  parsed.origin !== "https://landing.invalid" ||
  parsed.pathname !== externalPreview.url ||
  parsed.search ||
  parsed.hash ||
  externalPreview.url.endsWith("/")
) {
  throw new Error(
    "Landing preview must be a canonical same-origin path without a trailing slash",
  );
}

export const previewDocumentPath = `${externalPreview.url.slice(1)}/index.html`;
export const previewFrameSelector = `iframe[src^="${externalPreview.url}?"]`;
