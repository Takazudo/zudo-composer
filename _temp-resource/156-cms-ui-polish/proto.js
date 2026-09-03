// Prototype behaviours: shell variant, theme, rail collapse, menus, tabs, panes, dialogs.
(() => {
  const root = document.documentElement;
  const KEY = "zc-proto";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const save = (p) => { try { localStorage.setItem(KEY, JSON.stringify({ ...load(), ...p })); } catch {} };
  const prefs = load();

  const applyShell = (v) => { document.body.classList.toggle("shell--side", v !== "top"); document.body.classList.toggle("shell--top", v === "top"); document.querySelectorAll("[data-shell-opt]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.shellOpt === (v || "side")))); };
  const applyTheme = (t) => { root.setAttribute("data-theme", t === "dark" ? "dark" : "light"); document.querySelectorAll("[data-theme-opt]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeOpt === (t || "light")))); };
  const applyRail = (c) => { document.body.classList.toggle("rail-collapsed", !!c); };

  document.addEventListener("DOMContentLoaded", () => {
    applyShell(prefs.shell); applyTheme(prefs.theme); applyRail(prefs.rail);
    document.querySelectorAll("[data-shell-opt]").forEach((b) => b.addEventListener("click", () => { save({ shell: b.dataset.shellOpt }); applyShell(b.dataset.shellOpt); }));
    document.querySelectorAll("[data-theme-opt]").forEach((b) => b.addEventListener("click", () => { save({ theme: b.dataset.themeOpt }); applyTheme(b.dataset.themeOpt); }));
    document.querySelectorAll("[data-rail-toggle]").forEach((b) => b.addEventListener("click", () => { const c = !document.body.classList.contains("rail-collapsed"); save({ rail: c }); applyRail(c); }));

    // popover menus: <button data-menu="id"> toggles #id
    document.querySelectorAll("[data-menu]").forEach((b) => {
      b.setAttribute("aria-haspopup", "menu"); b.setAttribute("aria-expanded", "false");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const m = document.getElementById(b.dataset.menu); if (!m) return;
        const open = m.dataset.open === "true";
        closeMenus();
        if (!open) { m.dataset.open = "true"; b.setAttribute("aria-expanded", "true"); }
      });
    });
    const closeMenus = () => { document.querySelectorAll(".menu[data-open='true']").forEach((m) => { m.dataset.open = "false"; }); document.querySelectorAll("[data-menu][aria-expanded='true']").forEach((b) => b.setAttribute("aria-expanded", "false")); };
    document.addEventListener("click", closeMenus);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMenus(); closeDialogs(); } });

    // tabs: [data-tabs] > button[data-tab=x] ; panels [data-panel=x] within closest [data-tabset]
    document.querySelectorAll("[data-tabs]").forEach((tl) => {
      const set = tl.closest("[data-tabset]") || document;
      tl.querySelectorAll("[data-tab]").forEach((t) => t.addEventListener("click", () => {
        tl.querySelectorAll("[data-tab]").forEach((x) => { x.setAttribute("aria-selected", "false"); x.setAttribute("aria-pressed", "false"); });
        t.setAttribute("aria-selected", "true"); t.setAttribute("aria-pressed", "true");
        set.querySelectorAll("[data-panel]").forEach((p) => { if ((p.closest("[data-tabset]") || document) !== set) return; p.hidden = p.dataset.panel !== t.dataset.tab; });
      }));
    });

    // selectable rows
    document.querySelectorAll("[data-selectable]").forEach((group) => {
      group.querySelectorAll("[aria-selected]").forEach((r) => r.addEventListener("click", (e) => {
        if (e.target.closest("button, a, input")) return;
        group.querySelectorAll("[aria-selected]").forEach((x) => x.setAttribute("aria-selected", "false"));
        r.setAttribute("aria-selected", "true");
      }));
    });

    // tree expand toggles
    document.querySelectorAll(".tree-row[aria-expanded] .tw").forEach((tw) => tw.addEventListener("click", (e) => {
      e.stopPropagation(); const row = tw.closest(".tree-row"); const open = row.getAttribute("aria-expanded") === "true";
      row.setAttribute("aria-expanded", String(!open));
      const depth = +row.dataset.depth || 0; let n = row.nextElementSibling;
      while (n && (+n.dataset.depth || 0) > depth) { n.hidden = open ? true : !(+n.dataset.depth === depth + 1); if (!open && +n.dataset.depth === depth + 1) n.setAttribute("aria-expanded", n.hasAttribute("aria-expanded") ? "false" : ""); n = n.nextElementSibling; }
    }));

    // pane collapse buttons + narrow pane switch
    document.querySelectorAll("[data-collapse]").forEach((b) => b.addEventListener("click", () => { const body = b.closest(".editor")?.querySelector(".editor__body"); body?.classList.toggle(b.dataset.collapse + "-collapsed"); }));
    document.querySelectorAll("[data-pane-switch]").forEach((sw) => sw.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      sw.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", "true");
      const body = sw.closest(".editor")?.querySelector(".editor__body"); body?.querySelectorAll(".pane").forEach((p) => { p.dataset.paneActive = String(p.dataset.pane === b.dataset.paneTarget); });
    })));

    // resizers (simple pointer drag of CSS vars on the editor body)
    document.querySelectorAll(".resizer[data-resize]").forEach((r) => {
      r.addEventListener("pointerdown", (e) => {
        const body = r.closest(".editor__body"); const side = r.dataset.resize; const startX = e.clientX;
        const cs = getComputedStyle(body); const start = parseFloat(cs.getPropertyValue(side === "nav" ? "--nav-w" : "--insp-w")) || (side === "nav" ? 280 : 300);
        const move = (ev) => { const d = ev.clientX - startX; const v = Math.max(200, Math.min(520, side === "nav" ? start + d : start - d)); body.style.setProperty(side === "nav" ? "--nav-w" : "--insp-w", v + "px"); };
        const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); e.preventDefault();
      });
    });

    // dialogs: [data-dialog="id"] opens .overlay#id ; [data-dialog-close]
    const closeDialogs = () => document.querySelectorAll(".overlay[data-open='true']").forEach((o) => { o.dataset.open = "false"; });
    document.querySelectorAll("[data-dialog]").forEach((b) => b.addEventListener("click", () => { const o = document.getElementById(b.dataset.dialog); if (o) o.dataset.open = "true"; }));
    document.querySelectorAll("[data-dialog-close]").forEach((b) => b.addEventListener("click", closeDialogs));
    document.querySelectorAll(".overlay").forEach((o) => o.addEventListener("click", (e) => { if (e.target === o) closeDialogs(); }));

    // proto note dismiss
    document.querySelectorAll(".proto-note .close").forEach((b) => b.addEventListener("click", () => { b.closest(".proto-note").hidden = true; }));

    // outline tree: toggles, collapse/open all, show slug/count
    const setOpen = (owner, open) => { const t = owner.querySelector(":scope > .ztree-cat__row > .ztree-toggle, :scope > .ztree-group__header > .ztree-toggle"); const ch = owner.querySelector(":scope > .ztree-children"); if (t) t.setAttribute("aria-expanded", String(open)); if (ch) ch.hidden = !open; owner.setAttribute("aria-expanded", String(open)); };
    document.querySelectorAll(".ztree-toggle").forEach((t) => t.addEventListener("click", (e) => { e.stopPropagation(); const owner = t.closest(".ztree-cat, .ztree-group"); if (owner) setOpen(owner, t.getAttribute("aria-expanded") !== "true"); }));
    document.querySelectorAll("[data-ztree-all]").forEach((b) => b.addEventListener("click", () => { const tree = b.closest(".ztree"); tree?.querySelectorAll(".ztree-cat, .ztree-group").forEach((o) => setOpen(o, b.dataset.ztreeAll === "open")); }));
    document.querySelectorAll("[data-ztree-show]").forEach((sw) => { const apply = () => sw.closest(".ztree")?.classList.toggle("show-" + sw.dataset.ztreeShow, sw.checked); sw.addEventListener("change", apply); apply(); });
    // insert-between affordance: one .ztree-insert between every pair of sibling rows
    document.querySelectorAll(".ztree .ztree-children").forEach((ch) => {
      const depth = ch.style.getPropertyValue("--depth") || "1";
      const rows = [...ch.children].filter((n) => n.matches(".ztree-leaf-wrap, .ztree-group"));
      rows.slice(1).forEach((row) => { if (row.previousElementSibling?.classList.contains("ztree-insert")) return; const ins = document.createElement("div"); ins.className = "ztree-insert"; ins.style.setProperty("--depth", depth); ins.innerHTML = '<span class="ztree-insert__hit" aria-hidden="true"></span><button class="ztree-insert__btn" type="button" aria-label="Insert here"><svg class="i i-sm"><use href="#i-plus"/></svg></button>'; row.before(ins); });
    });
    // inline title editor for insert buttons and Add rows (prototype: creates a plain leaf)
    const openInline = (anchor, depth, placeholder, onDone, mode = "after") => {
      const host = mode === "inside" ? anchor : anchor.parentElement;
      if (host.querySelector(":scope > .ztree-inline")) return;
      const row = document.createElement("div"); row.className = "ztree-inline"; row.style.setProperty("--depth", depth);
      row.innerHTML = '<input class="input" placeholder="' + placeholder + '" aria-label="' + placeholder + '"><button class="btn btn--primary btn--sm" type="button">Add</button><button class="btn btn--ghost btn--sm" type="button">Cancel</button>';
      if (mode === "inside") { anchor.appendChild(row); anchor.classList.add("is-active"); } else anchor.after(row);
      const input = row.querySelector("input"); input.focus();
      const close = () => { row.remove(); anchor.classList.remove("is-active"); };
      const commit = () => { const v = input.value.trim(); if (v) onDone(v, row); close(); };
      row.querySelector(".btn--primary").addEventListener("click", commit); row.querySelector(".btn--ghost").addEventListener("click", close);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") close(); });
    };
    const makeLeaf = (title, depth) => { const w = document.createElement("div"); w.className = "ztree-leaf-wrap"; w.style.setProperty("--depth", depth); w.innerHTML = '<span class="ztree-vline"></span><span class="ztree-hline"></span><button class="ztree-leaf" role="treeitem" aria-selected="false"><span class="truncate"></span><span class="ztree-slug"></span></button>'; w.querySelector(".truncate").textContent = title; w.querySelector(".ztree-slug").textContent = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); return w; };
    document.querySelectorAll(".ztree-insert__btn").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); const ins = b.closest(".ztree-insert"); const depth = ins.style.getPropertyValue("--depth") || "1"; openInline(ins, depth, "Title of the new item", (v) => { const leaf = makeLeaf(v, depth); ins.after(leaf); const gap = ins.cloneNode(true); gap.classList.remove("is-active"); leaf.before(gap); gap.querySelector("button").addEventListener("click", (ev) => { ev.stopPropagation(); openInline(gap, depth, "Title of the new item", (t) => gap.after(makeLeaf(t, depth)), "inside"); }); }, "inside"); }));
    document.querySelectorAll(".ztree-add").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); const wrap = b.closest(".ztree-add-wrap"); const depth = wrap.style.getPropertyValue("--depth") || "1"; wrap.hidden = true; openInline(wrap, depth, b.textContent.trim().replace(/^Add /, "New ") + " title", (v) => { const leaf = makeLeaf(v, depth); wrap.before(leaf); }); const obs = new MutationObserver(() => { if (!wrap.parentElement.querySelector(":scope > .ztree-inline")) { wrap.hidden = false; obs.disconnect(); } }); obs.observe(wrap.parentElement, { childList: true }); }));

    document.querySelectorAll(".ztree[data-selectable]").forEach((tree) => tree.querySelectorAll(".ztree-leaf, .ztree-cat__row, .ztree-group__row").forEach((r) => r.addEventListener("click", (e) => { if (e.target.closest(".ztree-toggle, .ztree-acts, .switch")) return; tree.querySelectorAll("[aria-selected]").forEach((x) => x.setAttribute("aria-selected", "false")); r.setAttribute("aria-selected", "true"); })));

    // tables scroll inside their own wrapper on narrow screens
    document.querySelectorAll('table.table').forEach((t) => { if (t.parentElement.classList.contains('table-wrap')) return; const w = document.createElement('div'); w.className = 'table-wrap'; t.replaceWith(w); w.appendChild(t); });

    // active nav highlight from data-route on body
    const route = document.body.dataset.route;
    if (route) document.querySelectorAll(`.rail__item[data-route="${route}"]`).forEach((a) => a.setAttribute("aria-current", "page"));
  });
})();
