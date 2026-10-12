/** @satisfies {NonNullable<import("@takazudo/zudo-sg/config").ZudoSgComposeOptions["externalPreview"]>} */
export const externalPreview = {
  url: "/components/preview",
  trailingSlash: "never",
};

const parsed = new URL(externalPreview.url, "https://shop.invalid");
if (
  parsed.origin !== "https://shop.invalid" ||
  parsed.pathname !== externalPreview.url ||
  parsed.search ||
  parsed.hash ||
  externalPreview.url.endsWith("/")
) {
  throw new Error(
    "Shop preview must be a canonical same-origin path without a trailing slash",
  );
}

export const previewDocumentPath = `${externalPreview.url.slice(1)}/index.html`;
export const previewFrameSelector = `iframe[src^="${externalPreview.url}?"]`;
