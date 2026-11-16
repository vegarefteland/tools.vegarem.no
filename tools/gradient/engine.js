/* Gradient Generator, colour, palettes and the renderers.
 *
 * Everything interpolates in OKLab by default. Blending two colours in plain
 * sRGB drags the mix through a dead grey band, the classic muddy middle of a
 * blue-to-orange fade, because sRGB is not perceptually even. OKLab is, so the
 * ramp keeps its chroma and the midpoint lands where the eye expects it.
 *
 * Nothing here touches the DOM at load time, so the maths runs under Node too.
 */
"use strict";

/* ------------------------------------------------------------ colour space */

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

function hexToRgb(hex) {
  let h = String(hex || "#000").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = c => "#" + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

const toLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const toSrgb = c => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
  return clamp01(v) * 255;
};

function rgbToOklab(rgb) {
  const r = toLin(rgb[0]), g = toLin(rgb[1]), b = toLin(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function oklabToRgb(lab) {
  const l_ = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
  const m_ = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
  const s_ = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2];
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    toSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ];
}

/* ------------------------------------------------------- gamut mapping
 * A mix in OKLab/OKLCH can land outside sRGB. Clipping each channel on its own
 * (what oklabToRgb does) bends the hue, which shows as a sudden shift in the
 * middle of a vivid ramp. This is the CSS Color 4 gamut-mapping algorithm:
 * keep lightness and hue, binary-search chroma down until clipping what is left
 * changes the colour by less than a JND (deltaEOK 0.02).
 * https://www.w3.org/TR/css-color-4/#gamut-mapping */
const oklabToLin = lab => {
  const l_ = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
  const m_ = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
  const s_ = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2];
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
};
const linToOklab = c => {
  const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
  const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
  const s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
};
const GAMUT_EPS = 1e-5, JND = 0.02;
const inGamut = lin => lin[0] >= -GAMUT_EPS && lin[0] <= 1 + GAMUT_EPS && lin[1] >= -GAMUT_EPS &&
  lin[1] <= 1 + GAMUT_EPS && lin[2] >= -GAMUT_EPS && lin[2] <= 1 + GAMUT_EPS;
const linToSrgb = lin => [toSrgb(lin[0]), toSrgb(lin[1]), toSrgb(lin[2])];
const deltaEOK = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function oklabToRgbMapped(lab) {
  const L = lab[0];
  if (L >= 1) return [255, 255, 255];
  if (L <= 0) return [0, 0, 0];
  const lin = oklabToLin(lab);
  if (inGamut(lin)) return linToSrgb(lin);
  const C = Math.hypot(lab[1], lab[2]), h = Math.atan2(lab[2], lab[1]);
  const at = c => [L, c * Math.cos(h), c * Math.sin(h)];
  const clipOf = cur => { const l2 = oklabToLin(cur).map(clamp01); return { lin: l2, lab: linToOklab(l2) }; };
  let clipped = clipOf(lab);
  if (deltaEOK(clipped.lab, lab) < JND) return linToSrgb(clipped.lin);
  let lo = 0, hi = C, minInGamut = true;
  while (hi - lo > 1e-4) {
    const c = (lo + hi) / 2, cur = at(c);
    if (minInGamut && inGamut(oklabToLin(cur))) { lo = c; continue; }
    clipped = clipOf(cur);
    const E = deltaEOK(clipped.lab, cur);
    if (E < JND) {
      if (JND - E < 1e-4) break;
      minInGamut = false; lo = c;
    } else hi = c;
  }
  return linToSrgb(clipped.lin);
}

const oklabToLch = lab => [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])];
const lchToOklab = lch => [lch[0], lch[1] * Math.cos(lch[2]), lch[1] * Math.sin(lch[2])];
const rgbToLch = rgb => oklabToLch(rgbToOklab(rgb));
const lchToRgb = lch => oklabToRgbMapped(lchToOklab(lch));

function rgbToHsl(rgb) {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (mx + mn) / 2;
  return [h, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l];
}
function hslToRgb(hsl) {
  const [h, s, l] = hsl;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const t = h / 60;
  let r = 0, g = 0, b = 0;
  if (t < 1) [r, g, b] = [c, x, 0]; else if (t < 2) [r, g, b] = [x, c, 0];
  else if (t < 3) [r, g, b] = [0, c, x]; else if (t < 4) [r, g, b] = [0, x, c];
  else if (t < 5) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const SPACES = ["oklab", "oklch", "srgb", "linear", "hsl"];
const SPACE_LABELS = {
  oklab: "OKLab (even, keeps chroma)",
  oklch: "OKLCH (travels round the wheel)",
  srgb: "sRGB (the muddy classic)",
  linear: "Linear RGB (light-accurate)",
  hsl: "HSL (rainbow-ish)",
};

// Which way round the hue wheel a polar mix travels, the four CSS Color 4
// <hue-interpolation-method> routes.
const HUES = ["shorter", "longer", "increasing", "decreasing"];
const HUE_LABELS = { shorter: "Shorter way round", longer: "Longer way round",
  increasing: "Increasing hue", decreasing: "Decreasing hue" };
function hueDelta(d, method, full) {
  const half = full / 2;
  if (method === "longer") { if (d > 0 && d < half) d -= full; else if (d > -half && d <= 0) d += full; }
  else if (method === "increasing") { if (d < 0) d += full; }
  else if (method === "decreasing") { if (d > 0) d -= full; }
  else { if (d > half) d -= full; else if (d < -half) d += full; }
  return d;
}

// Mix two colours at t in the chosen space. A grey has no hue of its own, so
// in polar spaces it borrows the other colour's (CSS "powerless" hue);
// otherwise white-to-blue in OKLCH would swing through red on the way.
function mix(c1, c2, t, space, hue) {
  if (space === "srgb") return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  if (space === "linear") {
    return [0, 1, 2].map(i => toSrgb(lerp(toLin(c1[i]), toLin(c2[i]), t)));
  }
  if (space === "hsl") {
    const a = rgbToHsl(c1), b = rgbToHsl(c2);
    if (a[1] < 1e-4) a[0] = b[0]; if (b[1] < 1e-4) b[0] = a[0];
    const dh = hueDelta(b[0] - a[0], hue, 360);
    return hslToRgb([((a[0] + dh * t) % 360 + 360) % 360, lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
  }
  if (space === "oklch") {
    const a = rgbToLch(c1), b = rgbToLch(c2);
    if (a[1] < 1e-4) a[2] = b[2]; if (b[1] < 1e-4) b[2] = a[2];
    const dh = hueDelta(b[2] - a[2], hue, 2 * Math.PI);
    return lchToRgb([lerp(a[0], b[0], t), lerp(a[1], b[1], t), a[2] + dh * t]);
  }
  const a = rgbToOklab(c1), b = rgbToOklab(c2);
  return oklabToRgbMapped([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
}

/* ---------------------------------------------------------------- easing */

const EASINGS = {
  linear: t => t,
  smooth: t => t * t * (3 - 2 * t),
  smoother: t => t * t * t * (t * (t * 6 - 15) + 10),
  in: t => t * t,
  out: t => 1 - (1 - t) * (1 - t),
  expo: t => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  log: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  steep: t => t * t * t,
};
const EASING_LABELS = {
  linear: "Linear", smooth: "Smoothstep", smoother: "Smoother", in: "Ease in",
  out: "Ease out", expo: "Exponential", log: "Logarithmic", steep: "Steep",
};

/* --------------------------------------------------------------- the ramp */

// Monotone cubic (Fritsch-Carlson) through points (x, y). Smooth at every
// knot, so no slope jump for the eye to read as a band, and it never
// overshoots between two knots, so a channel cannot ring past its stops.
function monotone(xs, ys) {
  const n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return x => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = Math.max(1e-9, xs[i + 1] - xs[i]), u = (x - xs[i]) / h;
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] +
           (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

// stops: [{ pos: 0..1, hex }], returns a function t -> [r,g,b] (floats).
// opts.hue: hue route for polar spaces. opts.spline: one smooth curve through
// every stop in OKLab instead of straight segments joined at each stop.
function makeRamp(stops, space, easing, bias, opts) {
  opts = opts || {};
  const list = stops.slice().sort((a, b) => a.pos - b.pos)
    .map(s => ({ pos: clamp01(s.pos), rgb: hexToRgb(s.hex) }));
  if (!list.length) return () => [0, 0, 0];
  if (list.length === 1) return () => list[0].rgb;
  if (opts.spline && list.length > 2) {
    // de-duplicate positions so the curve stays a function of t
    const xs = [], labs = [];
    list.forEach(s => {
      if (xs.length && s.pos - xs[xs.length - 1] < 1e-6) { labs[labs.length - 1] = rgbToOklab(s.rgb); return; }
      xs.push(s.pos); labs.push(rgbToOklab(s.rgb));
    });
    if (xs.length > 2) {
      const ch = [0, 1, 2].map(k => monotone(xs, labs.map(l => l[k])));
      const lo = xs[0], hi = xs[xs.length - 1];
      return function (t) {
        t = clamp01(t);
        if (t <= lo) return list[0].rgb;
        if (t >= hi) return list[list.length - 1].rgb;
        return oklabToRgbMapped([ch[0](t), ch[1](t), ch[2](t)]);
      };
    }
  }
  const ease = EASINGS[easing] || EASINGS.linear;
  const b = bias == null ? 0.5 : bias;
  return function (t) {
    t = clamp01(t);
    if (t <= list[0].pos) return list[0].rgb;
    if (t >= list[list.length - 1].pos) return list[list.length - 1].rgb;
    let i = 0;
    while (i < list.length - 2 && t > list[i + 1].pos) i++;
    const a = list[i], c = list[i + 1];
    let u = (t - a.pos) / Math.max(1e-6, c.pos - a.pos);
    // bias pushes the midpoint toward one end without moving the stops
    if (b !== 0.5) u = b <= 0 ? 1 : Math.pow(u, Math.log(0.5) / Math.log(clamp01(b)));
    return mix(a.rgb, c.rgb, ease(u), space, opts.hue);
  };
}

// The ramp pre-sampled as floats, read with linear interpolation, so a
// per-pixel renderer costs one lookup instead of a colour conversion.
function rampLUT(ramp, n) {
  n = n || 2048;
  const lut = new Float32Array((n + 1) * 3);
  for (let i = 0; i <= n; i++) { const c = ramp(i / n); lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2]; }
  return { n, lut };
}

// Sample a ramp into canvas colour stops, this is how OKLab mixing survives
// being handed to a native CanvasGradient, which only knows sRGB.
function applyStops(grad, ramp, n) {
  n = n || 48;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    grad.addColorStop(t, rgbToHex(ramp(t)));
  }
  return grad;
}

/* ------------------------------------------------------------- randomness */

// Deterministic: the same seed always gives the same artwork, which is the
// whole point of having a seed field you can write down.
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rng(seed) {
  const r = mulberry32(hashSeed(seed));
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = (lo, hi) => Math.floor(r.range(lo, hi + 1));
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  r.chance = p => r() < p;
  return r;
}

/* ---------------------------------------------------------------- palettes */

// [name, family, colours]. Deliberately ordered dark→light or cool→warm so a
// palette dropped straight onto a ramp already reads as a gradient.
const PALETTES = [
  ["Seihitsu", "Serene", "#0a0912 #241a35 #c2405c #f4b3ad #e9e7e4"],
  ["Dawn Mist", "Serene", "#1b2430 #4a5a6a #9fb0bd #dfe6ea #f6f3ee"],
  ["Paper Lantern", "Serene", "#2a1a1f #7d3b43 #d98b7a #f3cfb3 #faf1e4"],
  ["Still Water", "Serene", "#0d1f26 #1f4b55 #6fa3a8 #c3dcdc #eef5f3"],
  ["Ink Wash", "Serene", "#101114 #2d3138 #5c636d #a7adb5 #e8e9ec"],
  ["Plum Dusk", "Serene", "#120d1c #38214d #6f4580 #b081ab #e7cfd8"],

  ["Horizon", "Sunset", "#06244a #2e6ea8 #9fc2dd #f7c6c7 #ffb27a #f2762a"],
  ["Last Light", "Sunset", "#0b0f2b #3a2a6b #a04a7a #e8794f #f6c177"],
  ["Ember", "Sunset", "#1a0a06 #5e1a0c #b8431c #e8853a #f7cf8c"],
  ["Peach Hour", "Sunset", "#2b1b3a #7a4a6b #d4807e #f6b48c #ffe2c2"],
  ["Desert Evening", "Sunset", "#241627 #6b3550 #c25f5a #e99b63 #f5d9a8"],
  ["Afterglow", "Sunset", "#07070f #291a3d #7b2f5e #d2515e #ff9a62 #ffd9a0"],

  ["Sea", "Water", "#052a30 #09606d #2e9aa3 #a9d7dc #d2ecf2"],
  ["Deep Current", "Water", "#04080f #0f2235 #2f5c7e #7ba6c4 #dfe8ee"],
  ["Lagoon", "Water", "#02231f #0a5c4e #28a088 #88d0bc #e2f3ec"],
  ["Glacier", "Water", "#0a1a2b #1c4a6e #5b93b8 #a8cde0 #f0f7fa"],
  ["Tide Pool", "Water", "#0b1d1a #17463f #3c7f6b #86b89b #d9e8d6"],
  ["Abyss", "Water", "#01030a #06152e #0f3356 #27618c #6fa3c7"],

  ["Riso Pink", "Print", "#1b0a18 #7a1246 #e0287d #ff8fb8 #ffe0ea"],
  ["Two Ink", "Print", "#101436 #1d3fbb #ff48b0 #f7f3ea"],
  ["Newsprint", "Print", "#17171a #4a4a52 #8d8c92 #c9c6c0 #efe9dc"],
  ["Cyan Plate", "Print", "#001b24 #00576e #00a4bf #7fdcea #e6f8fb"],
  ["Warm Proof", "Print", "#1d1408 #5c3a12 #a9742a #ddb46a #f6e6c4"],
  ["Overprint", "Print", "#120d2b #43237a #c2298a #f06a3f #f7d64a"],

  ["Neon Dusk", "Electric", "#06030f #1d0b3b #6a1bb0 #e034a0 #ff8a5c"],
  ["Signal", "Electric", "#000a12 #003f5c #2f9e8f #d6e04b #fff3b0"],
  ["Vapour", "Electric", "#1a1033 #5b2a8a #c04ec4 #ff7ad0 #9ef0ff"],
  ["Acid", "Electric", "#0b1400 #2b4a05 #74a812 #c6e84a #f2ffc4"],
  ["Ultraviolet", "Electric", "#05020e #270a52 #5a1ba8 #9d5bf0 #d9bbff"],
  ["Hot Wire", "Electric", "#140004 #5c0012 #c01028 #ff5a3c #ffc46b"],

  ["Moss", "Earth", "#11160f #2c3a24 #55703f #93ad6f #d6dcc0"],
  ["Clay", "Earth", "#1e120d #4e2a1e #8c5236 #c08a62 #e8d2b8"],
  ["Dune", "Earth", "#1c1710 #4b3f2a #8a7450 #c4ac82 #efe3c8"],
  ["Pine", "Earth", "#071008 #11291a #2b5235 #5e8a62 #b9cfae"],
  ["Rust", "Earth", "#180c08 #4c1c10 #8f3a1c #c9713c #e8b183"],
  ["Stone", "Earth", "#17181a #393c40 #6c7075 #a3a7ab #dcdedf"],

  ["Blush", "Soft", "#2e1a24 #7b4356 #c4818c #ecc0bd #faeae2"],
  ["Lavender Haze", "Soft", "#1d1a2e #46406b #8079ad #b9b4d6 #ece9f5"],
  ["Mint Cream", "Soft", "#0f201c #2c4a40 #68907f #aec8b8 #e8f1e8"],
  ["Powder", "Soft", "#1c2430 #45566b #8699ad #c0ccd8 #f0f4f8"],
  ["Apricot", "Soft", "#2a1a12 #6e3f26 #b9764a #e8ad7e #fbe2c6"],
  ["Pearl", "Soft", "#1a1a1c #3f4044 #76787e #b4b6bb #f2f2f3"],

  ["Mono Ash", "Mono", "#000000 #333333 #777777 #bbbbbb #ffffff"],
  ["Warm Mono", "Mono", "#120f0c #3b332c #776b5e #b5aa9c #f4efe7"],
  ["Cool Mono", "Mono", "#0a0d12 #2a3340 #5c6b7d #9eacbb #eef2f7"],
  ["Duotone Blue", "Mono", "#061024 #23498f #7da2d8 #e6eefb"],
  ["Duotone Rose", "Mono", "#1b070f #7a1f3d #d4687f #ffd9e0"],
  ["High Key", "Mono", "#d8d8d8 #e8e8e8 #f4f4f4 #ffffff"],
];

const PALETTE_FAMILIES = Array.from(new Set(PALETTES.map(p => p[1])));
const paletteColours = p => p[2].trim().split(/\s+/);

/* -------------------------------------------------- generated harmonies */

const HARMONIES = ["analogous", "complementary", "triad", "split", "mono", "wander"];
const HARMONY_LABELS = {
  analogous: "Analogous (neighbours)", complementary: "Complementary (opposites)",
  triad: "Triad (three-way)", split: "Split complementary", mono: "Monochrome (one hue)",
  wander: "Wander (drifting hue)",
};

// Build a palette from a seed in OKLCH, so lightness steps are even and the
// chroma does not blow out at the light end where it cannot be reproduced.
function generatePalette(seed, harmony, count) {
  const r = rng(seed);
  const n = count || r.int(4, 6);
  const baseH = r.range(0, Math.PI * 2);
  const dir = r.chance(0.5) ? 1 : -1;
  const spread = { analogous: 0.5, complementary: Math.PI, triad: (Math.PI * 2) / 3,
    split: Math.PI * 0.75, mono: 0.06, wander: 1.6 }[harmony] ?? 0.5;
  const darkFirst = r.chance(0.78);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    let h;
    if (harmony === "triad") h = baseH + dir * spread * Math.round(t * 2);
    else if (harmony === "complementary") h = baseH + dir * spread * (t > 0.55 ? 1 : 0);
    else if (harmony === "split") h = baseH + dir * spread * (t < 0.33 ? 0 : t < 0.66 ? 1 : -1);
    else h = baseH + dir * spread * t;
    h += r.range(-0.08, 0.08);
    // lightness ramps end to end; chroma peaks in the middle where it survives
    const L = darkFirst ? lerp(r.range(0.06, 0.18), r.range(0.88, 0.97), t)
                        : lerp(r.range(0.88, 0.97), r.range(0.06, 0.18), t);
    const peak = 1 - Math.abs(L - 0.55) / 0.55;
    const C = Math.max(0, r.range(0.05, 0.19) * Math.max(0.15, peak));
    out.push(rgbToHex(lchToRgb([clamp01(L), C, h])));
  }
  return out;
}

/* ---------------------------------------------------------------- noise */

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smoothstep = t => t * t * (3 - 2 * t);
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = smoothstep(x - xi), v = smoothstep(y - yi);
  return lerp(lerp(hash2(xi, yi, seed), hash2(xi + 1, yi, seed), u),
              lerp(hash2(xi, yi + 1, seed), hash2(xi + 1, yi + 1, seed), u), v);
}
function fbm(x, y, seed, oct) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < (oct || 4); i++) {
    sum += amp * vnoise(x * f, y * f, seed + i * 1013);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

if (typeof module !== "undefined") {
  module.exports = { hexToRgb, rgbToHex, rgbToOklab, oklabToRgb, rgbToLch, lchToRgb,
    mix, makeRamp, EASINGS, SPACES, PALETTES, paletteColours, generatePalette,
    HARMONIES, rng, hashSeed, fbm, vnoise, clamp01, lerp,
    oklabToRgbMapped, oklabToLin, inGamut, deltaEOK, monotone, hueDelta, HUES, rampLUT };
}
