// Host-owned projection and page renderer, shared by the browser preview and the local artifact.
// Browser-safe: no Node imports. Body Markdown is shown as escaped prose paragraphs.
const escape = value => String(value ?? "").replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);

export function projectArticles(providers) {
  const provider = providers.find(item => item.providerId === "articles");
  const front = provider?.entries.find(entry => entry.modelId === "front-page" && entry.id === "front");
  const order = Array.isArray(front?.values.articles) ? front.values.articles : [];
  const articles = order.map(ref => provider.entries.find(entry => entry.modelId === "article" && entry.id === ref.recordId)).filter(Boolean)
    .map(entry => ({ id: entry.id, title: entry.values.title ?? "", summary: entry.values.summary ?? "", body: entry.values.body ?? "", author: entry.values.author ?? "" }));
  return { kind: "article-site-v1", articles };
}

export function renderArticlesHtml(renderData) {
  const articles = renderData?.kind === "article-site-v1" ? renderData.articles : [];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Journal</title>
<style>body{font-family:Georgia,serif;margin:1.5rem;color:#1d2328;line-height:1.5}article{margin-block:1.25rem;padding-bottom:1rem;border-bottom:1px solid #ddd}h1{font-size:1.6rem}h2{margin:0}</style></head>
<body><h1>Journal</h1>${articles.map(article => `<article data-article="${escape(article.id)}"><h2>${escape(article.title)}</h2>
<p><em>${escape(article.summary)}</em></p>${String(article.body).split(/\n{2,}/).filter(Boolean).map(paragraph => `<p>${escape(paragraph)}</p>`).join("")}
${article.author ? `<p><small>${escape(article.author)}</small></p>` : ""}</article>`).join("")}</body></html>`;
}
