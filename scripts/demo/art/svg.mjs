// Shared SVG building blocks for the hand-built demo illustrations.

export function svg(width, height, defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs}</defs>${body}</svg>`;
}

export function linear(id, stops, { x1 = 0, y1 = 0, x2 = 0, y2 = 1 } = {}) {
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stopTags(stops)}</linearGradient>`;
}

export function radial(id, stops, { cx = 0.5, cy = 0.5, r = 0.5, fx = cx, fy = cy } = {}) {
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" fx="${fx}" fy="${fy}">${stopTags(stops)}</radialGradient>`;
}

function stopTags(stops) {
  return stops.map(([offset, color, opacity = 1]) => `<stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity}"/>`).join("");
}

export function blur(id, deviation) {
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${deviation}"/></filter>`;
}

/** Film grain that keeps flat gradients from banding once encoded as WebP. */
export function grain(id, opacity, frequency = 0.9) {
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="2" seed="7" result="n"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="${opacity}"/></feComponentTransfer></filter>`;
}

/** Painterly edge: displaces a group through turbulence so shapes read as brushwork. */
export function brush(id, scale, frequency = 0.02, seed = 3) {
  return `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="3" seed="${seed}" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/></filter>`;
}

export function grainLayer(width, height, id = "grain") {
  return `<rect width="${width}" height="${height}" filter="url(#${id})"/>`;
}

export function shadow(cx, cy, rx, ry, opacity = 0.6, filter = "soft") {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity="${opacity}" filter="url(#${filter})"/>`;
}

export function range(count) {
  return Array.from({ length: count }, (_, index) => index);
}
