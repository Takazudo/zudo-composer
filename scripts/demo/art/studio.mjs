import { blur, grain, grainLayer, linear, radial, range, shadow, svg } from "./svg.mjs";

// Sample Studio images are seeded from scripts/demo-assets by scripts/seed-demo-assets.ts.
export const demo = { name: "sample-studio", dir: "scripts/demo-assets", manifestPath: "scripts/demo/sample-studio.manifest.json" };

// Bright daylight studio: white walls, pale wood, few objects, documentary calm.
const defs = linear("wall", [[0, "#fbfbf9"], [1, "#ecebe6"]])
  + linear("oak", [[0, "#ead9bd"], [1, "#d2b98f"]])
  + radial("daylight", [[0, "#ffffff", 0.75], [1, "#ffffff", 0]], { cx: 0.85, cy: 0.05, r: 0.8 })
  + linear("sheet", [[0, "#ffffff"], [1, "#f1efe9"]], { x2: 1, y2: 1 })
  + `<pattern id="oakGrain" width="600" height="50" patternUnits="userSpaceOnUse"><path d="M0 12c140-8 260 6 380 0s160-6 220 2M0 34c160 6 280-8 400-2s140 8 200 0" stroke="#a88659" stroke-opacity="0.2" stroke-width="2" fill="none"/></pattern>`
  + blur("soft", 14) + blur("far", 5) + blur("rim", 1.5) + grain("grain", 0.05);

function scene(file, alt, use, width, height, horizon, body) {
  const aspect = width / height === 4 / 3 ? "4:3" : "16:10";
  const ground = `<g filter="url(#far)"><rect width="${width}" height="${horizon}" fill="url(#wall)"/></g>`
    + `<rect y="${horizon}" width="${width}" height="${height - horizon}" fill="url(#oak)"/><rect y="${horizon}" width="${width}" height="${height - horizon}" fill="url(#oakGrain)"/>`;
  return { file, alt, use, aspect, width, height, svg: svg(width, height, defs, `${ground}${body}<rect width="${width}" height="${height}" fill="url(#daylight)"/>${grainLayer(width, height)}`) };
}

function sheet(x, y, w, h, rotate, content = "") {
  return `<g transform="rotate(${rotate} ${x + w / 2} ${y + h / 2})">${shadow(x + w / 2 + 12, y + h + 4, w / 2, 12, 0.18)}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#sheet)" stroke="#dedbd2" stroke-width="1.5"/>${content}</g>`;
}

function sketchLines(x, y, w, count, color = "#9a968c") {
  return range(count).map((i) => `<path d="M${x} ${y + i * 26}h${w * (0.5 + ((i * 37) % 50) / 100)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`).join("");
}

function wireframe(x, y, w, h) {
  return `<rect x="${x + 30}" y="${y + 30}" width="${w - 60}" height="${h * 0.22}" fill="none" stroke="#6f6c65" stroke-width="3"/><path d="M${x + 30} ${y + 30}L${x + w - 30} ${y + 30 + h * 0.22}M${x + w - 30} ${y + 30}L${x + 30} ${y + 30 + h * 0.22}" stroke="#b5b1a7" stroke-width="2"/>`
    + sketchLines(x + 30, y + h * 0.34, w - 60, 4, "#8d8980")
    + range(3).map((i) => `<rect x="${x + 30 + i * ((w - 60) / 3)}" y="${y + h * 0.62}" width="${(w - 60) / 3 - 16}" height="${h * 0.26}" fill="none" stroke="#6f6c65" stroke-width="2.5"/>`).join("");
}

function pencilCup(x, baseY) {
  const pencils = [["#2f5d8a", -10], ["#d9a63a", -2], ["#3b3b3b", 6], ["#c24f3c", 13]];
  return shadow(x + 70, baseY + 6, 90, 12, 0.25)
    + pencils.map(([color, angle], i) => `<g transform="rotate(${angle} ${x + 70} ${baseY})"><rect x="${x + 40 + i * 16}" y="${baseY - 260}" width="14" height="200" fill="${color}"/><path d="M${x + 40 + i * 16} ${baseY - 260}l7 -26l7 26z" fill="#e8cfa2"/></g>`).join("")
    + `<path d="M${x} ${baseY - 150}H${x + 140}L${x + 128} ${baseY}H${x + 12}Z" fill="#dcd9d2"/><path d="M${x} ${baseY - 150}H${x + 140}" stroke="#f7f6f2" stroke-width="6"/>`;
}

function workbench() {
  const W = 1600, H = 1200;
  let body = `<rect x="1180" y="80" width="300" height="420" fill="#ffffff" stroke="#e4e2dc" stroke-width="10" filter="url(#far)"/>`;
  body += sheet(260, 700, 380, 260, -8, sketchLines(300, 740, 300, 7)) + sheet(560, 760, 420, 300, 5, wireframe(560, 760, 420, 300));
  body += `<g>${shadow(1180, 900, 250, 20, 0.25)}<rect x="960" y="760" width="440" height="150" rx="14" fill="#c9cacc"/><rect x="960" y="760" width="440" height="18" rx="9" fill="#e4e5e7"/><circle cx="1180" cy="836" r="10" fill="#b2b3b5"/></g>`;
  body += pencilCup(160, 650);
  return scene("studio-workbench.webp", "A bright studio worktable with paper sketches, a closed laptop and a pot of pencils", "home split image", W, H, 600, body);
}

function wall() {
  const W = 1600, H = 1000;
  const cards = [];
  for (const row of range(4)) for (const col of range(6)) {
    if ((row * 6 + col) % 7 === 5) continue;
    cards.push([180 + col * 215 + (row % 2) * 30, 110 + row * 185, ((row * 13 + col * 7) % 9) - 4]);
  }
  let body = cards.slice(0, -1).map(([x, y], i) => {
    const [nx, ny] = cards[i + 1];
    return `<path d="M${x + 80} ${y + 55}L${nx + 80} ${ny + 55}" stroke="#8e8a82" stroke-width="2.5" stroke-linecap="round"/>`;
  }).join("");
  body += `<path d="M${cards[2][0] + 80} ${cards[2][1] + 55}Q700 700 ${cards[16][0] + 80} ${cards[16][1] + 55}" stroke="#8e8a82" stroke-width="2.5" fill="none"/>`;
  body += cards.map(([x, y, r], i) => sheet(x, y, 160, 110, r, sketchLines(x + 16, y + 26, 120, 3, i % 5 === 0 ? "#6a88a8" : "#a19d94") + `<circle cx="${x + 80}" cy="${y + 8}" r="6" fill="#c9c6bf"/>`)).join("");
  return scene("studio-wall.webp", "A white wall covered in index cards connected by pencil lines", "about story image", W, H, 900, body);
}

function review() {
  const W = 1600, H = 1000;
  let body = sheet(200, 200, 560, 720, -4, wireframe(200, 200, 560, 720)) + sheet(840, 200, 560, 720, 3, wireframe(840, 200, 560, 720));
  body += `<g transform="rotate(8 1230 330)"><rect x="1150" y="250" width="160" height="160" fill="#f5dc6b"/>${sketchLines(1170, 290, 110, 3, "#8a7a2d")}</g>`;
  body += `<g transform="rotate(-6 440 800)"><rect x="370" y="730" width="150" height="150" fill="#f2c46a"/>${sketchLines(390, 770, 100, 3, "#8a6a2d")}</g>`;
  body += `<g transform="rotate(-24 800 860)">${shadow(800, 890, 300, 10, 0.25)}<rect x="520" y="850" width="520" height="24" fill="#3b3b3b"/><path d="M1040 850l60 12-60 12z" fill="#e8cfa2"/><path d="M1080 858l20 4-20 4z" fill="#2a2a2a"/></g>`;
  return scene("studio-review.webp", "Two printed interface drafts side by side with a pencil and sticky notes", "services lead image", W, H, 60, body);
}

function question() {
  const W = 1600, H = 1000;
  const mark = `<path d="M720 380Q720 280 800 280Q890 280 890 370Q890 430 820 470Q790 490 792 560" stroke="#3f3c38" stroke-width="16" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="794" cy="630" r="12" fill="#3f3c38"/>`;
  const body = sheet(560, 170, 480, 640, -3, mark);
  return scene("journal-question.webp", "A sheet of paper with a single handwritten question mark on a pale desk", "article: Start with the question", W, H, 0, body);
}

function map() {
  const W = 1600, H = 1000;
  const boxes = [[180, 180], [520, 140], [880, 220], [1220, 170], [300, 480], [700, 470], [1080, 500], [480, 740], [900, 760]];
  const links = [[0, 1], [1, 2], [2, 3], [0, 4], [1, 5], [2, 6], [4, 5], [5, 6], [5, 7], [6, 8], [7, 8]];
  let content = links.map(([a, b]) => {
    const [x1, y1] = boxes[a], [x2, y2] = boxes[b];
    return `<path d="M${x1 + 90} ${y1 + 50}L${x2 + 90} ${y2 + 50}" stroke="#55524c" stroke-width="3" stroke-linecap="round"/>`;
  }).join("");
  content += boxes.map(([x, y]) => `<rect x="${x}" y="${y}" width="180" height="100" fill="#fbfaf6" stroke="#4a4742" stroke-width="3.5"/>${sketchLines(x + 24, y + 38, 120, 2, "#9a968c")}`).join("");
  content += [1, 5, 8].map((i) => `<ellipse cx="${boxes[i][0] + 90}" cy="${boxes[i][1] + 50}" rx="130" ry="85" fill="none" stroke="#6a6760" stroke-width="3" transform="rotate(-6 ${boxes[i][0] + 90} ${boxes[i][1] + 50})"/>`).join("");
  const body = sheet(90, 70, 1420, 860, -1.5, content);
  return scene("journal-map.webp", "A hand-drawn diagram of boxes and arrows with a few boxes circled", "article: Map the moving parts; also Review in small loops", W, H, 0, body);
}

export const images = [workbench(), wall(), review(), question(), map()];
