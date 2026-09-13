import { defineConfig } from "zfb/config";
import { zudoDoc } from "@takazudo/zudo-doc/config";

export default defineConfig(
  zudoDoc({
    themePack: "drift",
    siteName: "zudo-composer",
    siteDescription: "An installable Preact authoring tool for building content-driven sites.",
    siteUrl: "https://zc-doc.zudolab.dev",
    base: "/",
    githubUrl: "https://github.com/Takazudo/zudo-composer",
    llmsTxt: true,
    sidebarResizer: true,
    sidebarToggle: true,
    tocToggle: true,
    imageEnlarge: true,
    dynamicPageTransition: true,
    docHistory: true,
    assetViewer: true,
    footer: {
      links: [
        {
          title: "Hosted sites",
          items: [
            { label: "zudo-composer", href: "https://zudo-composer.zudolab.dev" },
            { label: "Demo shop", href: "https://zc-demo-shop.zudolab.dev" },
            { label: "Demo landing", href: "https://zc-demo-landing.zudolab.dev" },
            { label: "Demo blog", href: "https://zc-demo-blog.zudolab.dev" },
          ],
        },
      ],
      copyright:
        'Copyright &copy; 2026 Takazudo. Built with <a href="https://takazudomodular.com/pj/zudo-doc">zudo-doc</a>.',
    },
    headerNav: [
      { label: "Overview", path: "/docs/overview", categoryMatch: "overview" },
      { label: "Architecture", path: "/docs/architecture", categoryMatch: "architecture" },
      { label: "Setup", path: "/docs/setup", categoryMatch: "setup" },
      { label: "Development", path: "/docs/development", categoryMatch: "development" },
    ],
    headerRightItems: [
      {
        type: "component",
        component: "github-link",
      },
      {
        type: "component",
        component: "theme-toggle",
      },
      {
        type: "component",
        component: "search",
      },
    ],
  }),
);
