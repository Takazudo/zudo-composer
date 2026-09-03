// Inline 16px line-icon sprite. Injected at load so <use href="#i-…"> works from file://.
const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
<symbol id="i-home" viewBox="0 0 16 16"><path d="M2.5 7.5 8 3l5.5 4.5V13a1 1 0 0 1-1 1h-3v-4H6.5v4h-3a1 1 0 0 1-1-1z"/></symbol>
<symbol id="i-composer" viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M6 6.5v7"/></symbol>
<symbol id="i-content" viewBox="0 0 16 16"><path d="M4 2h5.5L13 5.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M9 2v4h4M5.5 8.5h5M5.5 11h5"/></symbol>
<symbol id="i-mapping" viewBox="0 0 16 16"><circle cx="4" cy="4" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="12" cy="4" r="1.75"/><path d="M5.75 4h4.5M12 5.75v4.5"/></symbol>
<symbol id="i-sitemap" viewBox="0 0 16 16"><rect x="5.5" y="1.5" width="5" height="3.5" rx=".8"/><rect x="1.5" y="11" width="4.5" height="3.5" rx=".8"/><rect x="10" y="11" width="4.5" height="3.5" rx=".8"/><path d="M8 5v3M3.75 11V8h8.5v3"/></symbol>
<symbol id="i-media" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.25"/><path d="m14 10.5-3.5-3.5L4 13.5"/></symbol>
<symbol id="i-search" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/></symbol>
<symbol id="i-plus" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></symbol>
<symbol id="i-minus" viewBox="0 0 16 16"><path d="M3 8h10"/></symbol>
<symbol id="i-x" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8"/></symbol>
<symbol id="i-check" viewBox="0 0 16 16"><path d="m3 8.5 3 3 7-7"/></symbol>
<symbol id="i-check-circle" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="m5.25 8.25 2 2 3.5-4"/></symbol>
<symbol id="i-alert" viewBox="0 0 16 16"><path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.5v.01"/></symbol>
<symbol id="i-alert-circle" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11v.01"/></symbol>
<symbol id="i-info" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 7.5V11M8 5v.01"/></symbol>
<symbol id="i-trash" viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2M6.5 7v4M9.5 7v4"/></symbol>
<symbol id="i-copy" viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></symbol>
<symbol id="i-duplicate" viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2M9.5 7.75v3.5M7.75 9.5h3.5"/></symbol>
<symbol id="i-more" viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12.5" cy="8" r="1" fill="currentColor"/></symbol>
<symbol id="i-more-v" viewBox="0 0 16 16"><circle cx="8" cy="3.5" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="12.5" r="1" fill="currentColor"/></symbol>
<symbol id="i-chev-r" viewBox="0 0 16 16"><path d="m6 4 4 4-4 4"/></symbol>
<symbol id="i-chev-d" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></symbol>
<symbol id="i-chev-u" viewBox="0 0 16 16"><path d="m4 10 4-4 4 4"/></symbol>
<symbol id="i-chev-l" viewBox="0 0 16 16"><path d="m10 4-4 4 4 4"/></symbol>
<symbol id="i-arrow-r" viewBox="0 0 16 16"><path d="M3 8h10M9 4l4 4-4 4"/></symbol>
<symbol id="i-arrow-l" viewBox="0 0 16 16"><path d="M13 8H3M7 4 3 8l4 4"/></symbol>
<symbol id="i-undo" viewBox="0 0 16 16"><path d="M6 4 3 7l3 3"/><path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H7"/></symbol>
<symbol id="i-redo" viewBox="0 0 16 16"><path d="m10 4 3 3-3 3"/><path d="M13 7H6.5a3.5 3.5 0 0 0 0 7H9"/></symbol>
<symbol id="i-download" viewBox="0 0 16 16"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13h10"/></symbol>
<symbol id="i-upload" viewBox="0 0 16 16"><path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M3 13h10"/></symbol>
<symbol id="i-eye" viewBox="0 0 16 16"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></symbol>
<symbol id="i-edit" viewBox="0 0 16 16"><path d="m10.5 3 2.5 2.5L6 12.5H3.5V10z"/></symbol>
<symbol id="i-save" viewBox="0 0 16 16"><path d="M3 3h8l2 2v8H3z"/><path d="M5 3v3.5h5V3M5 13V9.5h6V13"/></symbol>
<symbol id="i-refresh" viewBox="0 0 16 16"><path d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5"/><path d="M11 2v3h-3M5 14v-3h3"/></symbol>
<symbol id="i-settings" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2"/><path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1"/></symbol>
<symbol id="i-filter" viewBox="0 0 16 16"><path d="M2.5 3.5h11L9.5 8.5v4l-3 1.5v-5.5z"/></symbol>
<symbol id="i-sort" viewBox="0 0 16 16"><path d="M3 4.5h10M5 8h6M7 11.5h2"/></symbol>
<symbol id="i-grid" viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx=".8"/><rect x="9" y="2.5" width="4.5" height="4.5" rx=".8"/><rect x="2.5" y="9" width="4.5" height="4.5" rx=".8"/><rect x="9" y="9" width="4.5" height="4.5" rx=".8"/></symbol>
<symbol id="i-list" viewBox="0 0 16 16"><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" stroke-width="1.8"/></symbol>
<symbol id="i-grip" viewBox="0 0 16 16"><circle cx="6" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="6" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="6" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="12" r=".9" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-folder" viewBox="0 0 16 16"><path d="M2 4.5a1 1 0 0 1 1-1h3.5l1.5 1.5H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></symbol>
<symbol id="i-file" viewBox="0 0 16 16"><path d="M4 2h5.5L13 5.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M9 2v4h4"/></symbol>
<symbol id="i-file-pdf" viewBox="0 0 16 16"><path d="M4 2h5.5L13 5.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M9 2v4h4M5.5 11.5V8.5h1.25a1 1 0 0 1 0 2H5.5"/></symbol>
<symbol id="i-text" viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h6"/></symbol>
<symbol id="i-long-text" viewBox="0 0 16 16"><path d="M3 3.5h10M3 6.5h10M3 9.5h10M3 12.5h6"/></symbol>
<symbol id="i-markdown" viewBox="0 0 16 16"><rect x="1.5" y="3.5" width="13" height="9" rx="1.2"/><path d="M4 10.5V6l2 2.25L8 6v4.5M11 6v4.5M9.5 9l1.5 1.5L12.5 9"/></symbol>
<symbol id="i-number" viewBox="0 0 16 16"><path d="M6 2.5 5 13.5M11 2.5l-1 11M2.5 6h11M2.5 10h11"/></symbol>
<symbol id="i-boolean" viewBox="0 0 16 16"><rect x="1.5" y="4.5" width="13" height="7" rx="3.5"/><circle cx="10.5" cy="8" r="2" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-date" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="11" rx="1.2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></symbol>
<symbol id="i-slug" viewBox="0 0 16 16"><path d="m3 9.5 4-4a2 2 0 0 1 3 3l-.5.5"/><path d="m13 6.5-4 4a2 2 0 0 1-3-3l.5-.5"/></symbol>
<symbol id="i-color" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 2v12M2 8h12" opacity=".5"/><circle cx="8" cy="8" r="2.25" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-link" viewBox="0 0 16 16"><path d="M6.5 9.5a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-1 1"/><path d="M9.5 6.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 0 0 4.24 4.24l1-1"/></symbol>
<symbol id="i-image" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.25"/><path d="m14 10.5-3.5-3.5L4 13.5"/></symbol>
<symbol id="i-bold" viewBox="0 0 16 16"><path d="M5 3h4a2.25 2.25 0 0 1 0 4.5H5zM5 7.5h4.75a2.5 2.5 0 0 1 0 5H5z" stroke-width="1.8"/></symbol>
<symbol id="i-italic" viewBox="0 0 16 16"><path d="M7 3h5M4 13h5M9.5 3l-3 10"/></symbol>
<symbol id="i-code" viewBox="0 0 16 16"><path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/></symbol>
<symbol id="i-heading" viewBox="0 0 16 16"><path d="M4 3v10M12 3v10M4 8h8"/></symbol>
<symbol id="i-quote" viewBox="0 0 16 16"><path d="M4 10.5c-1.2 0-2-.9-2-2V6a2 2 0 0 1 2-2h1v4.5c0 1.2-.8 2-2 2zM11 10.5c-1.2 0-2-.9-2-2V6a2 2 0 0 1 2-2h1v4.5c0 1.2-.8 2-2 2z"/></symbol>
<symbol id="i-list-ul" viewBox="0 0 16 16"><path d="M6 4h8M6 8h8M6 12h8"/><circle cx="3" cy="4" r=".8" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r=".8" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-expand" viewBox="0 0 16 16"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5l-4 4M2.5 13.5l4-4"/></symbol>
<symbol id="i-play" viewBox="0 0 16 16"><path d="M5 3.25v9.5L12.75 8z" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-bell" viewBox="0 0 16 16"><path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 14h3"/></symbol>
<symbol id="i-sun" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.75"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></symbol>
<symbol id="i-moon" viewBox="0 0 16 16"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/></symbol>
<symbol id="i-monitor" viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2"/><path d="M5.5 14h5M8 11v3"/></symbol>
<symbol id="i-external" viewBox="0 0 16 16"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/></symbol>
<symbol id="i-database" viewBox="0 0 16 16"><ellipse cx="8" cy="4" rx="5.5" ry="2"/><path d="M2.5 4v8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V4M2.5 8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2"/></symbol>
<symbol id="i-layers" viewBox="0 0 16 16"><path d="m8 2.5 6 3-6 3-6-3z"/><path d="m2 8.5 6 3 6-3M2 11.5l6 3 6-3"/></symbol>
<symbol id="i-box" viewBox="0 0 16 16"><path d="m8 1.75 5.5 3v6.5l-5.5 3-5.5-3v-6.5z"/><path d="M2.5 4.75 8 7.75l5.5-3M8 7.75v6.5"/></symbol>
<symbol id="i-container" viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><rect x="4.5" y="5" width="7" height="6" rx=".8" stroke-dasharray="1.5 1.5"/></symbol>
<symbol id="i-slot" viewBox="0 0 16 16"><rect x="2.5" y="4" width="11" height="8" rx="1" stroke-dasharray="2 1.5"/><path d="M8 6.5v3M6.5 8h3"/></symbol>
<symbol id="i-leaf" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="M5.5 8h5"/></symbol>
<symbol id="i-split" viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M8 2.5v11"/></symbol>
<symbol id="i-sidebar-l" viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11"/></symbol>
<symbol id="i-sidebar-r" viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M10 2.5v11"/></symbol>
<symbol id="i-collection" viewBox="0 0 16 16"><rect x="3" y="5" width="10" height="9" rx="1.2"/><path d="M5 5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V5"/><path d="M5.5 8.5h5M5.5 11h5"/></symbol>
<symbol id="i-single" viewBox="0 0 16 16"><rect x="3" y="2.5" width="10" height="11" rx="1.2"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3"/></symbol>
<symbol id="i-page" viewBox="0 0 16 16"><rect x="2.5" y="2" width="11" height="12" rx="1.2"/><path d="M2.5 5h11"/></symbol>
<symbol id="i-clock" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></symbol>
<symbol id="i-cloud-off" viewBox="0 0 16 16"><path d="M4.5 12.5H4a2.5 2.5 0 0 1-.5-4.95A4 4 0 0 1 10.9 6M12 8.5a2.25 2.25 0 0 1 .5 4H8"/><path d="m2.5 2.5 11 11"/></symbol>
<symbol id="i-history" viewBox="0 0 16 16"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2.5 2.5v3h3M8 5v3.25L10.25 9.5"/></symbol>
<symbol id="i-help" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M6.25 6.25a1.75 1.75 0 1 1 2.5 1.6c-.5.3-.75.65-.75 1.15M8 11.5v.01"/></symbol>
<symbol id="i-command" viewBox="0 0 16 16"><path d="M5.5 5.5h5v5h-5z"/><path d="M5.5 5.5H4a1.5 1.5 0 1 1 1.5-1.5zM10.5 5.5H12a1.5 1.5 0 1 0-1.5-1.5zM5.5 10.5H4A1.5 1.5 0 1 0 5.5 12zM10.5 10.5H12a1.5 1.5 0 1 1-1.5 1.5z"/></symbol>
<symbol id="i-map-pin" viewBox="0 0 16 16"><path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14z"/><circle cx="8" cy="6.5" r="1.5"/></symbol>
<symbol id="i-type" viewBox="0 0 16 16"><path d="M3 4.5V3h10v1.5M8 3v10M6 13h4"/></symbol>
<symbol id="i-unlink" viewBox="0 0 16 16"><path d="M6.5 9.5a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-1 1"/><path d="M9.5 6.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 0 0 4.24 4.24l1-1"/><path d="m2.5 2.5 11 11" stroke-width="1.2"/></symbol>
<symbol id="i-git" viewBox="0 0 16 16"><circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7a4 4 0 0 1-4 4h-1"/></symbol>
</svg>`;
document.addEventListener("DOMContentLoaded", () => {
  const wrap = document.createElement("div");
  wrap.innerHTML = SPRITE;
  document.body.prepend(wrap.firstElementChild);
});
