import { blur, range, svg } from "./svg.mjs";

export const demo = { name: "landing", dir: "packages/demo-landing/images-src", manifestPath: "packages/demo-landing/images-src/manifest.json" };

// Flat vector on white: cobalt is the only saturated colour, light grey line work, no text.
const COBALT = "#2E4FD8";
const LINE = "#D3D6DD";
const FILL = "#F1F2F5";
const MID = "#B9BDC7";
const defs = blur("soft", 14);

function frame(width, height, body) {
  return svg(width, height, defs, `<rect width="${width}" height="${height}" fill="#fff"/>${body}`);
}

function textLines(x, y, widths, gap = 22, color = LINE, height = 8) {
  return widths.map((width, index) => `<rect x="${x}" y="${y + index * gap}" width="${width}" height="${height}" rx="${height / 2}" fill="${color}"/>`).join("");
}

function heroApp() {
  const W = 1600, H = 1000;
  let body = `<rect x="160" y="130" width="1280" height="760" rx="28" fill="#E6E8EE" filter="url(#soft)" transform="translate(0 24)"/>`;
  body += `<rect x="160" y="110" width="1280" height="760" rx="28" fill="#fff" stroke="${LINE}" stroke-width="3"/>`;
  body += `<path d="M160 190H1440" stroke="${LINE}" stroke-width="3"/>` + [0, 1, 2].map((i) => `<circle cx="${210 + i * 34}" cy="150" r="10" fill="${LINE}"/>`).join("");
  body += `<rect x="160" y="190" width="250" height="680" fill="${FILL}"/>` + textLines(200, 240, [150, 120, 170, 110, 140], 46, MID, 12);
  body += `<rect x="200" y="520" width="170" height="170" rx="16" fill="#fff" stroke="${LINE}" stroke-width="3"/>`;
  body += range(5).map((row) => range(7).map((col) => `<circle cx="${222 + col * 21}" cy="${545 + row * 30}" r="4" fill="${row === 2 && col === 3 ? COBALT : MID}"/>`).join("")).join("");
  const gridX = 450, gridY = 230, colW = 140, rowH = 80;
  body += range(7).map((col) => `<rect x="${gridX + col * colW + 20}" y="${gridY}" width="80" height="12" rx="6" fill="${MID}"/>`).join("");
  body += range(8).map((row) => `<path d="M${gridX} ${gridY + 40 + row * rowH}H${gridX + 7 * colW}" stroke="${LINE}" stroke-width="2"/>`).join("");
  body += range(8).map((col) => `<path d="M${gridX + col * colW} ${gridY + 40}V${gridY + 40 + 7 * rowH}" stroke="${LINE}" stroke-width="2"/>`).join("");
  const blocks = [[0, 1, 2], [1, 3, 1], [2, 0, 2], [3, 4, 2], [4, 1, 1], [5, 2, 3], [6, 5, 1], [4, 4, 2]];
  for (const [col, row, span] of blocks) body += `<rect x="${gridX + col * colW + 10}" y="${gridY + 50 + row * rowH}" width="${colW - 20}" height="${span * rowH - 20}" rx="12" fill="${FILL}" stroke="${MID}" stroke-width="2"/>` + textLines(gridX + col * colW + 26, gridY + 72 + row * rowH, [70, 50], 20, MID, 8);
  body += `<rect x="${gridX + 2 * colW + 10}" y="${gridY + 50 + 4 * rowH}" width="${colW - 20}" height="${2 * rowH - 20}" rx="12" fill="${COBALT}"/>` + textLines(gridX + 2 * colW + 26, gridY + 72 + 4 * rowH, [80, 56], 20, "#fff", 8);
  return { file: "land-hero-app.webp", alt: "Stylised calendar app window with a week grid and one highlighted block", use: "hero screenshot", aspect: "16:10", width: W, height: H, svg: frame(W, H, body) };
}

function card(x, y, w, h, inner) {
  return `<rect x="${x + 8}" y="${y + 18}" width="${w}" height="${h}" rx="26" fill="#E6E8EE" filter="url(#soft)"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="26" fill="#fff" stroke="${LINE}" stroke-width="3"/>${inner}`;
}

function workflow() {
  const W = 1600, H = 1000;
  let body = "";
  // day view: stacked time rows
  body += card(250, 300, 380, 440, textLines(290, 340, [120], 0, MID, 12) + range(6).map((i) => `<rect x="290" y="${390 + i * 54}" width="${i === 2 ? 300 : 220 + (i % 3) * 30}" height="34" rx="10" fill="${FILL}" stroke="${LINE}" stroke-width="2"/>`).join(""));
  // week view: seven columns
  body += card(560, 220, 420, 520, textLines(600, 260, [140], 0, MID, 12) + range(7).map((i) => `<rect x="${600 + i * 50}" y="310" width="36" height="${120 + ((i * 53) % 5) * 50}" rx="10" fill="${FILL}" stroke="${LINE}" stroke-width="2"/>`).join(""));
  // month view: dot grid with the single cobalt accent
  body += card(920, 300, 360, 440, textLines(960, 340, [110], 0, MID, 12) + range(5).map((row) => range(6).map((col) => `<circle cx="${980 + col * 48}" cy="${410 + row * 64}" r="12" fill="${row === 2 && col === 3 ? COBALT : FILL}" stroke="${row === 2 && col === 3 ? COBALT : LINE}" stroke-width="2"/>`).join("")).join(""));
  const arrow = (x1, x2, y) => `<path d="M${x1} ${y}H${x2}" stroke="${MID}" stroke-width="4" stroke-linecap="round"/><path d="M${x2 - 14} ${y - 12}L${x2} ${y}L${x2 - 14} ${y + 12}" stroke="${MID}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  body += arrow(440, 755, 820) + arrow(785, 1100, 820);
  body += `<path d="M440 820V740M770 820V740M1100 820V740" stroke="${MID}" stroke-width="4" stroke-linecap="round"/>`;
  return { file: "land-workflow.webp", alt: "Three overlapping cards for day, week and month views connected by arrows", use: "home and features split image", aspect: "16:10", width: W, height: H, svg: frame(W, H, body) };
}

function figure(cx, seatY, tone, facing = 1) {
  return `<circle cx="${cx}" cy="${seatY - 250}" r="46" fill="${tone}"/>`
    + `<path d="M${cx - 70} ${seatY}V${seatY - 130}Q${cx - 70} ${seatY - 190} ${cx} ${seatY - 190}Q${cx + 70} ${seatY - 190} ${cx + 70} ${seatY - 130}V${seatY}Z" fill="${tone}"/>`
    + `<path d="M${cx + 30 * facing} ${seatY - 110}L${cx + 110 * facing} ${seatY - 60}" stroke="${tone}" stroke-width="26" stroke-linecap="round"/>`;
}

function team() {
  const W = 1600, H = 1200;
  let body = `<rect x="0" y="880" width="1600" height="320" fill="${FILL}"/>`;
  body += `<rect x="360" y="120" width="880" height="470" rx="18" fill="#fff" stroke="${LINE}" stroke-width="4"/>`;
  body += range(5).map((row) => `<path d="M360 ${210 + row * 76}H1240" stroke="${LINE}" stroke-width="3"/>`).join("") + range(6).map((col) => `<path d="M${360 + (col + 1) * 125.7} 210V590" stroke="${LINE}" stroke-width="3"/>`).join("");
  body += `<rect x="360" y="120" width="880" height="90" rx="18" fill="${FILL}"/>` + textLines(420, 158, [200], 0, MID, 14);
  const filled = [[0, 1], [1, 0], [2, 3], [3, 2], [5, 1], [6, 4], [4, 0]];
  for (const [col, row] of filled) body += `<rect x="${372 + col * 125.7}" y="${222 + row * 76}" width="102" height="52" rx="10" fill="${LINE}"/>`;
  body += `<rect x="${372 + 3 * 125.7}" y="${222 + 4 * 76}" width="102" height="52" rx="10" fill="${COBALT}"/>`;
  body += figure(330, 860, "#9EA3AE", 1) + figure(620, 820, "#C3C7CF", 1) + figure(980, 820, "#8B909B", -1) + figure(1270, 860, "#B0B4BD", -1);
  body += `<rect x="300" y="800" width="1000" height="44" rx="22" fill="#D9DCE2"/><path d="M420 844V1060M1180 844V1060" stroke="#C3C7CF" stroke-width="22" stroke-linecap="round"/>`;
  body += `<rect x="560" y="770" width="170" height="36" rx="6" fill="#fff" stroke="${LINE}" stroke-width="3"/><rect x="880" y="772" width="120" height="30" rx="15" fill="#fff" stroke="${LINE}" stroke-width="3"/>`;
  return { file: "land-team.webp", alt: "Four abstract figures around a table beneath a large wall calendar", use: "about page image", aspect: "4:3", width: W, height: H, svg: frame(W, H, body) };
}

function avatar(file, alt, use, body, background = "#fff") {
  return { file, alt, use, aspect: "1:1", width: 400, height: 400, svg: svg(400, 400, "", `<rect width="400" height="400" fill="${background}"/>${body}`) };
}

export const images = [
  heroApp(),
  workflow(),
  team(),
  avatar("avatar-mara.webp", "Abstract geometric avatar in grey with a cobalt collar", "testimonial 1",
    `<rect width="400" height="400" fill="${FILL}"/><circle cx="200" cy="165" r="78" fill="#AEB2BC"/><path d="M122 150Q130 70 210 72Q290 80 286 170L270 130Q210 110 150 140Z" fill="#7D828D"/><path d="M60 400Q70 270 200 262Q330 270 340 400Z" fill="#C3C7CF"/><path d="M140 272L200 330L260 272L290 290L200 370L110 290Z" fill="${COBALT}"/>`),
  avatar("avatar-jonah.webp", "Abstract geometric avatar on a cobalt disc", "testimonial 2",
    `<circle cx="200" cy="200" r="180" fill="${COBALT}"/><path d="M200 70L290 150V230L200 280L110 230V150Z" fill="#B7AFA6"/><path d="M110 150L200 70L290 150L200 120Z" fill="#8E857C"/><path d="M70 380Q80 290 200 280Q320 290 330 380Q270 400 200 400T70 380Z" fill="#CFC8C0"/>`),
  avatar("avatar-priya.webp", "Abstract geometric avatar with cobalt glasses", "testimonial 3",
    `<rect width="400" height="400" fill="#fff"/><circle cx="200" cy="200" r="180" fill="${FILL}"/><path d="M110 190Q110 80 200 80Q290 80 290 190V260H110Z" fill="#9EA3AE"/><circle cx="200" cy="185" r="72" fill="#DADDE3"/><path d="M60 390Q70 290 200 282Q330 290 340 390Z" fill="#C8CCD3"/>`
    + `<circle cx="168" cy="182" r="24" fill="none" stroke="${COBALT}" stroke-width="8"/><circle cx="232" cy="182" r="24" fill="none" stroke="${COBALT}" stroke-width="8"/><path d="M192 182H208" stroke="${COBALT}" stroke-width="8"/>`),
];
