import { blur, brush, grain, grainLayer, linear, radial, range, shadow, svg } from "./svg.mjs";

export const demo = { name: "blog", dir: "packages/demo-blog/images-src", manifestPath: "packages/demo-blog/images-src/manifest.json" };

const W = 1600, H = 1000;

// Warm natural-light still life: cream wall, wood surface, a soft window glow, shallow depth of field.
const baseDefs = linear("wall", [[0, "#efe4cf"], [1, "#d9c7a6"]])
  + linear("wood", [[0, "#b98a5a"], [0.6, "#94673d"], [1, "#6b4526"]])
  + radial("window", [[0, "#fff6df", 0.9], [1, "#fff6df", 0]], { cx: 0.2, cy: 0.1, r: 0.75 })
  + radial("vignette", [[0.6, "#3a2410", 0], [1, "#3a2410", 0.35]], { r: 0.75 })
  + linear("paper", [[0, "#fbf7ee"], [1, "#e9dfcb"]], { x2: 1, y2: 1 })
  + `<pattern id="woodGrain" width="520" height="60" patternUnits="userSpaceOnUse"><path d="M0 14c120-10 220 8 330 0s140-6 190 2M0 40c140 6 240-8 340-2s120 8 180 0" stroke="#5a3a1e" stroke-opacity="0.22" stroke-width="3" fill="none"/></pattern>`
  + blur("soft", 16) + blur("far", 7) + blur("rim", 2) + grain("grain", 0.07);

function scene(file, alt, use, horizon, body, extraDefs = "") {
  const background = `<g filter="url(#far)"><rect width="${W}" height="${horizon}" fill="url(#wall)"/></g>`
    + `<rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#wood)"/><rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#woodGrain)"/>`
    + `<path d="M0 ${horizon}H${W}" stroke="#4a2f17" stroke-opacity="0.35" stroke-width="4" filter="url(#rim)"/>`;
  return { file, alt, use, aspect: "16:10", width: W, height: H,
    svg: svg(W, H, baseDefs + extraDefs, `${background}${body}<rect width="${W}" height="${H}" fill="url(#window)"/><rect width="${W}" height="${H}" fill="url(#vignette)"/>${grainLayer(W, H)}`) };
}

function pencil(x, y, length, rotate) {
  return `<g transform="rotate(${rotate} ${x} ${y})">${shadow(x + length / 2 + 10, y + 26, length / 2, 10, 0.35)}`
    + `<rect x="${x}" y="${y - 11}" width="${length}" height="22" fill="#d9a63a"/><rect x="${x}" y="${y - 11}" width="${length}" height="6" fill="#f0c860"/>`
    + `<path d="M${x + length} ${y - 11}L${x + length + 60} ${y}L${x + length} ${y + 11}Z" fill="#e6c79a"/><path d="M${x + length + 40} ${y - 4}L${x + length + 60} ${y}L${x + length + 40} ${y + 4}Z" fill="#3b3b3b"/>`
    + `<rect x="${x - 34}" y="${y - 11}" width="34" height="22" fill="#b9b2a4"/><rect x="${x - 60}" y="${y - 11}" width="28" height="22" rx="6" fill="#d98b82"/></g>`;
}

function scribble(x, y, width) {
  const points = range(Math.floor(width / 18)).map((i) => `${x + i * 18} ${y + (i % 2 ? -5 : 4)}`).join(" L");
  return `<path d="M${points}" stroke="#5b5048" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function halfFinishedList() {
  let body = shadow(820, 900, 420, 40, 0.3);
  body += `<g transform="rotate(-5 800 620)"><rect x="480" y="250" width="620" height="700" fill="url(#paper)"/>`;
  body += range(9).map((i) => `<path d="M520 ${360 + i * 62}H1060" stroke="#b7c6d4" stroke-width="2"/>`).join("");
  body += `<path d="M560 260V950" stroke="#e2a3a0" stroke-width="2"/>`;
  body += range(8).map((i) => {
    const y = 345 + i * 62, width = 240 + ((i * 97) % 200);
    const done = i < 4;
    return `<rect x="585" y="${y - 18}" width="22" height="22" fill="none" stroke="#5b5048" stroke-width="3"/>${done ? `<path d="M588 ${y - 8}l8 9 14-18" stroke="#5b5048" stroke-width="3" fill="none"/>` : ""}${scribble(630, y - 6, width)}${done ? `<path d="M620 ${y - 8}H${650 + width}" stroke="#3f3630" stroke-width="4"/>` : ""}`;
  }).join("");
  body += `</g>${pencil(560, 720, 560, -18)}`;
  return scene("cover-half-finished-list.webp", "A handwritten to-do list with half its items crossed out and a pencil across it", "article 1 cover", 300, body);
}

function sharpen() {
  let body = shadow(700, 780, 380, 40, 0.45);
  body += `<rect x="360" y="610" width="680" height="150" rx="10" fill="#4a3a2c"/><rect x="380" y="560" width="640" height="80" rx="8" fill="#8f8f8b"/><rect x="380" y="560" width="640" height="16" rx="6" fill="#b8b8b3"/>`;
  body += range(9).map((i) => `<ellipse cx="${460 + i * 62}" cy="${590 + (i % 3) * 10}" rx="${10 + (i % 3) * 4}" ry="5" fill="#dfeef2" opacity="0.8"/>`).join("");
  body += `<g transform="rotate(-8 1160 760)">${shadow(1180, 820, 300, 16, 0.4)}<rect x="900" y="740" width="260" height="50" rx="20" fill="#8a5a33"/><rect x="900" y="742" width="260" height="12" rx="6" fill="#b37c4c"/><rect x="1160" y="744" width="50" height="42" fill="#6d6b66"/><path d="M1210 748H1420L1440 770L1420 782H1210Z" fill="#b9bcbf"/><path d="M1210 750H1420" stroke="#eef0f2" stroke-width="4"/></g>`;
  return scene("cover-sharpen.webp", "A wet whetstone beside a chisel on a wooden bench", "article 2 cover", 420, body);
}

function notebookTopDown(x, y, w, h, color = "#5f5448") {
  return `${shadow(x + w / 2 + 20, y + h + 10, w * 0.55, 26, 0.4)}<rect x="${x + 8}" y="${y + 6}" width="${w}" height="${h}" rx="8" fill="#efe6d4"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${color}"/><rect x="${x + w - 60}" y="${y}" width="16" height="${h}" fill="#2f2822" opacity="0.8"/>`;
}

function oneThing() {
  const body = `<g transform="translate(800 720) scale(1 0.55) rotate(-6)">${notebookTopDown(-200, -260, 400, 520)}</g>`;
  return scene("cover-one-thing.webp", "A bare wooden desk with one closed notebook in the centre", "article 3 cover", 560, body);
}

function notesSurvive() {
  let body = "";
  for (const i of range(14)) body += `<rect x="${520 + (i % 3) * 3}" y="${720 - i * 12}" width="560" height="340" transform="rotate(-4 800 560)" fill="${i % 2 ? "#f6f0e2" : "#efe7d4"}" stroke="#d6cbb4" stroke-width="1" rx="6"/>`;
  body = shadow(820, 960, 360, 34, 0.45) + `<g transform="translate(0 -220)">${body}</g>`;
  body += `<g transform="rotate(-4 800 560)"><path d="M700 330H900L880 400H720Z" fill="#1d1d1d"/><path d="M730 330Q720 250 790 250M870 330Q880 250 810 250" stroke="#c9ccd0" stroke-width="8" fill="none"/></g>`;
  body += `<g transform="rotate(12 1180 620)">${shadow(1200, 860, 260, 20, 0.35)}<rect x="960" y="480" width="520" height="320" rx="6" fill="url(#paper)"/>${range(6).map((i) => `<path d="M990 ${540 + i * 42}H1450" stroke="#c7d1d9" stroke-width="2"/>`).join("")}${scribble(1000, 525, 280)}${scribble(1000, 610, 380)}</g>`;
  return scene("cover-notes-survive.webp", "A stack of index cards in a binder clip with one card pulled out", "article 4 cover", 260, body);
}

function sketchPage(x, y, rotate, content) {
  return `<g transform="rotate(${rotate} ${x + 280} ${y + 360})">${shadow(x + 300, y + 740, 280, 20, 0.3)}<rect x="${x}" y="${y}" width="560" height="720" fill="url(#paper)"/>${content(x, y)}</g>`;
}

function unfinishedDrafts() {
  const smudge = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="70" ry="30" fill="#8a8178" opacity="0.18" filter="url(#soft)"/>`;
  const draw = (seed) => (x, y) => smudge(x + 200 + seed * 30, y + 300)
    + `<path d="M${x + 80} ${y + 520}C${x + 160} ${y + 300 - seed * 40} ${x + 320} ${y + 280} ${x + 460} ${y + 180}" stroke="#4c4540" stroke-width="3" fill="none"/>`
    + `<path d="M${x + 90} ${y + 540}C${x + 170} ${y + 320 - seed * 40} ${x + 330} ${y + 300} ${x + 470} ${y + 200}" stroke="#6f6760" stroke-width="2" fill="none" opacity="0.6"/>`
    + `<circle cx="${x + 300}" cy="${y + 420}" r="${60 + seed * 20}" stroke="#5b534c" stroke-width="3" fill="none"/>`
    + `<rect x="${x + 360}" y="${y + 520}" width="140" height="100" stroke="#8a8178" stroke-width="2" fill="none" stroke-dasharray="6 5"/>`
    + range(4).map((i) => `<path d="M${x + 420} ${y + 80 + i * 24}h${70 + i * 8}" stroke="#7a6f66" stroke-width="2"/>`).join("");
  const body = sketchPage(260, 180, -14, draw(0)) + sketchPage(520, 160, -2, draw(1)) + sketchPage(780, 190, 11, draw(2));
  return scene("cover-unfinished-drafts.webp", "Pencil sketch pages with erasing marks and margin notes, fanned out", "article 5 cover", 200, body);
}

function quietHour() {
  const defs = linear("dawn", [[0, "#f6c99a"], [0.55, "#f9e2c2"], [1, "#fdf2de"]]);
  let body = `<g filter="url(#far)"><rect x="820" y="90" width="600" height="560" fill="url(#dawn)"/><path d="M1120 90V650M820 370H1420" stroke="#e7dccb" stroke-width="18"/><rect x="820" y="90" width="600" height="560" fill="none" stroke="#e7dccb" stroke-width="26"/></g>`;
  body += `<rect x="780" y="640" width="680" height="40" fill="#e8dcc4"/><rect x="780" y="676" width="680" height="12" fill="#c7b695"/>`;
  body += `<path d="M1260 640h90v-70q0-20-20-20h-50q-20 0-20 20z" fill="#efe9dc"/><path d="M1350 590q30 0 30 25t-30 25" stroke="#efe9dc" stroke-width="10" fill="none"/>`;
  body += range(3).map((i) => `<path d="M${1285 + i * 20} 530c-16-30 16-50 0-80" stroke="#fff" stroke-opacity="0.65" stroke-width="6" fill="none" filter="url(#rim)"/>`).join("");
  body += `<g>${shadow(460, 950, 260, 30, 0.4)}<path d="M300 380Q300 350 330 350H560Q590 350 590 380V620H300Z" fill="#9b7550"/><rect x="270" y="610" width="360" height="60" rx="12" fill="#b3895e"/>`
    + `<path d="M300 670L280 960M600 670L620 960M340 670L350 900M560 670L550 900" stroke="#7d5b3a" stroke-width="22" stroke-linecap="round"/></g>`;
  return scene("cover-quiet-hour.webp", "An empty chair beside a window at dawn with a steaming cup on the sill", "article 6 cover", 700, body, defs);
}

function repairableTools() {
  const cloth = `<path d="M180 330L1420 280L1460 900L150 940Z" fill="#6f7f76"/><path d="M180 330L1420 280L1460 900L150 940Z" fill="url(#woodGrain)" opacity="0.4"/>`;
  const parts = [
    `<rect x="300" y="470" width="430" height="70" rx="34" fill="#2c3b4a"/><rect x="330" y="482" width="360" height="12" rx="6" fill="#5c7187"/>`,
    `<rect x="300" y="610" width="360" height="74" rx="36" fill="#2c3b4a"/><rect x="600" y="600" width="80" height="12" rx="6" fill="#c9a24f"/><rect x="320" y="598" width="260" height="14" rx="7" fill="#c9a24f"/>`,
    `<rect x="820" y="480" width="170" height="52" rx="16" fill="#1f1f1f"/><path d="M990 486L1100 506L990 526Z" fill="#c9a24f"/><path d="M1020 506H1100" stroke="#6b5220" stroke-width="2"/>`,
    `<rect x="800" y="620" width="260" height="36" rx="18" fill="#c7d2d8" opacity="0.8"/><rect x="800" y="620" width="30" height="36" rx="10" fill="#8b979d"/>`,
    `<g transform="rotate(-20 1260 700)"><rect x="1120" y="690" width="150" height="34" rx="12" fill="#b8453a"/><rect x="1270" y="700" width="160" height="14" fill="#aeb4b8"/><path d="M1430 700h20v14h-20z" fill="#6f777c"/></g>`,
  ];
  return scene("cover-repairable-tools.webp", "A fountain pen disassembled into parts on a cloth beside a small screwdriver", "article 7 cover", 150,
    cloth + parts.map((part) => `<g>${part}</g>`).join("") + shadow(700, 780, 500, 20, 0.2));
}

function readingSlowly() {
  let body = shadow(800, 900, 560, 50, 0.45);
  body += `<path d="M240 330Q520 280 800 350V860Q520 800 240 850Z" fill="url(#paper)"/><path d="M800 350Q1080 280 1360 330V850Q1080 800 800 860Z" fill="#f7f1e3"/>`;
  body += `<path d="M230 850Q520 800 800 870Q1080 800 1370 850V880Q1080 830 800 895Q520 830 230 880Z" fill="#c9b99a"/>`;
  body += range(12).map((i) => `<path d="M320 ${400 + i * 36}Q540 ${385 + i * 34} 740 ${418 + i * 36}" stroke="#a79e90" stroke-width="5" fill="none" opacity="0.55"/><path d="M860 ${418 + i * 36}Q1060 ${385 + i * 34} 1280 ${400 + i * 36}" stroke="#a79e90" stroke-width="5" fill="none" opacity="0.55"/>`).join("");
  body += `<path d="M780 350Q800 360 820 350V870Q800 880 780 870Z" fill="#6b5a44" opacity="0.25" filter="url(#rim)"/>`;
  body += `<path d="M810 350L830 960L850 930L870 965L850 355Z" fill="#8e2f2b"/>`;
  body += `<g transform="rotate(-10 1000 640)"><circle cx="930" cy="640" r="78" fill="#f6f2ea" fill-opacity="0.25" stroke="#2b2522" stroke-width="12"/><circle cx="1130" cy="640" r="78" fill="#f6f2ea" fill-opacity="0.25" stroke="#2b2522" stroke-width="12"/><path d="M1008 630Q1030 606 1052 630" stroke="#2b2522" stroke-width="10" fill="none"/><path d="M852 620L700 700M1208 620L1330 700" stroke="#2b2522" stroke-width="8"/></g>`;
  return scene("cover-reading-slowly.webp", "An open book with a ribbon bookmark and folded reading glasses on the page", "article 8 cover", 180, body);
}

function painterlyAvatar(file, alt, [deep, mid, cream], seed) {
  const defs = brush("paint", 26, 0.025, seed) + blur("wash", 8);
  const strokes = `<rect width="400" height="400" fill="${cream}"/><g filter="url(#paint)">`
    + `<ellipse cx="200" cy="180" rx="95" ry="110" fill="${mid}"/><ellipse cx="190" cy="150" rx="70" ry="60" fill="${deep}" opacity="0.7"/>`
    + `<path d="M40 420Q60 280 200 280Q340 280 360 420Z" fill="${deep}"/><path d="M90 420Q120 320 210 316Q300 320 320 420Z" fill="${mid}" opacity="0.7"/>`
    + `<path d="M20 60Q120 20 180 70T380 40" stroke="${mid}" stroke-width="30" fill="none" opacity="0.4" filter="url(#wash)"/></g>`;
  return { file, alt, use: "author avatar", aspect: "1:1", width: 400, height: 400, svg: svg(400, 400, defs, strokes) };
}

export const images = [
  halfFinishedList(),
  sharpen(),
  oneThing(),
  notesSurvive(),
  unfinishedDrafts(),
  quietHour(),
  repairableTools(),
  readingSlowly(),
  painterlyAvatar("avatar-mina-okafor.webp", "Abstract painterly avatar in ochre and cream", ["#a86b1f", "#d9a54a", "#f3e7cf"], 4),
  painterlyAvatar("avatar-teodor-lindqvist.webp", "Abstract painterly avatar in slate blue and cream", ["#3d5470", "#7890aa", "#f1ebdd"], 9),
];
