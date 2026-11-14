/* Pixel, Bitmap & ASCII — render engine.
 *
 * Per frame:
 *   source → sample grid (box-filtered in halvings, so video doesn't shimmer)
 *          → grid FX (glitch, wave) → adjustments → sharpen / edges
 *          → motion FX (frame difference, flicker, digital rain)
 *          → mode (pixel | bitmap | ascii | braille) → trails → post FX
 *
 * Shapes and glyphs are drawn as a white mask, then coloured in one pass
 * ("source-atop" with the per-cell colour grid scaled up nearest-neighbour).
 * That is what keeps tens of thousands of cells at interactive frame rates.
 *
 * Nothing here touches the DOM at load time, so the pure helpers (palettes,
 * dithering, colour maths) can be exercised outside a browser.
 */
"use strict";

/* ------------------------------------------------------------------ data */

const PALETTES = {
  gameboy:  ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  gbgray:   ["#000000", "#555555", "#aaaaaa", "#ffffff"],
  cga1:     ["#000000", "#55ffff", "#ff55ff", "#ffffff"],
  cga2:     ["#000000", "#55ff55", "#ff5555", "#ffff55"],
  pico8:    ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
             "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"],
  c64:      ["#000000", "#626262", "#898989", "#adadad", "#ffffff", "#9f4e44", "#cb7e75", "#6d5412",
             "#a1683c", "#c9d487", "#9ae29b", "#5cab5e", "#6abfc6", "#887ecb", "#50459b", "#a057a3"],
  zx:       ["#000000", "#0000d8", "#d80000", "#d800d8", "#00d800", "#00d8d8", "#d8d800", "#d8d8d8",
             "#0000ff", "#ff0000", "#ff00ff", "#00ff00", "#00ffff", "#ffff00", "#ffffff"],
  mac:      ["#000000", "#ffffff"],
  obradinn: ["#333319", "#e5ffff"],
  amber:    ["#140a00", "#6b4200", "#c47a00", "#ffb000"],
  phosphor: ["#031a09", "#0b5c25", "#1fae4b", "#6cff9a"],
  sepia:    ["#2b1d0e", "#6b4f2e", "#b08d5e", "#efdcb8"],
  gray4:    ["#000000", "#555555", "#aaaaaa", "#ffffff"],
  gray8:    ["#000000", "#242424", "#494949", "#6d6d6d", "#929292", "#b6b6b6", "#dbdbdb", "#ffffff"],
  cyber:    ["#0d0221", "#261447", "#ff3864", "#2de2e6"],
  riso:     ["#1d3fbb", "#ff48b0", "#f7f3ea"],
  vapor:    ["#1a1a2e", "#ff71ce", "#01cdfe", "#05ffa1", "#b967ff", "#fffb96"],
};

// Ramps run dark → light, so a space maps to the darkest cells.
const CHARSETS = {
  standard: " .:-=+*#%@",
  simple:   " .:oO@",
  detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks:   " ░▒▓█",
  bars:     " ▁▂▃▄▅▆▇█",
  dots:     " ·•●",
  shapes:   " ·∘○◎●",
  binary:   " 01",
  hex:      " 0123456789ABCDEF",
  katakana: " ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ",
  lines:    " -=≡",
};

// Indexed by edge-direction bin: 0 vertical, 1 rising diagonal, 2 horizontal, 3 falling diagonal.
const EDGE_CHARS = { ascii: "|/-\\", box: "│╱─╲" };

const KERNELS = {
  floyd:      [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
  atkinson:   [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
  jjn:        [[1, 0, 7 / 48], [2, 0, 5 / 48], [-2, 1, 3 / 48], [-1, 1, 5 / 48], [0, 1, 7 / 48], [1, 1, 5 / 48],
               [2, 1, 3 / 48], [-2, 2, 1 / 48], [-1, 2, 3 / 48], [0, 2, 5 / 48], [1, 2, 3 / 48], [2, 2, 1 / 48]],
  stucki:     [[1, 0, 8 / 42], [2, 0, 4 / 42], [-2, 1, 2 / 42], [-1, 1, 4 / 42], [0, 1, 8 / 42], [1, 1, 4 / 42],
               [2, 1, 2 / 42], [-2, 2, 1 / 42], [-1, 2, 2 / 42], [0, 2, 4 / 42], [1, 2, 2 / 42], [2, 2, 1 / 42]],
  burkes:     [[1, 0, 8 / 32], [2, 0, 4 / 32], [-2, 1, 2 / 32], [-1, 1, 4 / 32], [0, 1, 8 / 32], [1, 1, 4 / 32], [2, 1, 2 / 32]],
  sierra:     [[1, 0, 5 / 32], [2, 0, 3 / 32], [-2, 1, 2 / 32], [-1, 1, 4 / 32], [0, 1, 5 / 32], [1, 1, 4 / 32],
               [2, 1, 2 / 32], [-1, 2, 2 / 32], [0, 2, 3 / 32], [1, 2, 2 / 32]],
  sierralite: [[1, 0, 2 / 4], [-1, 1, 1 / 4], [0, 1, 1 / 4]],
};
const ORDERED = new Set(["bayer2", "bayer4", "bayer8", "bayer16", "cluster", "ign", "noise"]);
const isDiffusion = a => a in KERNELS;
const isOrdered = a => ORDERED.has(a);

const TAU = Math.PI * 2, DEG = Math.PI / 180;

/* ------------------------------------------------------------ small maths */

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const frac = v => v - Math.floor(v);
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Deterministic 0..1 from two integers — every "random" effect goes through
// this, keyed on frame number, so a render export matches the preview.
function hash(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function hexToRgb(hex) {
  let h = String(hex || "#000").replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const n = parseInt(h, 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function gradAt(stops, t) {
  if (stops.length === 2) {
    const [a, b] = stops;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  const [a, b, c] = stops;
  if (t < 0.5) { const k = t * 2; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  const k = (t - 0.5) * 2;
  return [b[0] + (c[0] - b[0]) * k, b[1] + (c[1] - b[1]) * k, b[2] + (c[2] - b[2]) * k];
}

// Red-mean weighted distance — cheap and far closer to perceived colour
// difference than plain RGB distance.
function nearestIdx(P, r, g, b) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < P.length; k++) {
    const p = P[k], rm = (r + p[0]) * 0.5;
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = (2 + rm) * dr * dr + 4 * dg * dg + (3 - rm) * db * db;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

function hueMatrix(deg) {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
}

/* --------------------------------------------------------------- dither */

function bayerMatrix(n) {
  let m = [[0]];
  while (m.length < n) {
    const s = m.length, next = [];
    for (let y = 0; y < s * 2; y++) next.push(new Array(s * 2));
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const v = 4 * m[y][x];
      next[y][x] = v; next[y][x + s] = v + 2; next[y + s][x] = v + 3; next[y + s][x + s] = v + 1;
    }
    m = next;
  }
  const flat = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) flat[y * n + x] = (m[y][x] + 0.5) / (n * n);
  return flat;
}
const B2 = bayerMatrix(2), B4 = bayerMatrix(4), B8 = bayerMatrix(8), B16 = bayerMatrix(16);
// Clustered-dot: thresholds grow outward from the centre, so tone becomes
// dot size — the newspaper look rather than Bayer's crosshatch.
const CL4 = new Float32Array([12, 5, 6, 13, 4, 0, 1, 7, 11, 3, 2, 8, 15, 10, 9, 14].map(v => (v + 0.5) / 16));

function thresholdAt(algo, x, y, frame) {
  switch (algo) {
    case "bayer2": return B2[(y & 1) * 2 + (x & 1)];
    case "bayer4": return B4[(y & 3) * 4 + (x & 3)];
    case "bayer8": return B8[(y & 7) * 8 + (x & 7)];
    case "bayer16": return B16[(y & 15) * 16 + (x & 15)];
    case "cluster": return CL4[(y & 3) * 4 + (x & 3)];
    // Interleaved gradient noise (Jimenez): blue-ish, and stable over time.
    case "ign": return frac(52.9829189 * frac(0.06711056 * x + 0.00583715 * y));
    case "noise": return hash(x + y * 65536, frame * 7 + 1);
    default: return 0.5;
  }
}

// Quantize a 0..1 field to n evenly spaced levels. Writes 0..1 into `out`.
function ditherScalar(src, w, h, n, opt, frame, out, work) {
  const q = Math.max(1, (n | 0) - 1);
  const bias = opt.bias || 0;
  const algo = opt.dither || "none";
  const kernel = KERNELS[algo];
  const N = w * h;
  if (kernel) {
    const strength = opt.ditherStrength == null ? 1 : opt.ditherStrength;
    for (let i = 0; i < N; i++) work[i] = src[i] + bias;
    for (let y = 0; y < h; y++) {
      const rev = opt.serpentine && (y & 1);
      for (let k = 0; k < w; k++) {
        const x = rev ? w - 1 - k : k;
        const i = y * w + x;
        const old = work[i];
        const nv = Math.round(clamp01(old) * q) / q;
        out[i] = nv;
        const err = (old - nv) * strength;
        if (err === 0) continue;
        for (let j = 0; j < kernel.length; j++) {
          const kk = kernel[j];
          const nx = x + (rev ? -kk[0] : kk[0]), ny = y + kk[1];
          if (nx >= 0 && nx < w && ny < h) work[ny * w + nx] += err * kk[2];
        }
      }
    }
    return out;
  }
  const spread = algo === "none" ? 0 : (opt.ditherSpread == null ? 1 : opt.ditherSpread);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const t = algo === "none" ? 0.5 : thresholdAt(algo, x, y, frame);
    let lv = Math.floor(clamp01(src[i] + bias) * q + 0.5 + (t - 0.5) * spread);
    if (lv < 0) lv = 0; else if (lv > q) lv = q;
    out[i] = lv / q;
  }
  return out;
}

// Map colours to the nearest palette entry, optionally dithered. Writes
// palette indices into `outIdx`; wr/wg/wb are scratch buffers.
function ditherPalette(R, G, B, w, h, P, opt, frame, outIdx, wr, wg, wb) {
  const algo = opt.dither || "none";
  const kernel = KERNELS[algo];
  const N = w * h;
  if (kernel) {
    const strength = opt.ditherStrength == null ? 1 : opt.ditherStrength;
    const bias = opt.bias || 0;
    for (let i = 0; i < N; i++) { wr[i] = R[i] + bias; wg[i] = G[i] + bias; wb[i] = B[i] + bias; }
    for (let y = 0; y < h; y++) {
      const rev = opt.serpentine && (y & 1);
      for (let k = 0; k < w; k++) {
        const x = rev ? w - 1 - k : k;
        const i = y * w + x;
        const r = wr[i], g = wg[i], b = wb[i];
        const idx = nearestIdx(P, clamp01(r), clamp01(g), clamp01(b));
        outIdx[i] = idx;
        const p = P[idx];
        const er = (r - p[0]) * strength, eg = (g - p[1]) * strength, eb = (b - p[2]) * strength;
        for (let j = 0; j < kernel.length; j++) {
          const kk = kernel[j];
          const nx = x + (rev ? -kk[0] : kk[0]), ny = y + kk[1];
          if (nx >= 0 && nx < w && ny < h) {
            const ni = ny * w + nx, wt = kk[2];
            wr[ni] += er * wt; wg[ni] += eg * wt; wb[ni] += eb * wt;
          }
        }
      }
    }
    return outIdx;
  }
  // Ordered: nudge every channel by the threshold before the nearest search.
  // Fewer palette entries need a wider nudge to reach the next colour.
  const spread = algo === "none" ? 0 : (opt.ditherSpread == null ? 1 : opt.ditherSpread);
  const amp = spread / Math.cbrt(Math.max(2, P.length));
  const bias = opt.bias || 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const off = algo === "none" ? 0 : (thresholdAt(algo, x, y, frame) - 0.5) * amp;
    outIdx[i] = nearestIdx(P, clamp01(R[i] + off + bias), clamp01(G[i] + off + bias), clamp01(B[i] + off + bias));
  }
  return outIdx;
}

/* --------------------------------------------------------------- shapes */

const UNIT = (() => {
  const u = {
    square: [-1, -1, 1, -1, 1, 1, -1, 1],
    diamond: [0, -1, 1, 0, 0, 1, -1, 0],
    triangle: [0, -1, 0.866, 0.5, -0.866, 0.5],
  };
  const hex = [];
  for (let k = 0; k < 6; k++) { const a = (k * 60 - 90) * DEG; hex.push(Math.cos(a), Math.sin(a)); }
  u.hexagon = hex;
  const star = [];
  for (let k = 0; k < 10; k++) { const a = (k * 36 - 90) * DEG, r = k & 1 ? 0.45 : 1; star.push(Math.cos(a) * r, Math.sin(a) * r); }
  u.star = star;
  const t = 0.34;
  u.plus = [-t, -1, t, -1, t, -t, 1, -t, 1, t, t, t, t, 1, -t, 1, -t, t, -1, t, -1, -t, -t, -t];
  const c = Math.cos(45 * DEG) * 0.94, s = Math.sin(45 * DEG) * 0.94;
  u.cross = [];
  for (let k = 0; k < u.plus.length; k += 2) {
    const x = u.plus[k], y = u.plus[k + 1];
    u.cross.push(x * c - y * s, x * s + y * c);
  }
  return u;
})();

// Shapes that should keep their proportions rather than stretch to the cell.
const UNIFORM = new Set(["triangle", "hexagon", "star", "plus", "cross"]);

function poly(p, pts, cx, cy, sx, sy, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let k = 0; k < pts.length; k += 2) {
    const x = pts[k] * sx, y = pts[k + 1] * sy;
    const X = cx + x * c - y * s, Y = cy + x * s + y * c;
    if (k) p.lineTo(X, Y); else p.moveTo(X, Y);
  }
  p.closePath();
}

// Adds one shape to a path. `p` is either a CanvasRenderingContext2D or an
// SvgPath — both expose the same drawing verbs — so canvas and SVG export
// share exactly one piece of geometry code.
function addShape(p, shape, cx, cy, hw, hh, s, rot, roundness) {
  switch (shape) {
    case "square":
      if (rot) return poly(p, UNIT.square, cx, cy, hw * s, hh * s, rot);
      return p.rect(cx - hw * s, cy - hh * s, 2 * hw * s, 2 * hh * s);
    case "rounded": {
      const w = 2 * hw * s, h = 2 * hh * s;
      return p.roundRect ? p.roundRect(cx - w / 2, cy - h / 2, w, h, Math.min(w, h) * roundness)
                         : p.rect(cx - w / 2, cy - h / 2, w, h);
    }
    case "circle": {
      const r = Math.min(hw, hh) * s;
      p.moveTo(cx + r, cy); return p.arc(cx, cy, r, 0, TAU);
    }
    case "ring": {
      const r = Math.min(hw, hh) * s, ri = r * 0.55;
      p.moveTo(cx + r, cy); p.arc(cx, cy, r, 0, TAU);
      p.moveTo(cx + ri, cy); return p.arc(cx, cy, ri, 0, TAU, true);
    }
    case "hline":
      if (rot) return poly(p, UNIT.square, cx, cy, hw, hh * s, rot);
      return p.rect(cx - hw, cy - hh * s, 2 * hw, 2 * hh * s);
    case "vline":
      if (rot) return poly(p, UNIT.square, cx, cy, hw * s, hh, rot);
      return p.rect(cx - hw * s, cy - hh, 2 * hw * s, 2 * hh);
    default: {
      const u = UNIT[shape];
      if (!u) return;
      if (UNIFORM.has(shape)) { const r = Math.min(hw, hh) * s; return poly(p, u, cx, cy, r, r, rot); }
      return poly(p, u, cx, cy, hw * s, hh * s, rot);
    }
  }
}

const f2 = v => (Math.round(v * 100) / 100).toString();

class SvgPath {
  constructor() { this.d = []; }
  moveTo(x, y) { this.d.push("M" + f2(x) + " " + f2(y)); }
  lineTo(x, y) { this.d.push("L" + f2(x) + " " + f2(y)); }
  closePath() { this.d.push("Z"); }
  rect(x, y, w, h) { this.d.push("M" + f2(x) + " " + f2(y) + "h" + f2(w) + "v" + f2(h) + "h" + f2(-w) + "Z"); }
  // The renderer only ever draws full circles.
  arc(cx, cy, r, a0, a1, ccw) {
    const sw = ccw ? 0 : 1;
    this.d.push("M" + f2(cx + r) + " " + f2(cy) + "a" + f2(r) + " " + f2(r) + " 0 1 " + sw + " " + f2(-2 * r) +
      " 0a" + f2(r) + " " + f2(r) + " 0 1 " + sw + " " + f2(2 * r) + " 0Z");
  }
  roundRect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    this.d.push("M" + f2(x + r) + " " + f2(y) + "h" + f2(w - 2 * r) + "a" + f2(r) + " " + f2(r) + " 0 0 1 " + f2(r) + " " + f2(r) +
      "v" + f2(h - 2 * r) + "a" + f2(r) + " " + f2(r) + " 0 0 1 " + f2(-r) + " " + f2(r) +
      "h" + f2(-(w - 2 * r)) + "a" + f2(r) + " " + f2(r) + " 0 0 1 " + f2(-r) + " " + f2(-r) +
      "v" + f2(-(h - 2 * r)) + "a" + f2(r) + " " + f2(r) + " 0 0 1 " + f2(r) + " " + f2(-r) + "Z");
  }
  toString() { return this.d.join(""); }
}

const BRAILLE_BIT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];

/* ------------------------------------------------------------ helpers */

function aspectValue(aspect, sw, sh) {
  if (aspect === "source" || !aspect) return sw / sh;
  const [a, b] = aspect.split(":").map(Number);
  return a / b;
}

function placeSource(sw, sh, ow, oh, S) {
  const sr = sw / sh, or = ow / oh;
  let w, h;
  if ((sr > or) === (S.fit === "cover")) { h = oh; w = oh * sr; } else { w = ow; h = ow / sr; }
  w *= S.zoom; h *= S.zoom;
  const tx = Math.max(0, (w - ow) / 2), ty = Math.max(0, (h - oh) / 2);
  return { x: (ow - w) / 2 - S.panX * tx, y: (oh - h) / 2 - S.panY * ty, w, h };
}

function charsetFor(S) {
  const raw = S.charset === "custom" ? (S.customChars || " #") : (CHARSETS[S.charset] || CHARSETS.standard);
  const arr = Array.from(raw);
  return arr.length >= 2 ? arr : [" ", arr[0] || "#"];
}

function currentDither(S) {
  return { pixel: S.ditherPixel, bitmap: S.ditherBitmap, ascii: S.ditherAscii, braille: S.ditherBraille }[S.mode] || "none";
}

function ditherOpts(S, algo) {
  return { dither: algo, ditherStrength: S.ditherStrength, ditherSpread: S.ditherSpread, serpentine: S.serpentine, bias: S.bias };
}

// Sample budgets per mode. Past these a frame takes long enough to stall the
// tab, so the cell is quietly widened until the grid fits. Bitmap is cheap
// per cell (one pass, no shapes) and gets enough for 1 px cells at 1080p.
const MAX_SAMPLES = { pixel: 400000, bitmap: 2200000, ascii: 160000, braille: 900000 };

/* ------------------------------------------------------------ renderer */

class Renderer {
  constructor() {
    this.cv = Object.create(null);
    this.metrics = Object.create(null);
    this.n = 0; this.nc = 0;
    this.atlas = null; this.atlasKey = "";
    this.colKey = "";
    this.gridKey = "";
    this.frameData = null;
    this.resetTemporal();
  }

  resetTemporal() {
    this.motionT = null; this.refL = null; this.curL = null;
    this.trailT = null; this.hasTrail = false;
  }

  invalidateAtlas() { this.atlasKey = ""; this.metrics = Object.create(null); }

  canvas(name, w, h) {
    let c = this.cv[name];
    if (!c) c = this.cv[name] = document.createElement("canvas");
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    return c;
  }

  alloc(n, cells) {
    if (this.n !== n) {
      this.n = n;
      const F = () => new Float32Array(n);
      this.R = F(); this.G = F(); this.B = F(); this.A = F(); this.L = F();
      this.W = F(); this.Q = F(); this.QR = F(); this.QG = F(); this.QB = F();
      this.E = F(); this.T = F(); this.EB = new Uint8Array(n); this.IDX = new Uint16Array(n);
    }
    if (this.nc !== cells) {
      this.nc = cells;
      this.CR = new Float32Array(cells); this.CG = new Float32Array(cells);
      this.CB = new Float32Array(cells); this.CA = new Float32Array(cells);
      this.CV = new Float32Array(cells); this.CI = new Int32Array(cells);
    }
  }

  rowBuf(n) {
    if (!this._row || this._row.length < n) this._row = new Float32Array(n);
    return this._row;
  }

  layout(S, srcW, srcH, scale) {
    const ratio = aspectValue(S.aspect, srcW, srcH);
    let outW = Math.round(S.outW * scale);
    let outH = Math.round(outW / ratio);
    // Even dimensions: H.264 with yuv420p refuses odd ones outright.
    outW = Math.max(2, outW - (outW % 2));
    outH = Math.max(2, outH - (outH % 2));
    let cw = Math.max(1, S.cell * scale);
    const per = S.mode === "braille" ? 8 : 1;
    const chOf = w => S.mode === "ascii" ? w * S.charAspect : S.mode === "braille" ? w * 2 : w * S.cellAspect;
    let cols = Math.ceil(outW / cw), rows = Math.ceil(outH / chOf(cw));
    const cap = MAX_SAMPLES[S.mode] || 400000;
    if (cols * rows * per > cap) {
      cw *= Math.sqrt((cols * rows * per) / cap);
      cols = Math.ceil(outW / cw); rows = Math.ceil(outH / chOf(cw));
    }
    const ch = chOf(cw);
    cols = Math.max(1, cols); rows = Math.max(1, rows);
    const offX = (outW - cols * cw) / 2, offY = (outH - rows * ch) / 2;
    const sw = S.mode === "braille" ? cols * 2 : cols, sh = S.mode === "braille" ? rows * 4 : rows;
    return { outW, outH, cw, ch, cols, rows, offX, offY, sw, sh };
  }

  sample(src, S, Lo, scale) {
    const { sw, sh, cols, rows, cw, ch, offX, offY, outW, outH } = Lo;
    const big = Math.max(sw, sh);
    const kk = big * 4 <= 2048 ? 4 : big * 2 <= 2048 ? 2 : 1;
    const iw = sw * kk, ih = sh * kk;
    const inter = this.canvas("inter", iw, ih);
    const ic = inter.getContext("2d");
    ic.setTransform(1, 0, 0, 1, 0, 0);
    ic.clearRect(0, 0, iw, ih);
    const px = iw / (cols * cw), py = ih / (rows * ch);
    const pl = placeSource(src.width, src.height, outW, outH, S);
    ic.save();
    ic.imageSmoothingEnabled = true; ic.imageSmoothingQuality = "high";
    // Clip to the output frame, so letterbox areas stay transparent even when
    // pre-blur would otherwise bleed colour into them.
    ic.beginPath();
    ic.rect(-offX * px, -offY * py, outW * px, outH * py);
    ic.clip();
    const fcx = (outW / 2 - offX) * px, fcy = (outH / 2 - offY) * py;
    ic.translate(fcx, fcy); ic.scale(S.flipH ? -1 : 1, S.flipV ? -1 : 1); ic.translate(-fcx, -fcy);
    ic.filter = S.blur > 0 ? "blur(" + (S.blur * scale * px).toFixed(2) + "px)" : "none";
    ic.drawImage(src.el, (pl.x - offX) * px, (pl.y - offY) * py, pl.w * px, pl.h * py);
    ic.restore();

    // Exact halvings are a true 2×2 box filter, which is what stops fine
    // detail from sparkling from frame to frame.
    let cur = inter, w = iw, h = ih, step = 0;
    while (w > sw * 2) {
      const nw = w / 2, nh = h / 2;
      const d = this.canvas("half" + step++, nw, nh);
      const dc = d.getContext("2d");
      dc.clearRect(0, 0, nw, nh);
      dc.imageSmoothingEnabled = true; dc.imageSmoothingQuality = "high";
      dc.drawImage(cur, 0, 0, w, h, 0, 0, nw, nh);
      cur = d; w = nw; h = nh;
    }
    const smp = this.canvas("sample", sw, sh);
    const sc = smp.getContext("2d", { willReadFrequently: true });
    sc.clearRect(0, 0, sw, sh);
    sc.imageSmoothingEnabled = true; sc.imageSmoothingQuality = "high";
    sc.drawImage(cur, 0, 0, w, h, 0, 0, sw, sh);
    const d = sc.getImageData(0, 0, sw, sh).data;
    const R = this.R, G = this.G, B = this.B, A = this.A;
    for (let i = 0, j = 0; i < sw * sh; i++, j += 4) {
      const a = d[j + 3] / 255;
      A[i] = a;
      // un-premultiply edge pixels so a half-covered cell keeps its colour
      const k = a > 0 ? 1 / (255 * a) : 0;
      R[i] = Math.min(1, d[j] * k); G[i] = Math.min(1, d[j + 1] * k); B[i] = Math.min(1, d[j + 2] * k);
    }
  }

  shiftRow(y, w, s, onlyR) {
    if (!s) return;
    const base = y * w, arrs = onlyR ? [this.R] : [this.R, this.G, this.B, this.A];
    const tmp = this.rowBuf(w * arrs.length);
    for (let c = 0; c < arrs.length; c++) tmp.set(arrs[c].subarray(base, base + w), c * w);
    for (let x = 0; x < w; x++) {
      const sx = x - s, x0 = Math.floor(sx), f = sx - x0, x1 = x0 + 1;
      const in0 = x0 >= 0 && x0 < w, in1 = x1 >= 0 && x1 < w;
      for (let c = 0; c < arrs.length; c++) {
        const off = c * w;
        const v0 = in0 ? tmp[off + x0] : 0, v1 = in1 ? tmp[off + x1] : 0;
        arrs[c][base + x] = v0 + (v1 - v0) * f;
      }
    }
  }

  glitch(w, h, S, frame) {
    const g = S.glitch;
    if (g <= 0) return;
    const win = Math.floor(frame / 3);           // bursts hold for a few frames
    if (hash(win, 91) > g) return;               // quiet stretches in between
    const slices = 1 + Math.floor(g * 6 * hash(win, 17));
    for (let k = 0; k < slices; k++) {
      const y0 = Math.floor(hash(frame, k * 3 + 1) * h);
      const hh = 1 + Math.floor(hash(frame, k * 3 + 2) * Math.max(1, h * 0.12 * g));
      const s = Math.round((hash(frame, k * 3 + 3) - 0.5) * w * 0.5 * g);
      for (let y = y0; y < Math.min(h, y0 + hh); y++) {
        this.shiftRow(y, w, s);
        if (hash(y, frame + 7) < g * 0.6) this.shiftRow(y, w, Math.round(w * 0.02 * g) + 1, true);
      }
    }
  }

  wave(w, h, S, T) {
    if (S.wave <= 0) return;
    const amp = S.wave * w * 0.12;
    for (let y = 0; y < h; y++) {
      const s = amp * Math.sin(TAU * (y / h * S.waveFreq + T * S.waveSpeed));
      if (Math.abs(s) > 0.001) this.shiftRow(y, w, s);
    }
  }

  adjust(n, S) {
    const R = this.R, G = this.G, B = this.B, L = this.L;
    const bp = S.blackPoint, wp = Math.max(bp + 0.001, S.whitePoint), inv = 1 / (wp - bp);
    const br = S.brightness;
    const cf = S.contrast >= 0 ? 1 + S.contrast * 3 : 1 + S.contrast;
    const gm = 1 / Math.max(0.01, S.gamma), doG = S.gamma !== 1;
    const sat = S.saturation, hueOn = S.hue !== 0, m = hueOn ? hueMatrix(S.hue) : null;
    const invert = S.invert;
    for (let i = 0; i < n; i++) {
      let r = (R[i] - bp) * inv + br, g = (G[i] - bp) * inv + br, b = (B[i] - bp) * inv + br;
      r = clamp01((r - 0.5) * cf + 0.5); g = clamp01((g - 0.5) * cf + 0.5); b = clamp01((b - 0.5) * cf + 0.5);
      if (doG) { r = Math.pow(r, gm); g = Math.pow(g, gm); b = Math.pow(b, gm); }
      if (sat !== 1) { const l = luma(r, g, b); r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
      if (hueOn) {
        const r2 = m[0] * r + m[1] * g + m[2] * b, g2 = m[3] * r + m[4] * g + m[5] * b, b2 = m[6] * r + m[7] * g + m[8] * b;
        r = r2; g = g2; b = b2;
      }
      r = clamp01(r); g = clamp01(g); b = clamp01(b);
      if (invert) { r = 1 - r; g = 1 - g; b = 1 - b; }
      R[i] = r; G[i] = g; B[i] = b; L[i] = luma(r, g, b);
    }
  }

  boxBlur(src, dst, w, h) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          s += src[yy * w + xx]; c++;
        }
      }
      dst[y * w + x] = s / c;
    }
  }

  sharpen(w, h, amt) {
    if (amt <= 0) return;
    const T = this.T, n = w * h;
    for (const ch of [this.R, this.G, this.B]) {
      this.boxBlur(ch, T, w, h);
      for (let i = 0; i < n; i++) ch[i] = clamp01(ch[i] + amt * (ch[i] - T[i]));
    }
    const R = this.R, G = this.G, B = this.B, L = this.L;
    for (let i = 0; i < n; i++) L[i] = luma(R[i], G[i], B[i]);
  }

  edges(w, h) {
    const L = this.L, E = this.E, EB = this.EB;
    const at = (x, y) => L[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const gx = -tl - 2 * l - bl + tr + 2 * r + br;
      const gy = -tl - 2 * t - tr + bl + 2 * b + br;
      const i = y * w + x;
      E[i] = clamp01(Math.sqrt(gx * gx + gy * gy) / 4);
      // Edges run perpendicular to the gradient; fold to 0..π and bin in 45°.
      let a = Math.atan2(gy, gx);
      if (a < 0) a += Math.PI;
      EB[i] = Math.round(a / (Math.PI / 4)) & 3;
    }
  }

  motion(n, S, T) {
    if (!S.motionOnly) { this.curL = null; return; }
    const L = this.L;
    if (!this.curL || this.curL.length !== n) {
      this.curL = new Float32Array(n); this.refL = new Float32Array(n);
      this.curL.set(L.subarray(0, n)); this.refL.set(L.subarray(0, n)); this.motionT = T;
    }
    // Only advance the reference on a genuinely new frame, so nudging a
    // slider while paused doesn't compare a frame against itself.
    if (T !== this.motionT) { this.refL.set(this.curL); this.motionT = T; }
    this.curL.set(L.subarray(0, n));
    const ref = this.refL, g = S.motionGain;
    for (let i = 0; i < n; i++) L[i] = clamp01(Math.abs(L[i] - ref[i]) * g);
  }

  rain(w, h, S, T) {
    if (S.rain <= 0) return;
    const L = this.L, A = this.A;
    for (let x = 0; x < w; x++) {
      for (let d = 0; d < 2; d++) {
        const s1 = hash(x, 11 + d * 7), s2 = hash(x, 23 + d * 13);
        if (d === 1 && s1 > 0.55) continue;
        const len = Math.max(2, S.rainLength * (0.5 + s2));
        const speed = S.rainSpeed * (4 + 10 * s1);
        const period = h + len;
        const head = (((T * speed + s2 * period * 3) % period) + period) % period;
        const y0 = Math.max(0, Math.floor(head - len)), y1 = Math.min(h - 1, Math.floor(head));
        for (let y = y0; y <= y1; y++) {
          const i = y * w + x;
          const v = (1 - (head - y) / len) * S.rain;
          if (v > L[i]) L[i] = v;
          if (head - y < 1) L[i] = Math.max(L[i], Math.min(1, S.rain * 1.25));
          if (A[i] < 0.5) A[i] = 1;
        }
      }
    }
  }

  colours(S) {
    const key = [S.fg, S.bg, S.g1, S.g2, S.g3, S.gradStops, S.palette].join("|");
    if (key !== this.colKey) {
      this.colKey = key;
      this.fgC = hexToRgb(S.fg); this.bgC = hexToRgb(S.bg);
      this.grad = String(S.gradStops) === "2" ? [hexToRgb(S.g1), hexToRgb(S.g3)] : [hexToRgb(S.g1), hexToRgb(S.g2), hexToRgb(S.g3)];
      this.pal = (PALETTES[S.palette] || PALETTES.gameboy).map(hexToRgb);
      let di = 0, dl = 9;
      this.pal.forEach((c, i) => { const l = luma(c[0], c[1], c[2]); if (l < dl) { dl = l; di = i; } });
      this.palDark = this.pal[di];
    }
    return (S.colorMode === "palette" && S.paletteBg) ? this.palDark : this.bgC;
  }

  /* ---- mode: pixel / bitmap ---- */

  cellColoursPixel(n, w, h, S, frame) {
    const quant = S.mode === "bitmap" || S.quantize;
    const algo = S.mode === "bitmap" ? S.ditherBitmap : S.ditherPixel;
    const levels = Math.max(2, (S.mode === "bitmap" ? S.levelsBitmap : S.levelsPixel) | 0);
    const opt = ditherOpts(S, algo);
    const L = this.L, R = this.R, G = this.G, B = this.B, A = this.A;
    const CR = this.CR, CG = this.CG, CB = this.CB, CA = this.CA, CV = this.CV;
    const mode = S.colorMode;
    const fg = this.fgC, bg = this.bgC;
    const solidInk = S.mode === "pixel" && S.sizeMode !== "fixed" && mode === "mono";
    if (mode === "mono" || mode === "gradient") {
      const src = quant ? ditherScalar(L, w, h, levels, opt, frame, this.Q, this.W) : L;
      for (let i = 0; i < n; i++) {
        const v = src[i];
        CV[i] = v;
        let c;
        if (mode === "gradient") c = gradAt(this.grad, v);
        else if (solidInk) c = fg;
        else c = [bg[0] + (fg[0] - bg[0]) * v, bg[1] + (fg[1] - bg[1]) * v, bg[2] + (fg[2] - bg[2]) * v];
        CR[i] = c[0]; CG[i] = c[1]; CB[i] = c[2];
      }
    } else if (mode === "source") {
      if (quant) {
        ditherScalar(R, w, h, levels, opt, frame, this.QR, this.W);
        ditherScalar(G, w, h, levels, opt, frame, this.QG, this.W);
        ditherScalar(B, w, h, levels, opt, frame, this.QB, this.W);
      }
      const r = quant ? this.QR : R, g = quant ? this.QG : G, b = quant ? this.QB : B;
      for (let i = 0; i < n; i++) { CR[i] = r[i]; CG[i] = g[i]; CB[i] = b[i]; CV[i] = L[i]; }
    } else {
      const P = this.pal, IDX = this.IDX;
      if (quant) ditherPalette(R, G, B, w, h, P, opt, frame, IDX, this.QR, this.QG, this.QB);
      else for (let i = 0; i < n; i++) IDX[i] = nearestIdx(P, R[i], G[i], B[i]);
      for (let i = 0; i < n; i++) { const c = P[IDX[i]]; CR[i] = c[0]; CG[i] = c[1]; CB[i] = c[2]; CV[i] = L[i]; }
    }
    for (let i = 0; i < n; i++) CA[i] = A[i] >= 0.5 ? 1 : 0;
  }

  paintColourGrid(cols, rows) {
    const c = this.canvas("colors", cols, rows);
    const cx = c.getContext("2d");
    const img = cx.createImageData(cols, rows), d = img.data;
    const CR = this.CR, CG = this.CG, CB = this.CB, CA = this.CA;
    for (let i = 0, j = 0; i < cols * rows; i++, j += 4) {
      d[j] = CR[i] * 255; d[j + 1] = CG[i] * 255; d[j + 2] = CB[i] * 255; d[j + 3] = CA[i] ? 255 : 0;
    }
    cx.putImageData(img, 0, 0);
    this.lastColours = d;
    return c;
  }

  // Colours the white mask already on `ctx`, cell by cell.
  compositeColours(ctx, colours, Lo, stagger) {
    const { cols, rows, cw, ch, offX, offY } = Lo;
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    ctx.imageSmoothingEnabled = false;
    if (!stagger) ctx.drawImage(colours, 0, 0, cols, rows, offX, offY, cols * cw, rows * ch);
    else for (let y = 0; y < rows; y++) {
      ctx.drawImage(colours, 0, y, cols, 1, offX + (y & 1 ? cw / 2 : 0), offY + y * ch, cols * cw, ch);
    }
    ctx.restore();
  }

  renderPixel(ctx, S, Lo, frame, scale, capture) {
    const { cols, rows, cw, ch, offX, offY } = Lo;
    const n = cols * rows;
    this.cellColoursPixel(n, cols, rows, S, frame);
    const colours = this.paintColourGrid(cols, rows);
    const bitmap = S.mode === "bitmap";
    const shape = bitmap ? "square" : S.shape;
    const sizeMode = bitmap ? "fixed" : S.sizeMode;
    const rot0 = bitmap ? 0 : S.rotation * DEG, rotL = bitmap ? 0 : S.rotLuma * DEG;
    const stagger = !bitmap && S.stagger;
    const outline = !bitmap && S.shapeStyle === "outline";
    const k = 1 - S.gap;

    const fast = shape === "square" && S.gap === 0 && sizeMode === "fixed" && !rot0 && !rotL && !stagger && !outline;
    if (capture) {
      this.frameData.pixel = { shape, stagger, k, roundness: S.roundness, outline, lineWidth: S.lineWidth,
        sizes: new Float32Array(n), rots: new Float32Array(n), fast };
    }
    if (fast) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(colours, 0, 0, cols, rows, offX, offY, cols * cw, rows * ch);
      ctx.restore();
      if (capture) this.frameData.pixel.sizes.fill(1);
      return;
    }
    const V = this.CV, CA = this.CA, minS = S.sizeMin;
    ctx.save();
    ctx.beginPath();
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!CA[i]) continue;
      let s = 1;
      if (sizeMode === "luma") s = minS + (1 - minS) * V[i];
      else if (sizeMode === "inverse") s = minS + (1 - minS) * (1 - V[i]);
      if (s <= 0.01) continue;
      const rot = rot0 + rotL * V[i];
      if (capture) { this.frameData.pixel.sizes[i] = s; this.frameData.pixel.rots[i] = rot; }
      const cx = offX + (x + 0.5 + (stagger && (y & 1) ? 0.5 : 0)) * cw, cy = offY + (y + 0.5) * ch;
      addShape(ctx, shape, cx, cy, cw * k / 2, ch * k / 2, s, rot, S.roundness);
    }
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#fff";
    if (outline) { ctx.lineWidth = Math.max(0.5, S.lineWidth * scale); ctx.lineJoin = "round"; ctx.stroke(); }
    else ctx.fill(shape === "ring" ? "evenodd" : "nonzero");
    ctx.restore();
    this.compositeColours(ctx, colours, Lo, stagger);
  }

  /* ---- mode: ascii ---- */

  fontMetrics(family, weight) {
    const key = family + "|" + weight;
    if (this.metrics[key]) return this.metrics[key];
    const x = this.canvas("measure", 8, 8).getContext("2d");
    x.font = weight + " 100px \"" + family + "\", monospace";
    const mm = x.measureText("M");
    const hg = x.measureText("Hg");
    const asc = mm.fontBoundingBoxAscent || hg.actualBoundingBoxAscent || 80;
    const desc = mm.fontBoundingBoxDescent || hg.actualBoundingBoxDescent || 20;
    return (this.metrics[key] = { adv: (mm.width || 60) / 100, asc: asc / 100, desc: desc / 100 });
  }

  glyphAtlas(S, cw, ch, chars) {
    const m = this.fontMetrics(S.font, S.weight);
    const fontPx = Math.max(3, (cw / m.adv) * S.charScale);
    const gw = Math.max(1, Math.ceil(cw)), gh = Math.max(1, Math.ceil(ch));
    const key = [S.font, S.weight, fontPx.toFixed(2), gw, gh, chars.join("")].join("|");
    if (key === this.atlasKey) return this.atlas;
    const c = this.canvas("atlas", gw * chars.length, gh);
    const a = c.getContext("2d");
    a.clearRect(0, 0, c.width, c.height);
    a.fillStyle = "#fff";
    a.font = S.weight + " " + fontPx + "px \"" + S.font + "\", monospace";
    a.textAlign = "center"; a.textBaseline = "alphabetic";
    const baseY = gh / 2 + (m.asc - m.desc) * fontPx / 2;
    const index = new Map();
    chars.forEach((chr, i) => { index.set(chr, i); if (chr.trim()) a.fillText(chr, i * gw + gw / 2, baseY); });
    this.atlas = { canvas: c, gw, gh, index, fontPx, baseY };
    this.atlasKey = key;
    return this.atlas;
  }

  renderAscii(ctx, S, Lo, frame, capture) {
    const { cols, rows, cw, ch, offX, offY } = Lo;
    const n = cols * rows;
    const ramp = charsetFor(S);
    const edgeSet = Array.from(EDGE_CHARS[S.edgeChars] || EDGE_CHARS.ascii);
    const all = Array.from(new Set(ramp.concat(edgeSet)));
    const atlas = this.glyphAtlas(S, cw, ch, all);
    const rampG = ramp.map(c => atlas.index.get(c));
    const edgeG = edgeSet.map(c => atlas.index.get(c));
    const spaceIdx = all.indexOf(" ");
    const L = this.L, A = this.A, nr = ramp.length;
    let src = L;
    if (S.invertRamp) { const T = this.T; for (let i = 0; i < n; i++) T[i] = 1 - L[i]; src = T; }
    const algo = S.ditherAscii;
    if (algo !== "none") src = ditherScalar(src, cols, rows, nr, ditherOpts(S, algo), frame, this.Q, this.W);
    const CI = this.CI, E = this.E, EB = this.EB;
    const flick = S.flicker;
    for (let i = 0; i < n; i++) {
      if (A[i] < 0.5 || L[i] < S.blank) { CI[i] = -1; continue; }
      let g;
      if (S.edges && E[i] > S.edgeThreshold) g = edgeG[EB[i]];
      else if (S.edges && S.edgeOnly) { CI[i] = -1; continue; }
      else {
        const idx = algo !== "none" ? Math.round(src[i] * (nr - 1)) : Math.min(nr - 1, Math.floor(src[i] * nr));
        g = rampG[idx];
        if (flick > 0 && hash(i, frame + 313) < flick * 0.2) g = rampG[1 + Math.floor(hash(i, frame + 97) * (nr - 1))];
      }
      CI[i] = g === spaceIdx ? -1 : g;
    }
    this.glyphColours(n, S, n => this.CI[n] >= 0 ? 1 : 0);
    const colours = this.paintColourGrid(cols, rows);

    const { canvas: at, gw, gh } = atlas;
    const ox = (cw - gw) / 2, oy = (ch - gh) / 2;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const g = CI[y * cols + x];
      if (g < 0) continue;
      ctx.drawImage(at, g * gw, 0, gw, gh, Math.round(offX + x * cw + ox), Math.round(offY + y * ch + oy), gw, gh);
    }
    this.compositeColours(ctx, colours, Lo, false);
    if (capture) {
      this.frameData.ascii = { glyphs: Array.from(CI, g => g < 0 ? "" : all[g]), fontPx: atlas.fontPx,
        baseY: atlas.baseY - gh / 2 + ch / 2, font: S.font, weight: S.weight };
    }
  }

  // Colour for glyph-based modes. Ascii tone optionally dims faint glyphs.
  glyphColours(n, S, onFn) {
    const R = this.R, G = this.G, B = this.B, L = this.L;
    const CR = this.CR, CG = this.CG, CB = this.CB, CA = this.CA;
    const mode = S.colorMode, fg = this.fgC, P = this.pal;
    const tone = S.mode === "ascii" && S.asciiTone;
    for (let i = 0; i < n; i++) {
      CA[i] = onFn(i);
      let c;
      if (mode === "source") c = [R[i], G[i], B[i]];
      else if (mode === "gradient") c = gradAt(this.grad, L[i]);
      else if (mode === "palette") c = P[nearestIdx(P, R[i], G[i], B[i])];
      else c = fg;
      const m = tone ? 0.2 + 0.8 * L[i] : 1;
      CR[i] = c[0] * m; CG[i] = c[1] * m; CB[i] = c[2] * m;
    }
  }

  /* ---- mode: braille ---- */

  renderBraille(ctx, S, Lo, frame, capture) {
    const { cols, rows, cw, ch, offX, offY, sw, sh } = Lo;
    const L = this.L, A = this.A, R = this.R, G = this.G, B = this.B;
    let src = L;
    if (S.invertDots) { const T = this.T; for (let i = 0; i < sw * sh; i++) T[i] = 1 - L[i]; src = T; }
    const Q = ditherScalar(src, sw, sh, 2, ditherOpts(S, S.ditherBraille), frame, this.Q, this.W);
    const spread = 1 - S.cluster;
    const colX = [cw * (0.5 - 0.25 * spread), cw * (0.5 + 0.25 * spread)];
    const rowY = [0, 1, 2, 3].map(k => ch * (0.5 + (k - 1.5) * 0.25 * spread));
    const r = Math.min(cw / 2, ch / 4) * 0.5 * S.dotSize;
    const square = S.dotShape === "square";
    // Per-character colour is the average of its eight samples; stash it in
    // the sample-sized RGB arrays' char slots via a small helper array.
    const n = cols * rows;
    const cr = new Float32Array(n), cg = new Float32Array(n), cb = new Float32Array(n), cl = new Float32Array(n);
    const bits = new Uint8Array(n), on = new Uint8Array(n);
    ctx.save();
    ctx.beginPath();
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const ci = cy * cols + cx;
      let cnt = 0, sr = 0, sg = 0, sb = 0, sl = 0, b = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
        const si = (cy * 4 + dy) * sw + (cx * 2 + dx);
        if (A[si] < 0.5) continue;
        cnt++; sr += R[si]; sg += G[si]; sb += B[si]; sl += L[si];
        if (Q[si] >= 0.5) {
          b |= BRAILLE_BIT[dy][dx];
          const X = offX + cx * cw + colX[dx], Y = offY + cy * ch + rowY[dy];
          if (square) ctx.rect(X - r, Y - r, 2 * r, 2 * r);
          else { ctx.moveTo(X + r, Y); ctx.arc(X, Y, r, 0, TAU); }
        }
      }
      if (cnt) { cr[ci] = sr / cnt; cg[ci] = sg / cnt; cb[ci] = sb / cnt; cl[ci] = sl / cnt; }
      bits[ci] = b; on[ci] = b ? 1 : 0;
    }
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
    // Swap the char-level colours into the arrays glyphColours() reads.
    const saved = [this.R, this.G, this.B, this.L];
    this.R = cr; this.G = cg; this.B = cb; this.L = cl;
    this.glyphColours(n, S, i => on[i]);
    [this.R, this.G, this.B, this.L] = saved;
    const colours = this.paintColourGrid(cols, rows);
    this.compositeColours(ctx, colours, Lo, false);
    if (capture) this.frameData.braille = { bits, colX, rowY, r, square };
  }

  /* ---- temporal + post ---- */

  trails(ctx, S, T, w, h) {
    if (S.trails <= 0) { this.hasTrail = false; this.trailT = null; return; }
    const prev = this.canvas("fbPrev", w, h), last = this.canvas("fbLast", w, h);
    const pc = prev.getContext("2d"), lc = last.getContext("2d");
    if (T !== this.trailT) {
      pc.globalCompositeOperation = "copy"; pc.globalAlpha = 1;
      if (this.hasTrail) pc.drawImage(last, 0, 0); else pc.clearRect(0, 0, w, h);
      pc.globalCompositeOperation = "source-over";
      this.trailT = T;
    }
    if (this.hasTrail) {
      ctx.save();
      ctx.globalAlpha = S.trails;
      ctx.globalCompositeOperation = { blend: "source-over", lighten: "lighten", darken: "darken", add: "lighter" }[S.trailMode] || "source-over";
      ctx.drawImage(prev, 0, 0);
      ctx.restore();
    }
    lc.globalCompositeOperation = "copy"; lc.globalAlpha = 1;
    lc.drawImage(ctx.canvas, 0, 0);
    lc.globalCompositeOperation = "source-over";
    this.hasTrail = true;
  }

  noiseTile(k) {
    if (!this.tiles) {
      this.tiles = [];
      for (let t = 0; t < 4; t++) {
        const c = document.createElement("canvas");
        c.width = c.height = 256;
        const x = c.getContext("2d"), img = x.createImageData(256, 256), d = img.data;
        for (let i = 0; i < 256 * 256; i++) {
          const v = hash(i, t * 131 + 5) * 255;
          d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
        }
        x.putImageData(img, 0, 0);
        this.tiles.push(c);
      }
    }
    return this.tiles[k & 3];
  }

  post(ctx, S, w, h, scale, frame) {
    if (S.glow > 0) {
      const gw = Math.max(1, w >> 1), gh = Math.max(1, h >> 1);
      const gc = this.canvas("glow", gw, gh), g = gc.getContext("2d");
      g.clearRect(0, 0, gw, gh);
      g.filter = "blur(" + Math.max(0.5, S.glowRadius * scale * 0.5).toFixed(2) + "px)";
      g.drawImage(ctx.canvas, 0, 0, gw, gh);
      g.filter = "none";
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(1, S.glow);
      ctx.drawImage(gc, 0, 0, w, h);
      if (S.glow > 1) { ctx.globalAlpha = S.glow - 1; ctx.drawImage(gc, 0, 0, w, h); }
      ctx.restore();
    }
    if (S.chroma > 0) {
      const d = S.chroma * scale;
      const src = this.canvas("chromaSrc", w, h), sc = src.getContext("2d");
      sc.globalCompositeOperation = "copy"; sc.drawImage(ctx.canvas, 0, 0); sc.globalCompositeOperation = "source-over";
      const tint = this.canvas("tint", w, h), tc = tint.getContext("2d");
      ctx.save();
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const [col, dx] of [["#f00", -d], ["#0f0", 0], ["#00f", d]]) {
        tc.globalCompositeOperation = "copy"; tc.drawImage(src, 0, 0);
        tc.globalCompositeOperation = "multiply"; tc.fillStyle = col; tc.fillRect(0, 0, w, h);
        tc.globalCompositeOperation = "destination-in"; tc.drawImage(src, 0, 0);
        tc.globalCompositeOperation = "source-over";
        ctx.drawImage(tint, dx, 0);
      }
      ctx.restore();
    }
    if (S.crt > 0) {
      const m = Math.max(1, Math.round(scale * 1.5));
      const pc = this.canvas("crtPat", 3 * m, 1), p = pc.getContext("2d");
      ["#ff0000", "#00ff00", "#0000ff"].forEach((c, i) => { p.fillStyle = c; p.fillRect(i * m, 0, m, 1); });
      ctx.save();
      ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = S.crt;
      ctx.fillStyle = ctx.createPattern(pc, "repeat"); ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    if (S.scanlines > 0) {
      const sz = Math.max(1, Math.round(S.scanlineSize * scale));
      const sc = this.canvas("scanPat", 1, sz * 2), p = sc.getContext("2d");
      p.clearRect(0, 0, 1, sz * 2); p.fillStyle = "#000"; p.fillRect(0, sz, 1, sz);
      ctx.save();
      ctx.globalAlpha = S.scanlines;
      ctx.fillStyle = ctx.createPattern(sc, "repeat"); ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    if (S.vignette > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0," + S.vignette + ")");
      ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
    }
    if (S.grain > 0) {
      const pat = ctx.createPattern(this.noiseTile(frame), "repeat");
      if (pat.setTransform) pat.setTransform(new DOMMatrix().translate(Math.floor(hash(frame, 1) * 256), Math.floor(hash(frame, 2) * 256)));
      ctx.save();
      ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = S.grain;
      ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  /* ---- entry point ---- */

  // src: { el, width, height }. Returns the layout used, for stats.
  render(src, S, T, frame, scale, out, capture) {
    if (!src || !src.width || !src.height) return null;
    const Lo = this.layout(S, src.width, src.height, scale);
    const { outW, outH, cols, rows, sw, sh } = Lo;
    if (out.width !== outW) out.width = outW;
    if (out.height !== outH) out.height = outH;
    const key = [outW, outH, cols, rows, S.mode].join("x");
    if (key !== this.gridKey) { this.gridKey = key; this.resetTemporal(); }
    const n = sw * sh;
    this.alloc(n, cols * rows);
    const bg = this.colours(S);
    if (capture) this.frameData = { mode: S.mode, Lo, bg: S.transparentBg ? null : bg, colorMode: S.colorMode };

    this.sample(src, S, Lo, scale);
    this.glitch(sw, sh, S, frame);
    this.wave(sw, sh, S, T);
    this.adjust(n, S);
    this.sharpen(sw, sh, S.sharpen);
    if (S.edgeMix > 0 || (S.mode === "ascii" && S.edges)) {
      this.edges(sw, sh);
      if (S.edgeMix > 0) { const L = this.L, E = this.E, m = S.edgeMix; for (let i = 0; i < n; i++) L[i] = L[i] * (1 - m) + E[i] * m; }
    }
    this.motion(n, S, T);
    if (S.flicker > 0) { const L = this.L; for (let i = 0; i < n; i++) L[i] = clamp01(L[i] + (hash(i, frame) - 0.5) * S.flicker); }
    this.rain(sw, sh, S, T);

    const ctx = out.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";
    ctx.clearRect(0, 0, outW, outH);
    if (S.mode === "ascii") this.renderAscii(ctx, S, Lo, frame, capture);
    else if (S.mode === "braille") this.renderBraille(ctx, S, Lo, frame, capture);
    else this.renderPixel(ctx, S, Lo, frame, scale, capture);
    if (capture) this.frameData.colours = new Uint8ClampedArray(this.lastColours);
    if (!S.transparentBg) {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "rgb(" + (bg[0] * 255 | 0) + "," + (bg[1] * 255 | 0) + "," + (bg[2] * 255 | 0) + ")";
      ctx.fillRect(0, 0, outW, outH);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();
    this.trails(ctx, S, T, outW, outH);
    this.post(ctx, S, outW, outH, scale, frame);
    return Lo;
  }
}

/* ------------------------------------------------------------ exports */

const css = c => "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
const colAt = (d, i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
const escXml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function frameToSVG(fd) {
  const { Lo, colours } = fd;
  const { outW, outH, cols, rows, cw, ch, offX, offY } = Lo;
  const out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + outW + '" height="' + outH +
    '" viewBox="0 0 ' + outW + " " + outH + '">'];
  if (fd.bg) out.push('<rect width="100%" height="100%" fill="' + css(fd.bg.map(v => Math.round(v * 255))) + '"/>');
  const groups = new Map();
  const pathFor = key => { let p = groups.get(key); if (!p) groups.set(key, p = new SvgPath()); return p; };

  if (fd.mode === "ascii") {
    const a = fd.ascii;
    out.push('<g font-family="' + escXml(a.font) + ', monospace" font-weight="' + a.weight + '" font-size="' +
      f2(a.fontPx) + '" text-anchor="middle">');
    for (let y = 0; y < rows; y++) {
      let x = 0;
      while (x < cols) {
        const i = y * cols + x;
        if (!a.glyphs[i] || !colours[i * 4 + 3]) { x++; continue; }
        const c = css(colAt(colours, i));
        const xs = [], chars = [];
        while (x < cols) {
          const j = y * cols + x;
          if (!a.glyphs[j] || !colours[j * 4 + 3] || css(colAt(colours, j)) !== c) break;
          xs.push(f2(offX + (x + 0.5) * cw)); chars.push(escXml(a.glyphs[j])); x++;
        }
        out.push('<text fill="' + c + '" x="' + xs.join(" ") + '" y="' + f2(offY + y * ch + a.baseY) + '">' + chars.join("") + "</text>");
      }
    }
    out.push("</g>");
  } else if (fd.mode === "braille") {
    const b = fd.braille;
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const ci = cy * cols + cx, bits = b.bits[ci];
      if (!bits) continue;
      const p = pathFor(css(colAt(colours, ci)));
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
        if (!(bits & BRAILLE_BIT[dy][dx])) continue;
        const X = offX + cx * cw + b.colX[dx], Y = offY + cy * ch + b.rowY[dy];
        if (b.square) p.rect(X - b.r, Y - b.r, 2 * b.r, 2 * b.r); else p.arc(X, Y, b.r, 0, TAU);
      }
    }
  } else {
    const px = fd.pixel;
    if (px.fast) {
      // Merge each row's runs of equal colour into one rectangle.
      for (let y = 0; y < rows; y++) {
        let x = 0;
        while (x < cols) {
          const i = y * cols + x;
          if (!colours[i * 4 + 3]) { x++; continue; }
          const c = css(colAt(colours, i));
          let x1 = x + 1;
          while (x1 < cols && colours[(y * cols + x1) * 4 + 3] && css(colAt(colours, y * cols + x1)) === c) x1++;
          pathFor(c).rect(offX + x * cw, offY + y * ch, (x1 - x) * cw, ch);
          x = x1;
        }
      }
    } else {
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const i = y * cols + x, s = px.sizes[i];
        if (!s || !colours[i * 4 + 3]) continue;
        const cx = offX + (x + 0.5 + (px.stagger && (y & 1) ? 0.5 : 0)) * cw, cy = offY + (y + 0.5) * ch;
        addShape(pathFor(css(colAt(colours, i))), px.shape, cx, cy, cw * px.k / 2, ch * px.k / 2, s, px.rots[i], px.roundness);
      }
    }
  }
  const outline = fd.pixel && fd.pixel.outline && !fd.pixel.fast;
  const rule = fd.pixel && fd.pixel.shape === "ring" ? ' fill-rule="evenodd"' : "";
  for (const [c, p] of groups) {
    out.push(outline
      ? '<path fill="none" stroke="' + c + '" stroke-width="' + f2(fd.pixel.lineWidth) + '" stroke-linejoin="round" d="' + p + '"/>'
      : '<path fill="' + c + '"' + rule + ' d="' + p + '"/>');
  }
  out.push("</svg>");
  return out.join("\n");
}

function frameToText(fd) {
  const { cols, rows } = fd.Lo, lines = [];
  for (let y = 0; y < rows; y++) {
    let s = "";
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (fd.mode === "braille") s += String.fromCharCode(0x2800 + fd.braille.bits[i]);
      else s += fd.ascii.glyphs[i] || " ";
    }
    lines.push(s.replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

function frameToHTML(fd) {
  const { cols, rows, cw, ch } = fd.Lo, c = fd.colours;
  const a = fd.ascii;
  const bg = fd.bg ? css(fd.bg.map(v => Math.round(v * 255))) : "transparent";
  const rowsHtml = [];
  for (let y = 0; y < rows; y++) {
    let line = "", run = null, buf = "";
    const flush = () => { if (buf) line += run ? '<span style="color:' + run + '">' + buf + "</span>" : buf; buf = ""; };
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const g = fd.mode === "braille" ? String.fromCharCode(0x2800 + fd.braille.bits[i]) : (a.glyphs[i] || " ");
      const col = g.trim() && g !== "⠀" && c[i * 4 + 3] ? css(colAt(c, i)) : null;
      if (col !== run && col) { flush(); run = col; }
      buf += escXml(g);
    }
    flush();
    rowsHtml.push(line);
  }
  const font = fd.mode === "ascii" ? a.font : "monospace";
  const size = fd.mode === "ascii" ? a.fontPx : cw * 1.7;
  return '<!DOCTYPE html>\n<meta charset="utf-8">\n<title>Pixel, Bitmap &amp; ASCII</title>\n' +
    '<body style="margin:0;background:' + bg + '">\n<pre style="margin:0;padding:16px;font:' + (fd.mode === "ascii" ? a.weight : 400) +
    " " + f2(size) + "px/" + f2(ch) + "px '" + font + "',monospace;letter-spacing:" + f2(cw - (fd.mode === "ascii" ? a.fontPx * 0.6 : 0)) +
    'px">' + rowsHtml.join("\n") + "</pre>";
}

if (typeof module !== "undefined") {
  module.exports = { PALETTES, CHARSETS, KERNELS, ditherScalar, ditherPalette, nearestIdx, hexToRgb,
    gradAt, hash, thresholdAt, bayerMatrix, placeSource, aspectValue, SvgPath, addShape, UNIT, isDiffusion, isOrdered };
}
