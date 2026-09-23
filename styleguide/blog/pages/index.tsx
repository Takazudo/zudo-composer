/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The root page stays host-owned so it can import site-wide islands.
import type { JSX } from "preact";
// Optional islands seed; see pages/lib/_zudo-sg-islands.ts.
import "./lib/_zudo-sg-islands";

export const frontmatter = { title: "Blog Styleguide" };

export default function IndexPage(): JSX.Element {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Blog Styleguide</title>
      </head>
      <body class="sg-home">
        <main class="sg-home__main">
          <p class="sg-home__eyebrow">Zudo Composer</p>
          <h1 class="sg-home__title" data-host-index>Blog Styleguide</h1>
          <p class="sg-home__intro">
            The Margin Notes blog page components in action, with real imagery,
            author pages, comments, and their own design tokens.
          </p>
          <nav class="sg-home__nav" aria-label="Catalog">
            <ul class="sg-home__links">
              <li>
                <a class="sg-home__link" href="/components">
                  Components
                </a>
              </li>
              <li>
                <a class="sg-home__link" href="/tokens">
                  Design tokens
                </a>
              </li>
              <li>
                <a class="sg-home__link" href="/docs/getting-started">
                  About this catalog
                </a>
              </li>
            </ul>
          </nav>
        </main>
      </body>
    </html>
  );
}
