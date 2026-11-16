/* Gradient Generator, the renderers and the finishing passes.
 *
 * Every renderer takes (ctx, w, h, cfg) and paints the whole frame. Resolution
 * is the caller's business: the preview draws small and the export draws big
 * from the same code, so what you see is what lands in the file.
 */
"use strict";

const TAU = Math.PI * 2;

const TYPES = ["linear", "radial", "conic", "horizon", "bands", "mesh", "fluid"];
const TYPE_LABELS = {
  linear: "Linear", radial: "Radial", conic: "Conic", horizon: "Horizon",
  bands: "Bands", mesh: "Mesh", fluid: "Fluid",
};

function ramps(cfg) {
  return makeRamp(cfg.stops, cfg.space, cfg.easing, cfg.bias);
}

/* --------------------------------------------------------------- shapes */

function drawLinear(ctx, w, h, cfg, ramp) {
  const a = (cfg.angle || 0) * Math.PI / 180;
  // span the full diagonal so the ramp never clips at a corner
  const cx = w / 2, cy = h / 2;
  const len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
  const g = ctx.createLinearGradient(
    cx - Math.cos(a) * len / 2, cy - Math.sin(a) * len / 2,
    cx + Math.cos(a) * len / 2, cy + Math.sin(a) * len / 2);
  applyStops(g, ramp, 64);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawRadial(ctx, w, h, cfg, ramp) {
  const cx = w * cfg.cx, cy = h * cfg.cy;
  const r = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * cfg.radius;
  ctx.save();
  if (cfg.squash !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(1, Math.max(0.05, cfg.squash));
    ctx.translate(-cx, -cy);
  }
  const g = ctx.createRadialGradient(cx, cy, r * cfg.inner, cx, cy, Math.max(1, r));
  applyStops(g, ramp, 64);
  ctx.fillStyle = g;
  ctx.fillRect(-w, -h, w * 3, h * 3);
  ctx.restore();
}

function drawConic(ctx, w, h, cfg, ramp) {
  const cx = w * cfg.cx, cy = h * cfg.cy;
  if (!ctx.createConicGradient) return drawRadial(ctx, w, h, cfg, ramp);
  const g = ctx.createConicGradient((cfg.angle || 0) * Math.PI / 180, cx, cy);
  // mirror so the seam where 1 meets 0 is not a hard line
  const n = 96;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = cfg.mirror ? 1 - Math.abs(t * 2 - 1) : t;
    g.addColorStop(t, rgbToHex(ramp(u)));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// Sky over water: a ramp to the horizon, then the same ramp mirrored and
// compressed below it, the way a flat sea returns the sky.
function drawHorizon(ctx, w, h, cfg, ramp) {
  const y = Math.round(h * cfg.horizon);
  const sky = ctx.createLinearGradient(0, 0, 0, y);
  applyStops(sky, ramp, 64);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, y);

  const depth = h - y;
  if (depth > 0) {
    const sea = ctx.createLinearGradient(0, y, 0, h);
    const n = 64;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // reflection runs back up the ramp, then dives past its dark end
      const u = 1 - Math.pow(t, 1 / Math.max(0.15, cfg.reflect));
      const c = ramp(u);
      const k = 1 - t * cfg.deepen;
      sea.addColorStop(t, rgbToHex([c[0] * k, c[1] * k, c[2] * k]));
    }
    ctx.fillStyle = sea;
    ctx.fillRect(0, y, w, depth);
  }
  if (cfg.line > 0) {
    ctx.save();
    ctx.globalAlpha = cfg.line;
    ctx.fillStyle = rgbToHex(ramp(1));
    ctx.fillRect(0, y - 1, w, 2);
    ctx.restore();
  }
}

// Hard stripes with a soft falloff inside each, the poster look.
function drawBands(ctx, w, h, cfg, ramp) {
  const n = Math.max(2, Math.round(cfg.bands));
  const a = (cfg.angle || 0) * Math.PI / 180;
  const diag = Math.hypot(w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(a);
  ctx.translate(-diag / 2, -diag / 2);
  const step = diag / n;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const g = ctx.createLinearGradient(0, i * step, 0, (i + 1) * step);
    const soft = clamp01(cfg.soft);
    const inner = 0.5 - soft / 2, outer = 0.5 + soft / 2;
    const cA = ramp(cfg.alternate && i % 2 ? t1 : t0);
    const cB = ramp(cfg.alternate && i % 2 ? t0 : t1);
    g.addColorStop(0, rgbToHex(cA));
    g.addColorStop(clamp01(inner), rgbToHex(cA));
    g.addColorStop(clamp01(outer), rgbToHex(cB));
    g.addColorStop(1, rgbToHex(cB));
    ctx.fillStyle = g;
    ctx.fillRect(0, i * step, diag, step + 1);
  }
  ctx.restore();
}

// Mesh: colour points pulling on every pixel, weighted by distance. Computed
// small and scaled up, it is all low frequency, and a full-size per-pixel pass
// would cost a second per frame for no visible gain.
function meshPoints(cfg) {
  const r = rng(cfg.seed + "|mesh");
  const cols = cfg.stops.map(s => s.hex);
  const n = Math.max(2, Math.min(12, Math.round(cfg.points)));
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({
      x: r.range(-0.1, 1.1), y: r.range(-0.1, 1.1),
      r: r.range(0.25, 0.95) * cfg.spread,
      lab: rgbToOklab(hexToRgb(cols[i % cols.length])),
    });
  }
  return pts;
}

function drawMesh(ctx, w, h, cfg, ramp) {
  const pts = meshPoints(cfg);
  const scale = Math.min(1, 260 / Math.max(w, h));
  const bw = Math.max(8, Math.round(w * scale)), bh = Math.max(8, Math.round(h * scale));
  const buf = document.createElement("canvas");
  buf.width = bw; buf.height = bh;
  const bx = buf.getContext("2d");
  const img = bx.createImageData(bw, bh), d = img.data;
  const p = 1 + cfg.falloff * 4;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const u = x / bw, v = y / bh;
    let wl = 0, wa = 0, wb = 0, ws = 0;
    for (const pt of pts) {
      const dx = (u - pt.x), dy = (v - pt.y);
      const dist = Math.pow(Math.max(1e-4, (dx * dx + dy * dy) / (pt.r * pt.r)), p / 2);
      const weight = 1 / dist;
      wl += pt.lab[0] * weight; wa += pt.lab[1] * weight; wb += pt.lab[2] * weight; ws += weight;
    }
    const rgb = oklabToRgb([wl / ws, wa / ws, wb / ws]);
    const i = (y * bw + x) * 4;
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
  }
  bx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(buf, 0, 0, w, h);
  ctx.restore();
}

// Fluid: the ramp read through warped noise, the marbled, poured look.
function drawFluid(ctx, w, h, cfg, ramp) {
  const scale = Math.min(1, 420 / Math.max(w, h));
  const bw = Math.max(8, Math.round(w * scale)), bh = Math.max(8, Math.round(h * scale));
  const buf = document.createElement("canvas");
  buf.width = bw; buf.height = bh;
  const bx = buf.getContext("2d");
  const img = bx.createImageData(bw, bh), d = img.data;
  const seed = hashSeed(cfg.seed + "|fluid") & 0xffff;
  const S = cfg.scale, warp = cfg.warp, oct = Math.round(cfg.detail);
  const lut = [];
  for (let i = 0; i <= 256; i++) lut.push(ramp(i / 256));
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const u = (x / bw) * S, v = (y / bh) * S;
    const qx = fbm(u + 1.7, v + 9.2, seed, 3);
    const qy = fbm(u + 8.3, v + 2.8, seed + 97, 3);
    let n = fbm(u + warp * qx * 4, v + warp * qy * 4, seed + 311, oct);
    n = clamp01((n - 0.5) * (1 + cfg.contrast * 3) + 0.5);
    const c = lut[Math.round(n * 256)];
    const i = (y * bw + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  bx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(buf, 0, 0, w, h);
  ctx.restore();
}

const RENDERERS = { linear: drawLinear, radial: drawRadial, conic: drawConic,
  horizon: drawHorizon, bands: drawBands, mesh: drawMesh, fluid: drawFluid };

/* ------------------------------------------------------- finishing passes */

function postBlur(ctx, w, h, px) {
  if (!(px > 0.2)) return;
  const b = document.createElement("canvas");
  b.width = w; b.height = h;
  const bc = b.getContext("2d");
  bc.drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.filter = "blur(" + px + "px)";
  // draw oversized so the blur does not pull the frame edge inwards
  ctx.drawImage(b, -px * 2, -px * 2, w + px * 4, h + px * 4);
  ctx.restore();
}

function postPosterize(ctx, w, h, levels) {
  if (!(levels >= 2 && levels < 64)) return;
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const q = levels - 1;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.round(d[i] / 255 * q) / q * 255;
    d[i + 1] = Math.round(d[i + 1] / 255 * q) / q * 255;
    d[i + 2] = Math.round(d[i + 2] / 255 * q) / q * 255;
  }
  ctx.putImageData(img, 0, 0);
}

// Ordered dither at ±1 step. A smooth ramp across 2000 px crosses far fewer
// than 2000 distinct 8-bit values, and the eye picks out the steps as bands;
// a sub-step of noise hides them without looking like grain.
const BAYER8 = (() => {
  let m = [[0]];
  while (m.length < 8) {
    const s = m.length, n = [];
    for (let y = 0; y < s * 2; y++) n.push(new Array(s * 2));
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const v = 4 * m[y][x];
      n[y][x] = v; n[y][x + s] = v + 2; n[y + s][x] = v + 3; n[y + s][x + s] = v + 1;
    }
    m = n;
  }
  const f = new Float32Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) f[y * 8 + x] = (m[y][x] + 0.5) / 64 - 0.5;
  return f;
})();

function postDither(ctx, w, h, strength) {
  if (!(strength > 0)) return;
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = BAYER8[(y & 7) * 8 + (x & 7)] * strength * 2;
    const i = (y * w + x) * 4;
    d[i] += t; d[i + 1] += t; d[i + 2] += t;
  }
  ctx.putImageData(img, 0, 0);
}

// `scale` is how big this render is against the configured canvas. Grain is the
// one pass measured in device pixels, so without it the preview shows coarse
// noise and the full-size export shows fine dust, different pictures.
function postGrain(ctx, w, h, cfg, scale) {
  const amt = cfg.grain;
  if (!(amt > 0)) return;
  const size = Math.max(0.35, cfg.grainSize * (scale || 1));
  const tw = Math.max(2, Math.round(256 / size)), th = tw;
  const tile = document.createElement("canvas");
  tile.width = tw; tile.height = th;
  const tx = tile.getContext("2d");
  const img = tx.createImageData(tw, th), d = img.data;
  const seed = hashSeed(cfg.seed + "|grain");
  for (let i = 0; i < tw * th; i++) {
    const n = hash2(i, 7, seed), m = cfg.grainColour ? hash2(i, 11, seed) : n, o = cfg.grainColour ? hash2(i, 13, seed) : n;
    const j = i * 4;
    d[j] = n * 255; d[j + 1] = m * 255; d[j + 2] = o * 255; d[j + 3] = 255;
  }
  tx.putImageData(img, 0, 0);
  const big = document.createElement("canvas");
  big.width = Math.round(tw * size); big.height = Math.round(th * size);
  const bg = big.getContext("2d");
  bg.imageSmoothingEnabled = size > 2;
  bg.drawImage(tile, 0, 0, big.width, big.height);
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = amt;
  const pat = ctx.createPattern(big, "repeat");
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function postVignette(ctx, w, h, amount, softness) {
  if (!(amount > 0)) return;
  const r = Math.hypot(w, h) / 2;
  const g = ctx.createRadialGradient(w / 2, h / 2, r * (1 - clamp01(softness)), w / 2, h / 2, r);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0," + amount + ")");
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function postAdjust(ctx, w, h, cfg) {
  // adj* names, because `contrast` already belongs to the fluid renderer
  const f = [];
  if (cfg.adjBright !== 1) f.push("brightness(" + cfg.adjBright + ")");
  if (cfg.adjContrast !== 1) f.push("contrast(" + cfg.adjContrast + ")");
  if (cfg.adjSat !== 1) f.push("saturate(" + cfg.adjSat + ")");
  if (cfg.adjHue) f.push("hue-rotate(" + cfg.adjHue + "deg)");
  if (!f.length) return;
  const b = document.createElement("canvas");
  b.width = w; b.height = h;
  b.getContext("2d").drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "copy";
  ctx.filter = f.join(" ");
  ctx.drawImage(b, 0, 0);
  ctx.restore();
}

/* ------------------------------------------------------------- overlay */

function drawOverlay(ctx, w, h, cfg) {
  if (!cfg.label && !cfg.hexList) return;
  const unit = Math.min(w, h);
  const size = Math.max(7, unit * cfg.labelSize / 100);
  const pad = unit * cfg.labelPad / 100;
  const lines = [];
  if (cfg.label) String(cfg.label).split("\n").forEach(l => lines.push(l));
  if (cfg.hexList) {
    if (lines.length) lines.push("–");
    cfg.stops.forEach(s => lines.push(s.hex.toUpperCase()));
  }
  if (!lines.length) return;
  ctx.save();
  ctx.font = "400 " + size + 'px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textBaseline = "top";
  const lh = size * 1.55;
  const widest = Math.max.apply(null, lines.map(l => ctx.measureText(l).width));
  const blockH = lines.length * lh;
  const pos = cfg.labelPos || "tl";
  let x = pad, y = pad;
  if (pos.includes("c")) x = (w - widest) / 2;
  if (pos.includes("r")) x = w - widest - pad;
  if (pos.startsWith("m")) y = (h - blockH) / 2;
  if (pos.startsWith("b")) y = h - blockH - pad;
  ctx.textAlign = "left";
  // sample the frame under the block and pick ink that will actually read
  let ink = cfg.labelColour;
  if (cfg.labelAuto) {
    const sx = Math.max(0, Math.min(w - 1, Math.round(x + widest / 2)));
    const sy = Math.max(0, Math.min(h - 1, Math.round(y + blockH / 2)));
    const p = ctx.getImageData(sx, sy, 1, 1).data;
    const lum = (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
    ink = lum > 0.55 ? "#111111" : "#ffffff";
  }
  ctx.fillStyle = ink;
  ctx.globalAlpha = cfg.labelOpacity;
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  ctx.restore();
}

function drawFrame(ctx, w, h, cfg) {
  if (!(cfg.margin > 0)) return;
  const m = Math.min(w, h) * cfg.margin / 100;
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = "#000";
  ctx.fillRect(m, m, w - m * 2, h - m * 2);
  ctx.restore();
}

/* --------------------------------------------------------------- compose */

function renderGradient(canvas, cfg, w, h) {
  canvas.width = Math.max(2, Math.round(w));
  canvas.height = Math.max(2, Math.round(h));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const ramp = ramps(cfg);
  (RENDERERS[cfg.type] || drawLinear)(ctx, canvas.width, canvas.height, cfg, ramp);

  const unit = Math.min(canvas.width, canvas.height);
  const scale = cfg.w ? canvas.width / cfg.w : 1;
  postBlur(ctx, canvas.width, canvas.height, cfg.smooth * unit / 100);
  postAdjust(ctx, canvas.width, canvas.height, cfg);
  postPosterize(ctx, canvas.width, canvas.height, cfg.posterize);
  postVignette(ctx, canvas.width, canvas.height, cfg.vignette, cfg.vignetteSoft);
  postDither(ctx, canvas.width, canvas.height, cfg.dither);
  postGrain(ctx, canvas.width, canvas.height, cfg, scale);
  drawOverlay(ctx, canvas.width, canvas.height, cfg);
  drawFrame(ctx, canvas.width, canvas.height, cfg);
  return canvas;
}

/* ------------------------------------------------------------ code export */

function cssGradient(cfg) {
  const ramp = ramps(cfg);
  const n = 12;
  const stops = [];
  for (let i = 0; i <= n; i++) stops.push(rgbToHex(ramp(i / n)) + " " + Math.round(i / n * 100) + "%");
  if (cfg.type === "radial" || cfg.type === "mesh" || cfg.type === "fluid") {
    if (cfg.type === "mesh") {
      // a stack of radial blobs is the honest CSS equivalent of a mesh
      const pts = meshPoints(cfg);
      const layers = pts.map(p => "radial-gradient(circle at " + (p.x * 100).toFixed(1) + "% " +
        (p.y * 100).toFixed(1) + "%, " + rgbToHex(oklabToRgb(p.lab)) + " 0%, transparent " +
        Math.round(p.r * 100) + "%)");
      return "background-color: " + cfg.stops[0].hex + ";\nbackground-image:\n  " + layers.join(",\n  ") + ";";
    }
    return "background-image: radial-gradient(circle at " + Math.round(cfg.cx * 100) + "% " +
      Math.round(cfg.cy * 100) + "%, " + stops.join(", ") + ");";
  }
  if (cfg.type === "conic") {
    return "background-image: conic-gradient(from " + Math.round(cfg.angle) + "deg at " +
      Math.round(cfg.cx * 100) + "% " + Math.round(cfg.cy * 100) + "%, " + stops.join(", ") + ");";
  }
  // CSS measures from "to top" while canvas measures from the x axis
  const deg = (Math.round(cfg.angle || 0) + 90) % 360;
  return "background-image: linear-gradient(" + deg + "deg, " + stops.join(", ") + ");";
}

function svgGradient(cfg, w, h) {
  const ramp = ramps(cfg);
  const n = 24;
  const stops = [];
  for (let i = 0; i <= n; i++)
    stops.push('<stop offset="' + (i / n * 100).toFixed(1) + '%" stop-color="' + rgbToHex(ramp(i / n)) + '"/>');
  let def;
  if (cfg.type === "radial" || cfg.type === "mesh" || cfg.type === "fluid") {
    def = '<radialGradient id="g" cx="' + (cfg.cx * 100).toFixed(1) + '%" cy="' +
      (cfg.cy * 100).toFixed(1) + '%" r="' + (cfg.radius * 75).toFixed(1) + '%">' + stops.join("") + "</radialGradient>";
  } else {
    const a = ((cfg.angle || 0)) * Math.PI / 180;
    const x1 = (50 - Math.cos(a) * 50).toFixed(1), y1 = (50 - Math.sin(a) * 50).toFixed(1);
    const x2 = (50 + Math.cos(a) * 50).toFixed(1), y2 = (50 + Math.sin(a) * 50).toFixed(1);
    def = '<linearGradient id="g" x1="' + x1 + '%" y1="' + y1 + '%" x2="' + x2 + '%" y2="' + y2 + '%">' +
      stops.join("") + "</linearGradient>";
  }
  const grain = cfg.grain > 0
    ? '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="' +
      (0.9 / Math.max(1, cfg.grainSize)).toFixed(3) + '" numOctaves="2"/>' +
      '<feColorMatrix type="saturate" values="' + (cfg.grainColour ? 1 : 0) + '"/></filter>' +
      '<rect width="100%" height="100%" filter="url(#n)" opacity="' + cfg.grain.toFixed(2) +
      '" style="mix-blend-mode:overlay"/>'
    : "";
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(w) + '" height="' +
    Math.round(h) + '" viewBox="0 0 ' + Math.round(w) + " " + Math.round(h) + '">' +
    "<defs>" + def + "</defs>" +
    '<rect width="100%" height="100%" fill="url(#g)"/>' + grain + "</svg>";
}

const VECTOR_TYPES = ["linear", "radial", "conic"];
