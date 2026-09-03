// Injects the shared rail (sidebar / top-nav) and the prototype control widget.
// Pages only author <div class="frame"> … </div>. Counts are sample data.
(() => {
  const NAV = [
    { route: "home", href: "01-dashboard.html", icon: "i-home", label: "Dashboard" },
    { section: "Author" },
    { route: "content", href: "04-content-editor.html", icon: "i-content", label: "Content", count: "2 models" },
    { route: "media", href: "07-media-library.html", icon: "i-media", label: "Media", count: "14" },
    { section: "Structure" },
    { route: "composer", href: "02-library.html", icon: "i-composer", label: "Compositions", count: "6" },
    { route: "mapping", href: "05-mapping-editor.html", icon: "i-mapping", label: "Mappings", count: "3" },
    { route: "sitemapper", href: "06-sitemapper-editor.html", icon: "i-sitemap", label: "Sitemaps", count: "2" },
  ];
  const icon = (id, cls = "i") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const rail = `
<aside class="rail" aria-label="Workspace navigation">
  <a class="rail__brand" href="index.html"><span class="logo">Z</span><span>zudo-composer</span></a>
  <nav class="rail__nav">
    ${NAV.map((n) => n.section ? `<div class="rail__section">${n.section}</div>` : `<a class="rail__item" href="${n.href}" data-route="${n.route}">${icon(n.icon)}<span>${n.label}</span>${n.count ? `<span class="count">${n.count}</span>` : ""}</a>`).join("")}
  </nav>
  <div class="rail__spacer"></div>
  <div class="rail__topstatus">${icon("i-database", "i i-sm")}<span>Browser storage</span></div>
  <div class="rail__foot">
    <div class="rail__status" title="Active provider">${icon("i-database")}<span><strong>Browser storage</strong>IndexedDB · zudo-composer</span></div>
    <button class="btn btn--ghost btn--icon rail__collapse" data-rail-toggle aria-label="Collapse navigation" style="color:var(--rail-muted)">${icon("i-sidebar-l")}</button>
  </div>
</aside>`;
  const controls = `
<div class="proto-controls" aria-label="Prototype controls">
  <span class="lbl">Nav</span>
  <div class="seg seg--sm"><button data-shell-opt="side" aria-pressed="true">Sidebar</button><button data-shell-opt="top" aria-pressed="false">Top</button></div>
  <span class="lbl">Theme</span>
  <div class="seg seg--sm"><button data-theme-opt="light" aria-pressed="true">Light</button><button data-theme-opt="dark" aria-pressed="false">Dark</button></div>
  <a href="index.html">Index</a>
</div>`;
  document.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("shell");
    document.body.insertAdjacentHTML("afterbegin", rail);
    document.body.insertAdjacentHTML("beforeend", controls);
  }, { once: true });
})();
