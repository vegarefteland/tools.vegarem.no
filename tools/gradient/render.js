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
  return makeRamp(cfg.stops, cfg.space, cfg.easing, cfg.bias, { hue: cfg.hue, spline: cfg.spline });
}

/* ----------------------------------------------------------------- samplers
 * Every type is a sampler: (x, y, out) writes a float RGB for that pixel.
 * renderGradient runs it over the frame and only then rounds to 8 bits,
 * with dither added just before the rounding. That order is the whole point:
 * the browser's own gradients are already 8-bit when they reach the canvas,
 * and noise added after that cannot bring back the levels that were lost. */

function lutAt(L, t, o) {
  t = (t < 0 ? 0 : t > 1 ? 1 : t) * L.n;
  const i = t | 0, f = t - i, a = i * 3, b = Math.min(L.n, i + 1) * 3, l = L.lut;
  o[0] = l[a] + (l[b] - l[a]) * f;
  o[1] = l[a + 1] + (l[b + 1] - l[a + 1]) * f;
  o[2] = l[a + 2] + (l[b + 2] - l[a + 2]) * f;
}

function sampleLinear(w, h, cfg, L) {
  const a = (cfg.angle || 0) * Math.PI / 180;
  // span the full diagonal so the ramp never clips at a corner
  const len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)) || 1;
  const ca = Math.cos(a) / len, sa = Math.sin(a) / len, cx = w / 2, cy = h / 2;
  return (x, y, o) => lutAt(L, (x - cx) * ca + (y - cy) * sa + 0.5, o);
}

function sampleRadial(w, h, cfg, L) {
  const cx = w * cfg.cx, cy = h * cfg.cy;
  const r = Math.max(1, Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * cfg.radius);
  const r0 = r * cfg.inner, sq = Math.max(0.05, cfg.squash);
  return (x, y, o) => lutAt(L, (Math.hypot(x - cx, (y - cy) / sq) - r0) / Math.max(1e-6, r - r0), o);
}

function sampleConic(w, h, cfg, L) {
  const cx = w * cfg.cx, cy = h * cfg.cy, a0 = (cfg.angle || 0) * Math.PI / 180;
  return (x, y, o) => {
    let t = (Math.atan2(y - cy, x - cx) - a0) / TAU;
    t -= Math.floor(t);
    // mirror so the seam where 1 meets 0 is not a hard line
    lutAt(L, cfg.mirror ? 1 - Math.abs(t * 2 - 1) : t, o);
  };
}

// Sky over water: a ramp to the horizon, then the same ramp mirrored and
// compressed below it, the way a flat sea returns the sky.
function sampleHorizon(w, h, cfg, L) {
  const yH = Math.round(h * cfg.horizon), depth = Math.max(1, h - yH);
  const k = 1 / Math.max(0.15, cfg.reflect), top = [0, 0, 0];
  lutAt(L, 1, top);
  return (x, y, o) => {
    if (y < yH) lutAt(L, y / Math.max(1, yH), o);
    else {
      const t = (y - yH) / depth;
      lutAt(L, 1 - Math.pow(t, k), o);
      const d = 1 - t * cfg.deepen;
      o[0] *= d; o[1] *= d; o[2] *= d;
    }
    if (cfg.line > 0 && y >= yH - 1 && y < yH + 1) {
      const g = cfg.line;
      o[0] += (top[0] - o[0]) * g; o[1] += (top[1] - o[1]) * g; o[2] += (top[2] - o[2]) * g;
    }
  };
}

// Hard stripes with a soft falloff inside each, the poster look.
function sampleBands(w, h, cfg, L) {
  const n = Math.max(2, Math.round(cfg.bands));
  const a = (cfg.angle || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const diag = Math.hypot(w, h), step = diag / n, soft = clamp01(cfg.soft);
  const inner = 0.5 - soft / 2, outer = 0.5 + soft / 2;
  const cols = [];
  for (let i = 0; i <= n; i++) { const c = [0, 0, 0]; lutAt(L, i / n, c); cols.push(c); }
  return (x, y, o) => {
    // into the rotated band frame (inverse of rotate(a) about the centre)
    const dx = x - w / 2, dy = y - h / 2;
    const by = -sa * dx + ca * dy + diag / 2;
    let i = Math.floor(by / step); if (i < 0) i = 0; else if (i > n - 1) i = n - 1;
    const f = by / step - i;
    const flip = cfg.alternate && i % 2;
    const A = cols[flip ? i + 1 : i], B = cols[flip ? i : i + 1];
    const u = f <= inner ? 0 : f >= outer ? 1 : (f - inner) / Math.max(1e-6, outer - inner);
    o[0] = A[0] + (B[0] - A[0]) * u; o[1] = A[1] + (B[1] - A[1]) * u; o[2] = A[2] + (B[2] - A[2]) * u;
  };
}

// Low-frequency types (mesh, fluid) are computed small and read back with
// bilinear filtering in float, so scaling up adds no 8-bit steps of its own.
function bufferSampler(buf, bw, bh, w, h) {
  return (x, y, o) => {
    let fx = x / w * bw - 0.5, fy = y / h * bh - 0.5;
    if (fx < 0) fx = 0; else if (fx > bw - 1) fx = bw - 1;
    if (fy < 0) fy = 0; else if (fy > bh - 1) fy = bh - 1;
    const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1);
    const u = fx - x0, v = fy - y0;
    const i00 = (y0 * bw + x0) * 3, i10 = (y0 * bw + x1) * 3, i01 = (y1 * bw + x0) * 3, i11 = (y1 * bw + x1) * 3;
    for (let c = 0; c < 3; c++) {
      const top = buf[i00 + c] + (buf[i10 + c] - buf[i00 + c]) * u;
      const bot = buf[i01 + c] + (buf[i11 + c] - buf[i01 + c]) * u;
      o[c] = top + (bot - top) * v;
    }
  };
}

// Mesh: colour points pulling on every pixel. "Soft" weights each point with a
// Gaussian and normalises the sum, a smooth field with no bull's-eye around a
// point. "Points" is the original inverse-distance weighting, sharper and
// knottier, kept for that look.
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
  // points dragged on the preview override the seeded positions
  if (Array.isArray(cfg.meshPos) && cfg.meshPos.length === n)
    pts.forEach((p, i) => { p.x = cfg.meshPos[i][0]; p.y = cfg.meshPos[i][1]; });
  return pts;
}

function sampleMesh(w, h, cfg) {
  const pts = meshPoints(cfg);
  const scale = Math.min(1, 360 / Math.max(w, h));
  const bw = Math.max(8, Math.round(w * scale)), bh = Math.max(8, Math.round(h * scale));
  const buf = new Float32Array(bw * bh * 3);
  const soft = cfg.meshStyle !== "points";
  const p = 1 + cfg.falloff * 4;
  const sig = lerp(0.75, 0.22, clamp01(cfg.falloff));
  const e = new Float64Array(pts.length);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const u = (x + 0.5) / bw, v = (y + 0.5) / bh;
    let wl = 0, wa = 0, wb = 0, ws = 0;
    if (soft) {
      let emax = -Infinity;
      for (let k = 0; k < pts.length; k++) {
        const pt = pts[k], dx = u - pt.x, dy = v - pt.y, s2 = (pt.r * sig) * (pt.r * sig);
        e[k] = -(dx * dx + dy * dy) / (2 * s2);
        if (e[k] > emax) emax = e[k];
      }
      for (let k = 0; k < pts.length; k++) {
        const wt = Math.exp(e[k] - emax), lab = pts[k].lab;
        wl += lab[0] * wt; wa += lab[1] * wt; wb += lab[2] * wt; ws += wt;
      }
    } else {
      for (const pt of pts) {
        const dx = u - pt.x, dy = v - pt.y;
        const wt = 1 / Math.pow(Math.max(1e-4, (dx * dx + dy * dy) / (pt.r * pt.r)), p / 2);
        wl += pt.lab[0] * wt; wa += pt.lab[1] * wt; wb += pt.lab[2] * wt; ws += wt;
      }
    }
    const rgb = oklabToRgbMapped([wl / ws, wa / ws, wb / ws]);
    const i = (y * bw + x) * 3;
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2];
  }
  return bufferSampler(buf, bw, bh, w, h);
}

// Fluid: the ramp read through warped noise, the marbled, poured look.
function sampleFluid(w, h, cfg, L) {
  const scale = Math.min(1, 480 / Math.max(w, h));
  const bw = Math.max(8, Math.round(w * scale)), bh = Math.max(8, Math.round(h * scale));
  const buf = new Float32Array(bw * bh * 3);
  const seed = hashSeed(cfg.seed + "|fluid") & 0xffff;
  const S = cfg.scale, warp = cfg.warp, oct = Math.round(cfg.detail), o = [0, 0, 0];
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const u = (x / bw) * S, v = (y / bh) * S;
    const qx = fbm(u + 1.7, v + 9.2, seed, 3);
    const qy = fbm(u + 8.3, v + 2.8, seed + 97, 3);
    let n = fbm(u + warp * qx * 4, v + warp * qy * 4, seed + 311, oct);
    n = clamp01((n - 0.5) * (1 + cfg.contrast * 3) + 0.5);
    lutAt(L, n, o);
    const i = (y * bw + x) * 3;
    buf[i] = o[0]; buf[i + 1] = o[1]; buf[i + 2] = o[2];
  }
  return bufferSampler(buf, bw, bh, w, h);
}

const SAMPLERS = { linear: sampleLinear, radial: sampleRadial, conic: sampleConic,
  horizon: sampleHorizon, bands: sampleBands, mesh: sampleMesh, fluid: sampleFluid };

/* ----------------------------------------------------------------- dither
 * Triangular-PDF noise, two uniform values summed, spanning ±1 step at
 * strength 1. Uniform noise of the same size leaves faint bands where it
 * happens to cancel; triangular does not, and it is the lowest-power dither
 * that fully decorrelates the rounding error (Gjøl, "Banding in Games";
 * Wronski, "Dithering part three"). One value per pixel for all three
 * channels, so it reads as fine luminance grain rather than coloured fizz. */
const TPDF = (() => {
  const n = 256, t = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) t[i] = hash2(i, 3, 9173) + hash2(i, 5, 4129) - 1;
  return t;
})();

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
  if (!cfg.label && !cfg.hexList) return null;
  const unit = Math.min(w, h);
  const size = Math.max(7, unit * cfg.labelSize / 100);
  const pad = unit * cfg.labelPad / 100;
  const lines = [];
  if (cfg.label) String(cfg.label).split("\n").forEach(l => lines.push(l));
  if (cfg.hexList) {
    if (lines.length) lines.push("–");
    cfg.stops.forEach(s => lines.push(s.hex.toUpperCase()));
  }
  if (!lines.length) return null;
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
  // Contrast on a gradient is a range, not a number: check a grid of points
  // under the whole block and judge each ink by its worst point (WCAG 2 ratio).
  const relLum = (r, g, b) => 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const bx = Math.max(0, Math.floor(x)), by = Math.max(0, Math.floor(y));
  const bw = Math.max(1, Math.min(w - bx, Math.ceil(widest))), bh = Math.max(1, Math.min(h - by, Math.ceil(blockH)));
  const px = ctx.getImageData(bx, by, bw, bh).data, lums = [];
  for (let j = 0; j < 6; j++) for (let i = 0; i < 9; i++) {
    const sx = Math.min(bw - 1, Math.round((i + 0.5) / 9 * bw)), sy = Math.min(bh - 1, Math.round((j + 0.5) / 6 * bh));
    const k = (sy * bw + sx) * 4;
    lums.push(relLum(px[k], px[k + 1], px[k + 2]));
  }
  const worst = inkHex => { const c = hexToRgb(inkHex), L = relLum(c[0], c[1], c[2]); return Math.min.apply(null, lums.map(b => ratio(L, b))); };
  let ink = cfg.labelColour;
  if (cfg.labelAuto) ink = worst("#111111") >= worst("#ffffff") ? "#111111" : "#ffffff";
  const contrast = worst(ink);
  ctx.fillStyle = ink;
  ctx.globalAlpha = cfg.labelOpacity;
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  ctx.restore();
  return { ink, contrast };
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
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";

  const L = rampLUT(ramps(cfg));
  const sample = (SAMPLERS[cfg.type] || sampleLinear)(W, H, cfg, L);

  // vignette in float too, a dark radial falloff is exactly where 8-bit steps show
  const vig = cfg.vignette > 0 ? cfg.vignette : 0;
  const vr = Math.hypot(W, H) / 2, vr0 = vr * (1 - clamp01(cfg.vignetteSoft)), vspan = Math.max(1e-6, vr - vr0);
  const dith = cfg.dither > 0 ? cfg.dither : 0;

  const img = ctx.createImageData(W, H), d = img.data, o = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    const row = (y & 255) << 8;
    for (let x = 0; x < W; x++) {
      sample(x + 0.5, y + 0.5, o);
      let r = o[0], g = o[1], b = o[2];
      if (vig) {
        const t = (Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2) - vr0) / vspan;
        if (t > 0) { const k = 1 - vig * (t > 1 ? 1 : t); r *= k; g *= k; b *= k; }
      }
      if (dith) { const n = TPDF[row | (x & 255)] * dith; r += n; g += n; b += n; }
      const i = (y * W + x) << 2;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;   // Uint8Clamped rounds and clamps
    }
  }
  ctx.putImageData(img, 0, 0);

  const unit = Math.min(W, H);
  const scale = cfg.w ? W / cfg.w : 1;
  postBlur(ctx, W, H, cfg.smooth * unit / 100);
  postAdjust(ctx, W, H, cfg);
  postPosterize(ctx, W, H, cfg.posterize);
  postGrain(ctx, W, H, cfg, scale);
  canvas.labelInfo = drawOverlay(ctx, W, H, cfg);
  drawFrame(ctx, W, H, cfg);
  return canvas;
}

/* ------------------------------------------------------------ code export */

// Copy CSS: a hex-stop fallback first, then the same gradient mixed natively
// by the browser (CSS Color 4 interpolation, Baseline 2024). Browsers that do
// not understand the second line keep the first.
const oklchCss = rgb => {
  const lch = rgbToLch(rgb), h = ((lch[2] * 180 / Math.PI) % 360 + 360) % 360;
  return "oklch(" + (lch[0] * 100).toFixed(1) + "% " + lch[1].toFixed(3) + " " + h.toFixed(1) + ")";
};
function cssGradient(cfg) {
  const ramp = ramps(cfg);
  const n = 12;
  const hexStops = [], okStops = [];
  for (let i = 0; i <= n; i++) {
    const c = ramp(i / n), pc = Math.round(i / n * 100) + "%";
    hexStops.push(rgbToHex(c) + " " + pc);
    okStops.push(oklchCss(c) + " " + pc);
  }
  if (cfg.type === "mesh") {
    // a stack of radial blobs is the honest CSS equivalent of a mesh
    const pts = meshPoints(cfg);
    const layers = pts.map(p => "radial-gradient(circle at " + (p.x * 100).toFixed(1) + "% " +
      (p.y * 100).toFixed(1) + "%, " + rgbToHex(oklabToRgbMapped(p.lab)) + " 0%, transparent " +
      Math.round(p.r * 100) + "%)");
    return "background-color: " + cfg.stops[0].hex + ";\nbackground-image:\n  " + layers.join(",\n  ") + ";";
  }
  // When the ramp is plain (no easing, bias or spline) hand CSS the real stops
  // and let it mix in the same space; otherwise give it the sampled curve.
  const plain = !cfg.spline && cfg.easing === "linear" && Math.abs((cfg.bias ?? 0.5) - 0.5) < 1e-3;
  const spaceKw = { oklab: "oklab", oklch: "oklch", srgb: "srgb", linear: "srgb-linear", hsl: "hsl" }[cfg.space] || "oklab";
  const polar = cfg.space === "oklch" || cfg.space === "hsl";
  const method = plain
    ? "in " + spaceKw + (polar && cfg.hue && cfg.hue !== "shorter" ? " " + cfg.hue + " hue" : "")
    : "in oklab";
  const modernStops = plain
    ? cfg.stops.slice().sort((a, b) => a.pos - b.pos).map(st => st.hex + " " + Math.round(st.pos * 100) + "%")
    : okStops;
  let shape, shapeModern;
  if (cfg.type === "radial" || cfg.type === "fluid") {
    shape = "radial-gradient(circle at " + Math.round(cfg.cx * 100) + "% " + Math.round(cfg.cy * 100) + "%, ";
    shapeModern = "radial-gradient(circle at " + Math.round(cfg.cx * 100) + "% " + Math.round(cfg.cy * 100) + "% " + method + ", ";
  } else if (cfg.type === "conic") {
    const at = "from " + Math.round(cfg.angle) + "deg at " + Math.round(cfg.cx * 100) + "% " + Math.round(cfg.cy * 100) + "%";
    shape = "conic-gradient(" + at + ", ";
    shapeModern = "conic-gradient(" + at + " " + method + ", ";
  } else {
    // CSS measures from "to top" while canvas measures from the x axis
    const deg = (Math.round(cfg.angle || 0) + 90) % 360;
    shape = "linear-gradient(" + deg + "deg, ";
    shapeModern = "linear-gradient(" + deg + "deg " + method + ", ";
  }
  return "background-image: " + shape + hexStops.join(", ") + ");\n" +
         "background-image: " + shapeModern + modernStops.join(", ") + ");";
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
