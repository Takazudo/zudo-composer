import { blur, grain, grainLayer, linear, radial, range, shadow, svg } from "./svg.mjs";

export const demo = { name: "webshop", dir: "packages/demo-webshop/images-src", manifestPath: "packages/demo-webshop/images-src/manifest.json" };

const S = 1200;

// Studio stage: matte black ground, single soft key light from the upper left.
function stage(width, height, extraDefs, body) {
  const defs = radial("key", [[0, "#3a3835"], [0.45, "#161514"], [1, "#050505"]], { cx: 0.22, cy: 0.12, r: 0.95 })
    + linear("floor", [[0, "#000", 0], [1, "#000", 0.55]])
    + linear("brass", [[0, "#f3d58a"], [0.35, "#c79a45"], [0.7, "#8a6326"], [1, "#4f3812"]], { x2: 1, y2: 1 })
    + linear("steel", [[0, "#f2f2f0"], [0.5, "#9c9c98"], [1, "#3c3c3a"]], { x2: 1, y2: 0.4 })
    + linear("matte", [[0, "#3b3b3b"], [0.5, "#1a1a1a"], [1, "#0c0c0c"]], { x2: 1, y2: 1 })
    + blur("soft", 18) + blur("glow", 40) + blur("rim", 3) + grain("grain", 0.09)
    + extraDefs;
  return svg(width, height, defs,
    `<rect width="${width}" height="${height}" fill="url(#key)"/><rect y="${height * 0.55}" width="${width}" height="${height * 0.45}" fill="url(#floor)"/>${body}${grainLayer(width, height)}`);
}

const product = (file, alt, body, extraDefs = "", use = "product image") => ({
  file, alt, use, aspect: "1:1", width: S, height: S, svg: stage(S, S, extraDefs, body),
});

const linenDefs = `<pattern id="linen" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#34363a"/><path d="M0 1h6M0 4h6" stroke="#2a2c2f" stroke-width="1"/><path d="M1 0v6M4 0v6" stroke="#3d3f43" stroke-width="0.8"/></pattern>`;
const dotsDefs = `<pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="1.6" fill="#b9b3a6"/></pattern>`;

function closedNotebook(x, y, w, h, rotate = -8) {
  return `<g transform="rotate(${rotate} ${x + w / 2} ${y + h / 2})">`
    + shadow(x + w / 2 + 30, y + h + 10, w * 0.55, 40, 0.8)
    + `<rect x="${x + 10}" y="${y + 8}" width="${w}" height="${h}" rx="10" fill="#d8d0c0"/>`
    + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="url(#linen)"/>`
    + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="url(#matte)" opacity="0.45"/>`
    + `<rect x="${x + w - 70}" y="${y - 4}" width="22" height="${h + 8}" rx="4" fill="#070707"/>`
    + `<path d="M${x + 6} ${y + 10}v${h - 20}" stroke="#5a5c60" stroke-width="3" opacity="0.6" filter="url(#rim)"/></g>`;
}

function pen(x, y, length, rotate, { capped = true } = {}) {
  const body = `<rect x="${x}" y="${y}" width="${length * 0.62}" height="54" rx="27" fill="url(#matte)"/>`
    + `<rect x="${x + 20}" y="${y + 8}" width="${length * 0.55}" height="6" rx="3" fill="#6d6d6d" opacity="0.7"/>`;
  const cap = capped
    ? `<rect x="${x + length * 0.55}" y="${y - 3}" width="${length * 0.45}" height="60" rx="30" fill="url(#matte)"/><rect x="${x + length * 0.6}" y="${y - 14}" width="${length * 0.3}" height="12" rx="6" fill="#111" stroke="#444" stroke-width="2"/><rect x="${x + length * 0.6}" y="${y + 6}" width="${length * 0.35}" height="5" rx="2.5" fill="#777" opacity="0.6"/>`
    : `<rect x="${x + length * 0.58}" y="${y + 9}" width="${length * 0.1}" height="36" rx="10" fill="#151515"/><path d="M${x + length * 0.67} ${y + 7}L${x + length * 0.86} ${y + 27}L${x + length * 0.67} ${y + 47}Z" fill="url(#steel)"/><path d="M${x + length * 0.72} ${y + 27}H${x + length * 0.86}" stroke="#222" stroke-width="2"/><circle cx="${x + length * 0.72}" cy="${y + 27}" r="4" fill="#222"/>`;
  return `<g transform="rotate(${rotate} ${x + length / 2} ${y + 27})">${shadow(x + length / 2, y + 80, length * 0.5, 22, 0.85)}${body}${cap}</g>`;
}

function lamp(cx, baseY, { lit, withChimney = true }) {
  let out = shadow(cx, baseY + 10, 230, 30, 0.9);
  out += `<path d="M${cx - 190} ${baseY}Q${cx - 200} ${baseY - 40} ${cx - 150} ${baseY - 60}H${cx + 150}Q${cx + 200} ${baseY - 40} ${cx + 190} ${baseY}Z" fill="url(#brass)"/>`;
  out += `<ellipse cx="${cx}" cy="${baseY - 62}" rx="150" ry="22" fill="#b88a3c"/>`;
  out += `<path d="M${cx - 120} ${baseY - 70}C${cx - 170} ${baseY - 200} ${cx - 110} ${baseY - 300} ${cx - 60} ${baseY - 320}H${cx + 60}C${cx + 110} ${baseY - 300} ${cx + 170} ${baseY - 200} ${cx + 120} ${baseY - 70}Z" fill="url(#brass)"/>`;
  out += `<path d="M${cx - 95} ${baseY - 110}C${cx - 125} ${baseY - 200} ${cx - 90} ${baseY - 280} ${cx - 55} ${baseY - 300}" stroke="#fff3c4" stroke-width="10" fill="none" opacity="0.5" filter="url(#rim)"/>`;
  out += `<rect x="${cx - 75}" y="${baseY - 360}" width="150" height="44" rx="8" fill="url(#brass)"/>`;
  out += `<rect x="${cx + 70}" y="${baseY - 345}" width="40" height="14" rx="7" fill="#8a6326"/>`;
  if (lit) {
    out += `<circle cx="${cx}" cy="${baseY - 470}" r="220" fill="#ffb34d" opacity="0.28" filter="url(#glow)"/>`;
    out += `<path d="M${cx} ${baseY - 560}C${cx + 34} ${baseY - 490} ${cx + 30} ${baseY - 410} ${cx} ${baseY - 390}C${cx - 30} ${baseY - 410} ${cx - 34} ${baseY - 490} ${cx} ${baseY - 560}Z" fill="#ffd27a"/>`;
    out += `<path d="M${cx} ${baseY - 500}C${cx + 14} ${baseY - 460} ${cx + 12} ${baseY - 420} ${cx} ${baseY - 405}C${cx - 12} ${baseY - 420} ${cx - 14} ${baseY - 460} ${cx} ${baseY - 500}Z" fill="#fff6dc"/>`;
  } else {
    out += `<rect x="${cx - 6}" y="${baseY - 395}" width="12" height="36" rx="3" fill="#e8e2d2"/>`;
  }
  if (withChimney) out += chimney(cx, baseY - 360);
  return out;
}

function chimney(cx, bottomY) {
  return `<path d="M${cx - 70} ${bottomY}C${cx - 70} ${bottomY - 60} ${cx - 120} ${bottomY - 120} ${cx - 120} ${bottomY - 200}C${cx - 120} ${bottomY - 280} ${cx - 60} ${bottomY - 310} ${cx - 55} ${bottomY - 380}H${cx + 55}C${cx + 60} ${bottomY - 310} ${cx + 120} ${bottomY - 280} ${cx + 120} ${bottomY - 200}C${cx + 120} ${bottomY - 120} ${cx + 70} ${bottomY - 60} ${cx + 70} ${bottomY}Z" fill="#dfe8ec" fill-opacity="0.12" stroke="#f4fbff" stroke-opacity="0.45" stroke-width="3"/>`
    + `<path d="M${cx - 90} ${bottomY - 150}C${cx - 100} ${bottomY - 230} ${cx - 60} ${bottomY - 290} ${cx - 45} ${bottomY - 350}" stroke="#fff" stroke-opacity="0.55" stroke-width="7" fill="none" filter="url(#rim)"/>`;
}

function paperClip(x, y, rotate) {
  return `<path transform="rotate(${rotate} ${x} ${y})" d="M${x} ${y}v-90a22 22 0 0 1 44 0v110a30 30 0 0 1-60 0v-100" fill="none" stroke="url(#steel)" stroke-width="6" stroke-linecap="round"/>`;
}

function candle(x, baseY, width, height) {
  return `<rect x="${x}" y="${baseY - height}" width="${width}" height="${height}" fill="url(#ivory)"/>`
    + `<ellipse cx="${x + width / 2}" cy="${baseY}" rx="${width / 2}" ry="${width * 0.14}" fill="#c9c0ad"/>`
    + `<ellipse cx="${x + width / 2}" cy="${baseY - height}" rx="${width / 2}" ry="${width * 0.14}" fill="#f6f0e2"/>`
    + `<ellipse cx="${x + width / 2}" cy="${baseY - height + 3}" rx="${width / 2 - 12}" ry="${width * 0.09}" fill="#e2d9c6"/>`
    + `<path d="M${x + width / 2} ${baseY - height}q4 -18 -2 -34" stroke="#1d1d1d" stroke-width="5" fill="none" stroke-linecap="round"/>`;
}

const ivoryDefs = linear("ivory", [[0, "#fffaf0"], [0.4, "#ece3cf"], [1, "#8f866f"]], { x2: 1, y2: 0 });
const leatherDefs = linear("leather", [[0, "#3a3531"], [0.45, "#1b1917"], [1, "#0a0909"]], { x2: 1, y2: 1 })
  + `<pattern id="pebble" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.2" fill="#000" opacity="0.35"/><circle cx="7" cy="7" r="1" fill="#fff" opacity="0.04"/></pattern>`;
const canvasDefs = linear("wax", [[0, "#34332f"], [0.5, "#181816"], [1, "#0a0a09"]], { x2: 0.8, y2: 1 })
  + `<pattern id="weave" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 2.5h5M2.5 0v5" stroke="#000" stroke-width="0.9" opacity="0.35"/></pattern>`;
const capeDefs = linear("cape", [[0, "#4a4b4d"], [0.5, "#2a2b2d"], [1, "#151617"]], { x2: 1, y2: 1 });

function hero() {
  const W = 1600, H = 900;
  const defs = linenDefs + linear("walnut", [[0, "#3b2618"], [0.5, "#24160d"], [1, "#0d0805"]])
    + `<pattern id="grainWood" width="400" height="40" patternUnits="userSpaceOnUse"><path d="M0 12c80-6 160 6 240 0s120-4 160 2M0 30c100 4 180-6 260-2s100 6 140 0" stroke="#000" stroke-opacity="0.35" stroke-width="2" fill="none"/></pattern>`;
  let body = `<path d="M0 560H1600V900H0Z" fill="url(#walnut)"/><path d="M0 560H1600V900H0Z" fill="url(#grainWood)"/><path d="M0 560H1600" stroke="#6b4a31" stroke-width="3" opacity="0.6"/>`;
  body += `<circle cx="470" cy="330" r="420" fill="#ffae45" opacity="0.2" filter="url(#glow)"/>`;
  body += `<ellipse cx="560" cy="640" rx="520" ry="120" fill="#ffae45" opacity="0.16" filter="url(#glow)"/>`;
  // brass desk lamp: base, arm, shade
  body += shadow(460, 640, 150, 24, 0.9);
  body += `<ellipse cx="460" cy="625" rx="120" ry="26" fill="url(#brass)"/><rect x="448" y="360" width="22" height="265" rx="10" fill="url(#brass)"/>`;
  body += `<path d="M459 370L640 250" stroke="url(#brass)" stroke-width="18" stroke-linecap="round"/><circle cx="459" cy="370" r="18" fill="#a67a30"/>`;
  body += `<path d="M585 240L720 190L790 330L620 380Z" fill="url(#brass)"/><path d="M620 380L790 330" stroke="#fff0c0" stroke-width="6" opacity="0.8"/>`;
  body += `<path d="M620 380L790 330L900 640L420 660Z" fill="#ffd796" opacity="0.1" filter="url(#glow)"/>`;
  body += `<g transform="translate(830 520) scale(0.9)">${closedNotebook(0, 0, 360, 170, -4)}</g>`;
  body += `<g transform="translate(1180 700)">${pen(0, 0, 330, -12)}</g>`;
  return { file: "shop-hero.webp", alt: "A dark workbench at night with a small lit brass lamp, a closed notebook and a pen", use: "home hero, about image", aspect: "16:9", width: W, height: H, svg: stage(W, H, defs, body) };
}

export const images = [
  hero(),
  product("p-ledger-notebook.webp", "Charcoal linen A5 notebook with a black elastic band", closedNotebook(340, 260, 520, 720, -6), linenDefs),
  product("p-ledger-notebook-2.webp", "The notebook open to blank dotted pages",
    shadow(620, 900, 480, 50, 0.9)
    + `<g transform="rotate(-4 600 600)"><path d="M130 330L600 360V900L130 870Z" fill="#2e3033"/><path d="M600 360L1070 330V870L600 900Z" fill="#2e3033"/>`
    + `<path d="M150 320Q380 330 600 370V880Q380 850 150 855Z" fill="#ece6d8"/><path d="M150 320Q380 330 600 370V880Q380 850 150 855Z" fill="url(#dots)"/>`
    + `<path d="M600 370Q820 330 1050 320V855Q820 850 600 880Z" fill="#f3eee2"/><path d="M600 370Q820 330 1050 320V855Q820 850 600 880Z" fill="url(#dots)"/>`
    + `<path d="M560 370Q600 380 640 370V880Q600 890 560 880Z" fill="#000" opacity="0.28" filter="url(#rim)"/>`
    + `<path d="M600 378V900" stroke="#111" stroke-width="10" opacity="0.8"/></g>`, dotsDefs),
  product("p-brass-rule.webp", "Solid brass 30 cm ruler with engraved marks",
    `<g transform="rotate(-32 600 620)">${shadow(620, 700, 520, 40, 0.9)}<rect x="90" y="560" width="1020" height="110" rx="6" fill="url(#brass)"/><rect x="90" y="560" width="1020" height="10" fill="#fbe7b0" opacity="0.7"/>`
    + range(301).map((mm) => `<path d="M${110 + mm * 3.27} 572v${mm % 10 === 0 ? 38 : mm % 5 === 0 ? 26 : 16}" stroke="#4a3310" stroke-width="${mm % 10 === 0 ? 2 : 1.2}"/>`).join("") + `</g>`),
  product("p-field-pen.webp", "Matte black aluminium fountain pen, capped", `<g transform="translate(180 560)">${pen(0, 0, 840, -24)}</g>`),
  product("p-field-pen-2.webp", "The pen uncapped, showing its steel nib",
    `<g transform="translate(150 470)">${pen(0, 0, 820, -18, { capped: false })}</g>`
    + `<g transform="translate(470 820)">${shadow(200, 80, 220, 20, 0.8)}<rect x="0" y="0" width="380" height="60" rx="30" fill="url(#matte)" transform="rotate(-18 190 30)"/></g>`),
  product("p-slate-tray.webp", "Shallow dark slate desk tray holding two paper clips",
    shadow(610, 830, 470, 60, 0.9) + `<g transform="rotate(-6 600 640)"><rect x="170" y="440" width="860" height="380" rx="26" fill="#2c2f33"/><rect x="200" y="470" width="800" height="320" rx="16" fill="#1c1e21"/><rect x="170" y="440" width="860" height="12" rx="6" fill="#51565c" opacity="0.8"/>`
    + `<rect x="200" y="470" width="800" height="320" rx="16" fill="url(#weave)" opacity="0.5"/>${paperClip(480, 700, -70)}${paperClip(700, 690, -58)}</g>`, canvasDefs),
  product("p-sling-pouch.webp", "Small black waxed-canvas sling pouch",
    shadow(600, 930, 360, 50, 0.9) + `<path d="M200 520C160 260 320 160 600 170S1040 260 1000 520" stroke="#111" stroke-width="44" fill="none"/><path d="M200 520C160 260 320 160 600 170S1040 260 1000 520" stroke="#3a3935" stroke-width="4" fill="none" opacity="0.6"/>`
    + `<path d="M250 480Q600 420 950 480L980 830Q600 930 220 830Z" fill="url(#wax)"/><path d="M250 480Q600 420 950 480L980 830Q600 930 220 830Z" fill="url(#weave)"/>`
    + `<path d="M260 540Q600 480 940 540" stroke="#555" stroke-width="3" stroke-dasharray="10 8" fill="none"/><rect x="545" y="560" width="110" height="80" rx="10" fill="#101010" stroke="#3b3b3b" stroke-width="4"/><rect x="570" y="590" width="60" height="20" rx="4" fill="#262626"/>`, canvasDefs),
  product("p-card-wallet.webp", "Slim black leather card wallet",
    `<g transform="rotate(-10 600 620)">${shadow(620, 860, 400, 50, 0.9)}<rect x="330" y="330" width="500" height="320" rx="16" fill="#e8e1d2"/><rect x="330" y="330" width="500" height="40" rx="8" fill="#b9ac92" opacity="0.6"/><rect x="380" y="380" width="480" height="300" rx="16" fill="#5b6770"/>`
    + `<rect x="250" y="440" width="700" height="420" rx="24" fill="url(#leather)"/><rect x="250" y="440" width="700" height="420" rx="24" fill="url(#pebble)"/><rect x="274" y="464" width="652" height="372" rx="16" fill="none" stroke="#5a524a" stroke-width="3" stroke-dasharray="9 7"/><path d="M250 520H950" stroke="#000" stroke-width="3" opacity="0.5"/></g>`, leatherDefs),
  product("p-key-loop.webp", "Black leather key loop with a dark steel ring",
    shadow(600, 950, 300, 40, 0.9) + `<path d="M600 230C760 230 800 380 760 520L660 880H540L440 520C400 380 440 230 600 230Z" fill="url(#leather)"/><path d="M600 230C760 230 800 380 760 520L660 880H540L440 520C400 380 440 230 600 230Z" fill="url(#pebble)"/>`
    + `<path d="M600 300C700 300 720 400 690 500L610 820H590L510 500C480 400 500 300 600 300Z" fill="#070707"/><path d="M600 250C740 250 780 380 740 510" stroke="#6b6158" stroke-width="3" stroke-dasharray="8 6" fill="none"/>`
    + `<rect x="520" y="820" width="160" height="90" rx="12" fill="#1a1a1a" stroke="#4c4c4c" stroke-width="3"/><circle cx="600" cy="290" r="140" fill="none" stroke="#232427" stroke-width="30"/><path d="M490 220A140 140 0 0 1 660 165" stroke="#7a7d82" stroke-width="8" fill="none" opacity="0.7"/>`, leatherDefs),
  product("p-rain-cape.webp", "Folded charcoal rain cape beside its stuff sack",
    shadow(500, 880, 380, 50, 0.9) + `<path d="M170 540L780 500L820 820L200 860Z" fill="url(#cape)"/><path d="M180 640L790 600M190 740L805 710" stroke="#0e0f10" stroke-width="6" opacity="0.8"/><path d="M180 632L790 592M190 732L805 702" stroke="#6b6d70" stroke-width="3" opacity="0.5"/>`
    + `<path d="M170 540L780 500L790 530L180 572Z" fill="#5a5c5f"/>` + shadow(930, 900, 150, 30, 0.9)
    + `<path d="M840 560Q930 520 1020 560L1060 870Q930 910 800 870Z" fill="url(#cape)"/><path d="M850 580Q930 550 1010 580" stroke="#111" stroke-width="10" fill="none"/><path d="M930 570q-20 -60 20 -110" stroke="#9c9a95" stroke-width="5" fill="none"/><circle cx="950" cy="455" r="14" fill="#2a2a2a" stroke="#777" stroke-width="3"/>`, capeDefs),
  product("p-wick-lamp.webp", "Small lit brass oil lamp with a glass chimney", lamp(600, 960, { lit: true })),
  product("p-wick-lamp-2.webp", "The brass lamp unlit with its chimney set beside it",
    `<g transform="translate(-140 0)">${lamp(600, 960, { lit: false, withChimney: false })}</g>` + shadow(900, 970, 140, 20, 0.8) + chimney(900, 960)),
  product("p-pocket-torch.webp", "Short black aluminium pocket flashlight",
    `<g transform="rotate(-28 600 600)">${shadow(600, 720, 380, 40, 0.9)}<rect x="250" y="520" width="560" height="160" rx="30" fill="url(#matte)"/>`
    + range(24).map((i) => `<path d="M${300 + i * 12} 525v150" stroke="#000" stroke-width="5" opacity="0.6"/>`).join("")
    + `<rect x="790" y="495" width="170" height="210" rx="26" fill="url(#matte)"/><ellipse cx="962" cy="600" rx="22" ry="96" fill="#1d1f22"/><ellipse cx="966" cy="600" rx="12" ry="70" fill="#c7d4dc" opacity="0.55"/>`
    + `<rect x="250" y="530" width="700" height="14" rx="7" fill="#777" opacity="0.45"/><rect x="220" y="530" width="44" height="140" rx="12" fill="#101010"/></g>`),
  product("p-candle-set.webp", "Three ivory pillar candles of different heights",
    shadow(600, 950, 470, 50, 0.9) + candle(210, 930, 230, 560) + candle(485, 950, 230, 420) + candle(760, 930, 230, 300), ivoryDefs),
  product("p-clip-light.webp", "Small black clip-on reading light",
    shadow(640, 950, 300, 40, 0.9) + `<path d="M460 900L560 700L720 700L820 900Z" fill="url(#matte)"/><path d="M520 820Q640 780 760 820" stroke="#050505" stroke-width="18" fill="none"/>`
    + `<path d="M640 700C640 520 520 420 560 300S760 180 820 260" stroke="#141414" stroke-width="38" fill="none" stroke-linecap="round"/>`
    + `<path d="M640 700C640 520 520 420 560 300S760 180 820 260" stroke="#555" stroke-width="38" fill="none" stroke-dasharray="3 15" opacity="0.5"/>`
    + `<path d="M760 230L940 230Q990 300 940 380L760 380Q730 300 760 230Z" fill="url(#matte)"/><ellipse cx="955" cy="305" rx="16" ry="72" fill="#e7e3d6" opacity="0.7"/>`),
];
