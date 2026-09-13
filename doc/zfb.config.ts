import { defineConfig } from "zfb/config";
import { zudoDoc } from "@takazudo/zudo-doc/config";

export default defineConfig(
  zudoDoc({
    themePack: "drift",
    siteName: "zudo-composer",
    siteDescription: "An installable Preact authoring tool for building content-driven sites.",
    siteUrl: "https://zudo-composer.zudolab.dev",
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
            { label: "Sample Studio", href: "https://zc-demo-sample.zudolab.dev" },
            { label: "Nightjar Supply", href: "https://zc-demo-shop.zudolab.dev" },
            { label: "Orrery", href: "https://zc-demo-landing.zudolab.dev" },
            { label: "Margin Notes", href: "https://zc-demo-blog.zudolab.dev" },
            { label: "Sample Studio editor", href: "https://zc-demo-sample-editor.zudolab.dev" },
            { label: "Nightjar Supply editor", href: "https://zc-demo-shop-editor.zudolab.dev" },
            { label: "Orrery editor", href: "https://zc-demo-landing-editor.zudolab.dev" },
            { label: "Margin Notes editor", href: "https://zc-demo-blog-editor.zudolab.dev" },
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
