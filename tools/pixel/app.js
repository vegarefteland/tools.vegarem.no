/* Pixel, Bitmap & ASCII — UI, sources, playback and export.
 * The render engine lives in engine.js (Renderer, PALETTES, frameToSVG …). */
"use strict";

const $ = id => document.getElementById(id);

/* ================================================================
 * THEME (synced with the Studio hub)
 * ================================================================ */
const root = document.documentElement;
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';
const MOON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } }
function applyThemeIcon() { $("themeIcon").innerHTML = root.getAttribute("data-theme") === "dark" ? SUN : MOON; }
if (store("vegar-tools-theme")) root.setAttribute("data-theme", store("vegar-tools-theme"));
applyThemeIcon();
$("themeToggle").addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  store("vegar-tools-theme", next);
  applyThemeIcon();
});

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ================================================================
 * SETTINGS
 * ================================================================ */
const DEFAULTS = {
  mode: "ascii",
  // framing
  outW: 1280, aspect: "source", fit: "cover", zoom: 1, panX: 0, panY: 0, flipH: false, flipV: false,
  // grid
  cell: 8, cellAspect: 1, charAspect: 2, gap: 0,
  // image
  blur: 0, blackPoint: 0, whitePoint: 1, brightness: 0, contrast: 0, gamma: 1,
  saturation: 1, hue: 0, invert: false, sharpen: 0, edgeMix: 0,
  // pixel
  shape: "square", shapeStyle: "fill", lineWidth: 1, roundness: 0.3, sizeMode: "fixed", sizeMin: 0,
  rotation: 0, rotLuma: 0, stagger: false, quantize: false, levelsPixel: 6, levelsBitmap: 2,
  // dither
  ditherPixel: "bayer4", ditherBitmap: "floyd", ditherAscii: "none", ditherBraille: "floyd",
  ditherStrength: 1, ditherSpread: 1, serpentine: true, bias: 0,
  // ascii
  charset: "standard", customChars: " .oO@", font: "IBM Plex Mono", weight: 400, charScale: 1,
  blank: 0, invertRamp: false, asciiTone: false, edges: false, edgeThreshold: 0.35, edgeChars: "ascii", edgeOnly: false,
  // braille
  dotShape: "circle", dotSize: 1, cluster: 0, invertDots: false,
  // colour
  colorMode: "mono", fg: "#ededed", bg: "#0b0b0b", g1: "#10002b", g2: "#e0115f", g3: "#ffd166", gradStops: "3",
  palette: "gameboy", paletteBg: true, transparentBg: false,
  // motion
  fpsLimit: 0, trails: 0, trailMode: "blend", motionOnly: false, motionGain: 5,
  wave: 0, waveFreq: 3, waveSpeed: 0.5, glitch: 0, flicker: 0, rain: 0, rainSpeed: 1, rainLength: 14,
  // effects
  glow: 0, glowRadius: 8, scanlines: 0, scanlineSize: 2, crt: 0, chroma: 0, vignette: 0, grain: 0,
};
// Kept when a look is applied — they describe the shot, not the style.
const FRAMING = ["outW", "aspect", "fit", "zoom", "panX", "panY", "flipH", "flipV"];

const SETTINGS_KEY = "studio-pixel-settings";
let S = Object.assign({}, DEFAULTS);
try { Object.assign(S, JSON.parse(store(SETTINGS_KEY) || "{}")); } catch {}
for (const k of Object.keys(S)) if (!(k in DEFAULTS)) delete S[k];

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store(SETTINGS_KEY, JSON.stringify(S)), 250);
}

/* ================================================================
 * LOOKS
 * ================================================================ */
const LOOKS = [
  { name: "Classic ASCII", dot: "#ededed", s: { mode: "ascii", charset: "standard", cell: 8, fg: "#ededed", bg: "#0b0b0b", contrast: 0.15 } },
  { name: "Matrix", dot: "#3cff6e", s: { mode: "ascii", charset: "katakana", font: "Noto Sans JP", cell: 11, fg: "#3cff6e", bg: "#020a04",
      asciiTone: true, rain: 0.85, rainSpeed: 1.2, rainLength: 18, glow: 0.7, glowRadius: 10, flicker: 0.12, contrast: 0.2 } },
  { name: "Terminal", dot: "#33ff66", s: { mode: "ascii", charset: "detailed", font: "VT323", cell: 7, charAspect: 1.8, fg: "#33ff66", bg: "#031006",
      asciiTone: true, scanlines: 0.35, scanlineSize: 2, glow: 0.5, crt: 0.25, vignette: 0.45 } },
  { name: "Amber CRT", dot: "#ffb000", s: { mode: "ascii", charset: "standard", font: "VT323", cell: 9, charAspect: 1.8, fg: "#ffb000", bg: "#140a00",
      asciiTone: true, scanlines: 0.45, glow: 0.6, glowRadius: 12, crt: 0.3, vignette: 0.55, grain: 0.08 } },
  { name: "Game Boy", dot: "#8bac0f", s: { mode: "pixel", cell: 6, colorMode: "palette", palette: "gameboy", quantize: true, ditherPixel: "bayer4", contrast: 0.15 } },
  { name: "Obra Dinn", dot: "#e5ffff", s: { mode: "bitmap", cell: 2, colorMode: "palette", palette: "obradinn", ditherBitmap: "bayer8", contrast: 0.2 } },
  { name: "Macintosh", dot: "#f4f4ef", s: { mode: "bitmap", cell: 2, ditherBitmap: "atkinson", fg: "#f4f4ef", bg: "#111111", contrast: 0.1 } },
  { name: "CGA", dot: "#ff55ff", s: { mode: "pixel", cell: 5, colorMode: "palette", palette: "cga1", quantize: true, ditherPixel: "bayer4", contrast: 0.2 } },
  { name: "PICO-8", dot: "#ff004d", s: { mode: "pixel", cell: 6, colorMode: "palette", palette: "pico8", quantize: true, ditherPixel: "bayer4", saturation: 1.3 } },
  { name: "LED Board", dot: "#ff3b30", s: { mode: "pixel", shape: "circle", cell: 10, gap: 0.22, colorMode: "source", quantize: true, levelsPixel: 4,
      ditherPixel: "none", bg: "#050505", glow: 0.8, glowRadius: 10, saturation: 1.4, contrast: 0.2 } },
  { name: "Halftone", dot: "#1a1a1a", s: { mode: "pixel", shape: "circle", sizeMode: "inverse", sizeMin: 0, cell: 9, stagger: true, fg: "#151515", bg: "#f3efe6", contrast: 0.15 } },
  { name: "Braille", dot: "#dcdcdc", s: { mode: "braille", cell: 6, fg: "#e6e6e6", bg: "#0b0b0b", ditherBraille: "floyd" } },
  { name: "Blueprint", dot: "#0b3a75", s: { mode: "ascii", charset: "simple", font: "Space Mono", cell: 9, fg: "#d4ebff", bg: "#0b3a75",
      edges: true, edgeChars: "box", edgeThreshold: 0.3, asciiTone: true, grain: 0.06 } },
  { name: "Newsprint", dot: "#efe9dc", s: { mode: "bitmap", cell: 2.5, ditherBitmap: "cluster", fg: "#efe9dc", bg: "#1b1b1b", contrast: 0.2, grain: 0.18 } },
  { name: "Riso", dot: "#ff48b0", s: { mode: "pixel", cell: 3, colorMode: "palette", palette: "riso", quantize: true, ditherPixel: "bayer8", grain: 0.25 } },
  { name: "Neon Edges", dot: "#ff2bd6", s: { mode: "pixel", shape: "circle", sizeMode: "luma", cell: 7, edgeMix: 1, contrast: 0.4, colorMode: "gradient",
      g1: "#05010a", g2: "#ff2bd6", g3: "#00f0ff", bg: "#05010a", glow: 1.2, glowRadius: 10 } },
  { name: "Thermal", dot: "#ff3d00", s: { mode: "pixel", cell: 4, colorMode: "gradient", g1: "#0b0034", g2: "#e4002b", g3: "#fff45c", blur: 2, contrast: 0.2 } },
  { name: "Cross Stitch", dot: "#b23a48", s: { mode: "pixel", shape: "cross", cell: 12, gap: 0.08, colorMode: "source", quantize: true, levelsPixel: 5,
      ditherPixel: "bayer2", bg: "#efe8d8", saturation: 1.2 } },
  { name: "Engraving", dot: "#1c1a17", s: { mode: "pixel", shape: "hline", sizeMode: "inverse", sizeMin: 0.04, cell: 5, fg: "#1c1a17", bg: "#efe6d2",
      contrast: 0.25, wave: 0.01, waveFreq: 12, waveSpeed: 0 } },
  { name: "Motion Ghost", dot: "#9ad0ff", s: { mode: "ascii", charset: "detailed", cell: 8, motionOnly: true, motionGain: 6, trails: 0.85, trailMode: "lighten",
      fg: "#9ad0ff", bg: "#05070b", glow: 0.5 } },
  { name: "VHS Glitch", dot: "#01cdfe", s: { mode: "pixel", cell: 4, colorMode: "source", glitch: 0.55, chroma: 3, scanlines: 0.3, grain: 0.3,
      wave: 0.015, waveFreq: 2, waveSpeed: 0.6, saturation: 1.3, blur: 1 } },
  { name: "Mosaic", dot: "#e9a23b", s: { mode: "pixel", shape: "rounded", roundness: 0.3, cell: 18, gap: 0.12, colorMode: "source", bg: "#161412", saturation: 1.15 } },
  { name: "Dot Matrix", dot: "#ff5a1f", s: { mode: "pixel", shape: "circle", cell: 8, gap: 0.25, quantize: true, levelsPixel: 3, ditherPixel: "bayer4",
      fg: "#ff5a1f", bg: "#120804", glow: 0.6, contrast: 0.2 } },
  { name: "Hex Grid", dot: "#7a5cff", s: { mode: "pixel", shape: "hexagon", stagger: true, cell: 14, gap: 0.06, cellAspect: 0.87, colorMode: "source", bg: "#0a0a0a" } },
  { name: "Star Field", dot: "#fffb96", s: { mode: "pixel", shape: "star", sizeMode: "luma", sizeMin: 0, cell: 12, rotLuma: 72, colorMode: "palette",
      palette: "vapor", paletteBg: true, glow: 0.5 } },
  { name: "Binary", dot: "#00e5ff", s: { mode: "ascii", charset: "binary", font: "JetBrains Mono", cell: 9, fg: "#00e5ff", bg: "#00080c",
      asciiTone: true, flicker: 0.25, fpsLimit: 12, glow: 0.4 } },
  { name: "Stop Motion", dot: "#c47a00", s: { mode: "pixel", cell: 5, colorMode: "palette", palette: "sepia", quantize: true, ditherPixel: "ign",
      fpsLimit: 8, grain: 0.3, vignette: 0.5, flicker: 0.06 } },
];
let activeLook = store("studio-pixel-look") || "";

/* ================================================================
 * CONTROL SCHEMA
 * ================================================================ */
const DITHERS = [
  ["none", "None"], ["floyd", "Floyd–Steinberg"], ["atkinson", "Atkinson"], ["jjn", "Jarvis–Judice–Ninke"],
  ["stucki", "Stucki"], ["burkes", "Burkes"], ["sierra", "Sierra"], ["sierralite", "Sierra Lite"],
  ["bayer2", "Bayer 2×2"], ["bayer4", "Bayer 4×4"], ["bayer8", "Bayer 8×8"], ["bayer16", "Bayer 16×16"],
  ["cluster", "Clustered dot"], ["ign", "Blue-ish noise"], ["noise", "White noise (animated)"],
];
const FONTS = ["IBM Plex Mono", "JetBrains Mono", "Space Mono", "Inconsolata", "VT323", "Press Start 2P", "Silkscreen", "Noto Sans JP", "Menlo", "Courier New"];
const PAL_NAMES = {
  gameboy: "Game Boy", gbgray: "Game Boy Pocket", cga1: "CGA cyan/magenta", cga2: "CGA green/red", pico8: "PICO-8",
  c64: "Commodore 64", zx: "ZX Spectrum", mac: "1-bit", obradinn: "Obra Dinn", amber: "Amber", phosphor: "Green phosphor",
  sepia: "Sepia", gray4: "Grey ×4", gray8: "Grey ×8", cyber: "Cyber", riso: "Riso blue/pink", vapor: "Vaporwave",
};

const isMode = (...m) => () => m.includes(S.mode);
const curDither = () => ({ pixel: S.quantize ? S.ditherPixel : "none", bitmap: S.ditherBitmap, ascii: S.ditherAscii, braille: S.ditherBraille })[S.mode];

const allControls = [];
let sectionEls = [];

function mk(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

function nameEl(key, label) {
  const n = mk("span", "name", label);
  n.dataset.reset = key;
  n.title = "Double-click to reset";
  n.addEventListener("dblclick", () => set(key, DEFAULTS[key]));
  return n;
}

function decimals(step) { const s = String(step); return s.includes(".") ? s.split(".")[1].length : 0; }

function R(key, label, min, max, step, o = {}) {
  const el = mk("div", "ctl");
  const head = mk("div", "ctl-head");
  const val = mk("input", "val");
  val.type = "text";
  head.append(nameEl(key, label), val);
  const inp = mk("input");
  inp.type = "range"; inp.min = min; inp.max = max; inp.step = step;
  el.append(head, inp);
  const dp = decimals(step);
  const fmt = o.fmt || (v => Number(v).toFixed(dp) + (o.unit || ""));
  inp.addEventListener("input", () => set(key, parseFloat(inp.value)));
  val.addEventListener("change", () => {
    const v = parseFloat(val.value);
    if (!isNaN(v)) set(key, Math.min(o.hardMax ?? max, Math.max(o.hardMin ?? min, v)));
    else sync();
  });
  val.addEventListener("keydown", e => { if (e.key === "Enter") val.blur(); });
  function sync() {
    if (document.activeElement !== inp) inp.value = S[key];
    if (document.activeElement !== val) val.value = fmt(S[key]);
  }
  return { el, sync, show: o.show };
}

function Sel(key, label, options, o = {}) {
  const el = mk("div", "ctl");
  const head = mk("div", "ctl-head");
  head.append(nameEl(key, label));
  const sel = mk("select");
  for (const opt of options) {
    const [v, l] = Array.isArray(opt) ? opt : [opt, opt];
    const e = mk("option", null, l); e.value = v; sel.append(e);
  }
  el.append(head, sel);
  sel.addEventListener("change", () => set(key, o.num ? Number(sel.value) : sel.value));
  return { el, sync: () => { sel.value = String(S[key]); }, show: o.show };
}

function Seg(key, options, o = {}) {
  const el = mk("div", "seg small");
  const btns = options.map(([v, l]) => {
    const b = mk("button", null, l);
    b.addEventListener("click", () => set(key, v));
    el.append(b);
    return [v, b];
  });
  return { el, sync: () => btns.forEach(([v, b]) => b.classList.toggle("active", S[key] === v)), show: o.show };
}

function Chk(key, label, o = {}) {
  const el = mk("label", "chk");
  const sw = mk("span", "switch");
  const inp = mk("input"); inp.type = "checkbox";
  sw.append(inp, mk("b"));
  el.append(nameEl(key, label), sw);
  inp.addEventListener("change", () => set(key, inp.checked));
  return { el, sync: () => { inp.checked = !!S[key]; }, show: o.show, cls: "chk" };
}

function Col(key, label, o = {}) {
  const el = mk("div", "colrow");
  const lab = mk("label");
  const code = mk("code");
  const inp = mk("input"); inp.type = "color";
  lab.append(code, inp);
  el.append(nameEl(key, label), lab);
  inp.addEventListener("input", () => set(key, inp.value));
  return { el, sync: () => { inp.value = S[key]; code.textContent = S[key]; }, show: o.show, cls: "colrow" };
}

function Txt(key, label, o = {}) {
  const el = mk("div", "ctl");
  const head = mk("div", "ctl-head");
  head.append(nameEl(key, label));
  const inp = mk("input"); inp.type = "text"; inp.spellcheck = false;
  if (o.placeholder) inp.placeholder = o.placeholder;
  el.append(head, inp);
  inp.addEventListener("input", () => set(key, inp.value));
  return { el, sync: () => { if (document.activeElement !== inp) inp.value = S[key]; }, show: o.show };
}

function Swatches(o = {}) {
  const el = mk("div", "swatches");
  let last = "";
  return {
    el, show: o.show, cls: "swatches",
    sync: () => {
      if (last === S.palette) return;
      last = S.palette;
      el.innerHTML = (PALETTES[S.palette] || []).map(c => '<i style="background:' + c + '"></i>').join("");
    },
  };
}

function Note(text, o = {}) {
  const el = mk("div", "note", text);
  return { el, sync: () => {}, show: o.show, cls: "note" };
}

const SECTIONS = [
  { title: "Output & framing", open: false, items: [
    R("outW", "Width", 160, 3840, 2, { unit: "px", fmt: v => v + " px" }),
    Sel("aspect", "Aspect", [["source", "Source"], "1:1", "4:5", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9"]),
    Seg("fit", [["cover", "Fill"], ["contain", "Fit"]]),
    R("zoom", "Zoom", 0.25, 4, 0.01, { fmt: v => Number(v).toFixed(2) + "×" }),
    R("panX", "Pan X", -1, 1, 0.01),
    R("panY", "Pan Y", -1, 1, 0.01),
    Chk("flipH", "Mirror horizontally"),
    Chk("flipV", "Flip vertically"),
  ] },
  { title: "Grid", open: true, items: [
    R("cell", "Cell size", 1, 64, 0.5, { fmt: v => Number(v).toFixed(1) + " px", hardMax: 400 }),
    R("cellAspect", "Cell aspect", 0.25, 4, 0.01, { show: isMode("pixel", "bitmap"), fmt: v => "1:" + Number(v).toFixed(2) }),
    R("charAspect", "Line height", 1, 3, 0.01, { show: isMode("ascii"), fmt: v => Number(v).toFixed(2) + "×" }),
    R("gap", "Gap", 0, 0.9, 0.01, { show: isMode("pixel") }),
  ] },
  { title: "Pixel shape", open: true, show: isMode("pixel"), items: [
    Sel("shape", "Shape", [["square", "Square"], ["circle", "Circle"], ["rounded", "Rounded square"], ["diamond", "Diamond"],
      ["triangle", "Triangle"], ["hexagon", "Hexagon"], ["star", "Star"], ["plus", "Plus"], ["cross", "Cross ×"],
      ["ring", "Ring"], ["hline", "Horizontal line"], ["vline", "Vertical line"]]),
    Seg("shapeStyle", [["fill", "Filled"], ["outline", "Outline"]]),
    R("lineWidth", "Line width", 0.25, 8, 0.25, { show: () => S.shapeStyle === "outline", fmt: v => Number(v).toFixed(2) + " px" }),
    R("roundness", "Corner radius", 0, 0.5, 0.01, { show: () => S.shape === "rounded" }),
    Sel("sizeMode", "Size by", [["fixed", "Fixed"], ["luma", "Brightness"], ["inverse", "Darkness"]]),
    R("sizeMin", "Smallest size", 0, 1, 0.01, { show: () => S.sizeMode !== "fixed" }),
    R("rotation", "Rotation", 0, 360, 1, { fmt: v => v + "°" }),
    R("rotLuma", "Rotate by brightness", -180, 180, 1, { fmt: v => v + "°" }),
    Chk("stagger", "Offset every other row"),
    Chk("quantize", "Reduce colours"),
    R("levelsPixel", "Levels per channel", 2, 16, 1, { show: () => S.quantize && S.colorMode !== "palette" }),
    Sel("ditherPixel", "Dither", DITHERS, { show: () => S.quantize }),
  ] },
  { title: "Bitmap", open: true, show: isMode("bitmap"), items: [
    Sel("ditherBitmap", "Dither", DITHERS),
    R("levelsBitmap", "Levels", 2, 16, 1, { show: () => S.colorMode !== "palette" }),
    Note("Tip: cell size 1 gives a true 1-bit image at full resolution."),
  ] },
  { title: "Characters", open: true, show: isMode("ascii"), items: [
    Sel("charset", "Character set", [["standard", "Standard  .:-=+*#%@"], ["simple", "Simple  .:oO@"], ["detailed", "Detailed (70)"],
      ["blocks", "Blocks ░▒▓█"], ["bars", "Bars ▁▂▃▄▅▆▇█"], ["dots", "Dots ·•●"], ["shapes", "Circles ∘○◎●"], ["lines", "Lines -=≡"],
      ["binary", "Binary 01"], ["hex", "Hex 0–F"], ["katakana", "Katakana"], ["custom", "Custom…"]]),
    Txt("customChars", "Custom ramp (dark → light)", { show: () => S.charset === "custom", placeholder: " .oO@" }),
    Sel("font", "Font", FONTS),
    Sel("weight", "Weight", [[300, "Light"], [400, "Regular"], [700, "Bold"]], { num: true }),
    R("charScale", "Glyph scale", 0.4, 2.5, 0.01, { fmt: v => Number(v).toFixed(2) + "×" }),
    R("blank", "Blank below", 0, 1, 0.01),
    Chk("invertRamp", "Invert ramp"),
    Chk("asciiTone", "Dim faint glyphs"),
    Sel("ditherAscii", "Dither", DITHERS),
    Chk("edges", "Edge lines"),
    R("edgeThreshold", "Edge threshold", 0.02, 1, 0.01, { show: () => S.edges }),
    Seg("edgeChars", [["ascii", "| / - \\"], ["box", "│ ╱ ─ ╲"]], { show: () => S.edges }),
    Chk("edgeOnly", "Edges only", { show: () => S.edges }),
  ] },
  { title: "Braille dots", open: true, show: isMode("braille"), items: [
    Seg("dotShape", [["circle", "Round"], ["square", "Square"]]),
    R("dotSize", "Dot size", 0.2, 2, 0.01, { fmt: v => Number(v).toFixed(2) + "×" }),
    R("cluster", "Cluster", 0, 0.9, 0.01),
    Chk("invertDots", "Invert"),
    Sel("ditherBraille", "Dither", DITHERS),
  ] },
  { title: "Dither tuning", open: false, show: () => curDither() !== "none", items: [
    R("ditherStrength", "Error diffusion", 0, 1.5, 0.01, { show: () => isDiffusion(curDither()) }),
    Chk("serpentine", "Serpentine scan", { show: () => isDiffusion(curDither()) }),
    R("ditherSpread", "Pattern strength", 0, 2, 0.01, { show: () => isOrdered(curDither()) }),
    R("bias", "Bias", -0.5, 0.5, 0.01),
  ] },
  { title: "Colour", open: true, items: [
    Seg("colorMode", [["mono", "Mono"], ["source", "Source"], ["gradient", "Gradient"], ["palette", "Palette"]]),
    Col("fg", "Ink", { show: () => S.colorMode === "mono" }),
    Col("bg", "Background", { show: () => !(S.colorMode === "palette" && S.paletteBg) && !S.transparentBg }),
    Col("g1", "Shadows", { show: () => S.colorMode === "gradient" }),
    Col("g2", "Midtones", { show: () => S.colorMode === "gradient" && S.gradStops === "3" }),
    Col("g3", "Highlights", { show: () => S.colorMode === "gradient" }),
    Seg("gradStops", [["2", "2 stops"], ["3", "3 stops"]], { show: () => S.colorMode === "gradient" }),
    Sel("palette", "Palette", Object.keys(PALETTES).map(k => [k, PAL_NAMES[k] || k]), { show: () => S.colorMode === "palette" }),
    Swatches({ show: () => S.colorMode === "palette" }),
    Chk("paletteBg", "Background from palette", { show: () => S.colorMode === "palette" }),
    Chk("transparentBg", "Transparent background"),
  ] },
  { title: "Image", open: false, items: [
    R("brightness", "Brightness", -1, 1, 0.01),
    R("contrast", "Contrast", -1, 1, 0.01),
    R("gamma", "Gamma", 0.2, 3, 0.01),
    R("blackPoint", "Black point", 0, 0.95, 0.01),
    R("whitePoint", "White point", 0.05, 1, 0.01),
    R("saturation", "Saturation", 0, 3, 0.01),
    R("hue", "Hue shift", -180, 180, 1, { fmt: v => v + "°" }),
    R("blur", "Pre-blur", 0, 20, 0.1, { fmt: v => Number(v).toFixed(1) + " px" }),
    R("sharpen", "Sharpen", 0, 4, 0.01),
    R("edgeMix", "Edge detect", 0, 1, 0.01),
    Chk("invert", "Invert"),
  ] },
  { title: "Motion", open: false, items: [
    Sel("fpsLimit", "Frame rate", [[0, "Smooth (source)"], [4, "4 fps"], [6, "6 fps"], [8, "8 fps"], [10, "10 fps"], [12, "12 fps"],
      [15, "15 fps"], [24, "24 fps"], [30, "30 fps"]], { num: true }),
    R("trails", "Trails", 0, 0.98, 0.01),
    Sel("trailMode", "Trail blend", [["blend", "Normal"], ["lighten", "Lighten"], ["darken", "Darken"], ["add", "Add (glow)"]], { show: () => S.trails > 0 }),
    Chk("motionOnly", "Show only movement"),
    R("motionGain", "Movement gain", 1, 20, 0.1, { show: () => S.motionOnly }),
    R("wave", "Wave", 0, 0.5, 0.005),
    R("waveFreq", "Wave frequency", 0.25, 30, 0.25, { show: () => S.wave > 0 }),
    R("waveSpeed", "Wave speed", -4, 4, 0.05, { show: () => S.wave > 0 }),
    R("glitch", "Glitch", 0, 1, 0.01),
    R("flicker", "Flicker", 0, 1, 0.01),
    R("rain", "Digital rain", 0, 1, 0.01),
    R("rainSpeed", "Rain speed", 0.1, 4, 0.05, { show: () => S.rain > 0 }),
    R("rainLength", "Rain length", 2, 60, 1, { show: () => S.rain > 0 }),
  ] },
  { title: "Effects", open: false, items: [
    R("glow", "Glow", 0, 2, 0.01),
    R("glowRadius", "Glow radius", 1, 40, 0.5, { show: () => S.glow > 0 }),
    R("scanlines", "Scanlines", 0, 1, 0.01),
    R("scanlineSize", "Scanline size", 1, 12, 1, { show: () => S.scanlines > 0 }),
    R("crt", "RGB mask", 0, 1, 0.01),
    R("chroma", "Chromatic aberration", 0, 20, 0.1, { fmt: v => Number(v).toFixed(1) + " px" }),
    R("vignette", "Vignette", 0, 1, 0.01),
    R("grain", "Grain", 0, 1, 0.01),
  ] },
];

function buildSettings() {
  const host = $("settings");
  const openState = JSON.parse(store("studio-pixel-open") || "{}");
  sectionEls = SECTIONS.map(sec => {
    const d = mk("details", "sec");
    d.open = sec.title in openState ? openState[sec.title] : sec.open;
    d.append(mk("summary", null, sec.title));
    const body = mk("div", "sec-body");
    for (const it of sec.items) { body.append(it.el); allControls.push(it); }
    d.append(body);
    d.addEventListener("toggle", () => {
      openState[sec.title] = d.open;
      store("studio-pixel-open", JSON.stringify(openState));
    });
    host.append(d);
    return { d, sec };
  });

  const looks = $("looks");
  for (const lk of LOOKS) {
    const b = mk("button", "look");
    b.innerHTML = '<i style="background:' + lk.dot + '"></i>' + lk.name;
    b.dataset.look = lk.name;
    b.addEventListener("click", () => applyLook(lk));
    looks.append(b);
  }
  document.querySelectorAll("#modeSeg button").forEach(b => b.addEventListener("click", () => set("mode", b.dataset.mode)));
}

function syncUI() {
  for (const c of allControls) {
    const vis = !c.show || c.show();
    c.el.classList.toggle("hidden", !vis);
    if (c.cls === "swatches" || c.cls === "note") c.el.style.display = vis ? "" : "none";
    if (vis) c.sync();
  }
  for (const { d, sec } of sectionEls) d.style.display = !sec.show || sec.show() ? "" : "none";
  document.querySelectorAll("#modeSeg button").forEach(b => b.classList.toggle("active", b.dataset.mode === S.mode));
  document.querySelectorAll(".look").forEach(b => b.classList.toggle("active", b.dataset.look === activeLook));
  const textual = S.mode === "ascii" || S.mode === "braille";
  $("txtBtn").disabled = $("htmlBtn").disabled = $("copyBtn").disabled = !textual;
  $("stage").classList.toggle("checker", !!S.transparentBg);
}

function set(key, v) {
  if (S[key] === v) return;
  S[key] = v;
  if (activeLook) { activeLook = ""; store("studio-pixel-look", ""); }
  changed(key);
}

function changed(key) {
  if (!key || key === "font" || key === "weight") ensureFont();
  persist();
  syncUI();
  dirty = true;
}

function applyLook(lk) {
  const keep = {};
  for (const k of FRAMING) keep[k] = S[k];
  S = Object.assign({}, DEFAULTS, keep, lk.s);
  activeLook = lk.name;
  store("studio-pixel-look", activeLook);
  renderer.resetTemporal();
  changed();
}

function resetAll() {
  const keep = {};
  for (const k of FRAMING) keep[k] = S[k];
  S = Object.assign({}, DEFAULTS, keep);
  activeLook = "";
  store("studio-pixel-look", "");
  renderer.resetTemporal();
  changed();
  toast("Settings reset — framing kept");
}

function randomize() {
  const rnd = Math.random, pick = a => a[Math.floor(rnd() * a.length)];
  const lk = pick(LOOKS);
  applyLook(lk);
  const s = S;
  s.cell = Math.max(2, Math.round(s.cell * (0.6 + rnd() * 0.9) * 2) / 2);
  s.contrast = Math.round((rnd() * 0.6 - 0.1) * 100) / 100;
  if (s.mode === "pixel" && rnd() < 0.5) {
    s.shape = pick(["square", "circle", "rounded", "diamond", "triangle", "hexagon", "star", "plus", "cross", "ring", "hline", "vline"]);
    s.sizeMode = pick(["fixed", "luma", "inverse"]);
    if (rnd() < 0.3) s.rotLuma = Math.round((rnd() - 0.5) * 180);
    if (rnd() < 0.3) s.stagger = true;
    s.gap = rnd() < 0.5 ? 0 : Math.round(rnd() * 30) / 100;
  }
  if (rnd() < 0.35) { s.colorMode = "palette"; s.palette = pick(Object.keys(PALETTES)); }
  else if (rnd() < 0.3) {
    s.colorMode = "gradient";
    const h = Math.floor(rnd() * 360);
    const hsl = (hh, l) => hslHex((hh + 360) % 360, 0.85, l);
    s.g1 = hsl(h, 0.06); s.g2 = hsl(h + 60 + rnd() * 120, 0.5); s.g3 = hsl(h + 180 + rnd() * 60, 0.85);
    s.bg = s.g1;
  }
  const fx = () => rnd() < 0.25;
  if (fx()) s.glow = Math.round(rnd() * 100) / 100;
  if (fx()) s.scanlines = Math.round(rnd() * 50) / 100;
  if (fx()) s.chroma = Math.round(rnd() * 40) / 10;
  if (fx()) s.vignette = Math.round(rnd() * 60) / 100;
  if (fx()) s.grain = Math.round(rnd() * 30) / 100;
  if (rnd() < 0.15) { s.wave = 0.02; s.waveFreq = 3; }
  if (rnd() < 0.15) s.trails = 0.7;
  if (rnd() < 0.12) s.glitch = 0.3;
  if (rnd() < 0.2) s.fpsLimit = pick([6, 8, 12]);
  activeLook = "";
  changed();
  toast("Random look, based on " + lk.name);
}

function hslHex(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

// Web fonts only paint once loaded — and the glyph atlas is cached — so
// rebuild it when the chosen face arrives.
const loadedFonts = new Set();
function ensureFont() {
  const key = S.weight + " " + S.font;
  if (loadedFonts.has(key) || !document.fonts || !document.fonts.load) return;
  document.fonts.load(S.weight + ' 32px "' + S.font + '"', "Aa@#ｱ").then(() => {
    loadedFonts.add(key);
    renderer.invalidateAtlas();
    dirty = true;
  }).catch(() => {});
}

/* ================================================================
 * SOURCES
 * ================================================================ */
const renderer = new Renderer();
const out = $("out");
const video = document.createElement("video");
video.playsInline = true; video.loop = true; video.preload = "auto";
video.muted = store("studio-pixel-muted") === "1";
const cam = document.createElement("video");
cam.playsInline = true; cam.muted = true;
const demo = document.createElement("canvas");
demo.width = 960; demo.height = 540;

const DEMO_LEN = 8;
const src = { kind: null, el: null, width: 0, height: 0, name: "" };
let srcFile = null, objectURL = null, camStream = null;
let playing = true, clockT = 0, dirty = true;

function stopCam() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  cam.srcObject = null;
}

function setSource(kind, el, w, h, name) {
  if (kind !== "cam") stopCam();
  if (kind !== "video") video.pause();
  Object.assign(src, { kind, el, width: w, height: h, name });
  clockT = 0;
  renderer.resetTemporal();
  document.querySelectorAll(".src-btn").forEach(b => b.classList.remove("active"));
  $({ video: "srcVideo", image: "srcImage", cam: "srcCam", demo: "srcDemo" }[kind]).classList.add("active");
  $("srcName").textContent = name;
  $("stillLenFld").style.display = kind === "image" ? "" : "none";
  $("timeline").disabled = kind === "cam";
  $("muteBtn").style.display = kind === "video" ? "" : "none";
  $("exStart").value = 0;
  $("exEnd").value = +loopLength().toFixed(2);
  $("exAudioRow").style.display = kind === "video" ? "" : "none";
  updateFmtUI();
  dirty = true;
  setPlaying(true);
}

function loadVideo(file) {
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = URL.createObjectURL(file);
  srcFile = file;
  video.src = objectURL;
  video.onloadeddata = () => {
    setSource("video", video, video.videoWidth, video.videoHeight,
      file.name + " · " + video.videoWidth + "×" + video.videoHeight + " · " + fmtTime(video.duration));
  };
  video.onerror = () => toast("This browser can't decode that video — try the Converter to make an mp4 first");
}

function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    srcFile = file;
    setSource("image", img, img.naturalWidth, img.naturalHeight, file.name + " · " + img.naturalWidth + "×" + img.naturalHeight);
  };
  img.onerror = () => toast("Couldn't read that image");
  img.src = url;
}

async function startCam() {
  try {
    stopCam();
    camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    cam.srcObject = camStream;
    await cam.play();
    const w = cam.videoWidth || 1280, h = cam.videoHeight || 720;
    srcFile = null;
    setSource("cam", cam, w, h, "Webcam · " + w + "×" + h);
    if (!S.flipH) { S.flipH = true; changed("flipH"); }
  } catch (e) {
    toast("Camera unavailable: " + (e.message || e.name));
  }
}

function startDemo() {
  srcFile = null;
  drawDemo(0);
  setSource("demo", demo, demo.width, demo.height, "Demo loop · 8 s");
}

// A deterministic 8-second loop: every motion completes a whole number of
// cycles, so rendered exports loop seamlessly.
function drawDemo(T) {
  const x = demo.getContext("2d"), W = demo.width, H = demo.height;
  const a = (T / DEMO_LEN) * Math.PI * 2;
  const bg = x.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "hsl(" + (230 + 30 * Math.sin(a)) + ",45%,10%)");
  bg.addColorStop(1, "hsl(" + (290 + 40 * Math.cos(a)) + ",55%,24%)");
  x.fillStyle = bg; x.fillRect(0, 0, W, H);

  // equaliser bars
  for (let i = 0; i < 24; i++) {
    const v = 0.5 + 0.5 * Math.sin(a * 3 + i * 0.7) * Math.cos(a * 2 - i * 0.3);
    const bh = 30 + v * 170;
    x.fillStyle = "hsl(" + (180 + i * 6) + ",80%," + (35 + v * 30) + "%)";
    x.fillRect(i * (W / 24) + 4, H - bh, W / 24 - 8, bh);
  }
  // rotating square
  x.save();
  x.translate(W * 0.2, H * 0.32); x.rotate(a);
  x.strokeStyle = "rgba(255,255,255,.9)"; x.lineWidth = 14;
  x.strokeRect(-70, -70, 140, 140);
  x.restore();
  // sphere
  const cx = W / 2 + 190 * Math.cos(a), cy = H * 0.42 + 55 * Math.sin(2 * a), r = 135;
  const g = x.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.05, cx, cy, r);
  g.addColorStop(0, "#fff"); g.addColorStop(0.25, "#ffd08a"); g.addColorStop(0.7, "#d2452b"); g.addColorStop(1, "#1b0508");
  x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  // orbiting moons
  for (let i = 0; i < 10; i++) {
    const t = a * 2 + (i / 10) * Math.PI * 2;
    const mx = cx + Math.cos(t) * 205, my = cy + Math.sin(t) * 60, front = Math.sin(t) > 0;
    x.fillStyle = front ? "#e8f4ff" : "rgba(160,190,255,.45)";
    x.beginPath(); x.arc(mx, my, front ? 13 : 8, 0, Math.PI * 2); x.fill();
  }
  // title crawl
  x.font = "900 150px Arimo, Helvetica, Arial, sans-serif";
  x.textBaseline = "middle";
  x.fillStyle = "#ffffff";
  const tw = x.measureText("STUDIO").width;
  x.fillText("STUDIO", W - ((T / DEMO_LEN) * (W + tw + 40)), H * 0.8);
}

/* ================================================================
 * TIME & PLAYBACK
 * ================================================================ */
function loopLength() {
  if (src.kind === "video") return video.duration || 0;
  if (src.kind === "demo") return DEMO_LEN;
  if (src.kind === "image") return Math.max(0.5, parseFloat($("stillLen").value) || 6);
  return 0;
}
function currentT() { return src.kind === "video" ? video.currentTime : clockT; }
function quantT(T) { return S.fpsLimit ? Math.floor(T * S.fpsLimit + 1e-6) / S.fpsLimit : T; }
function frameOf(T) { return Math.floor(T * (S.fpsLimit || 30) + 1e-6); }
function fmtTime(t) {
  if (!isFinite(t)) return "0:00.0";
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
}

const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
const VOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>';
const MUTED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6"/></svg>';

function setPlaying(p) {
  playing = p;
  $("playBtn").innerHTML = p ? PAUSE : PLAY;
  if (src.kind === "video") { if (p) video.play().catch(() => {}); else video.pause(); }
  if (src.kind === "cam") { if (p) cam.play().catch(() => {}); else cam.pause(); }
}

function seek(t) {
  const L = loopLength();
  if (!L) return;
  t = ((t % L) + L) % L;
  if (src.kind === "video") video.currentTime = t; else clockT = t;
  dirty = true;
}

function step(dir) {
  setPlaying(false);
  seek(currentT() + dir / (S.fpsLimit || 30));
}

function updateMute() { $("muteBtn").innerHTML = video.muted ? MUTED : VOL; }

/* ================================================================
 * RENDER LOOP
 * ================================================================ */
let previewScale = parseFloat(store("studio-pixel-scale") || "1") || 1;
$("previewScale").value = String(previewScale);
let lastT = -1, lastNow = performance.now(), lastTickAt = 0;
let lastLayout = null, lastMs = 0, fpsEMA = 0, lastRenderAt = 0, statsOn = store("studio-pixel-stats") !== "0";
let busy = false;

function fitCanvas() {
  const st = $("stage").getBoundingClientRect();
  if (!out.width || !out.height) return;
  const k = Math.min((st.width - 24) / out.width, (st.height - 24) / out.height);
  out.style.width = Math.max(1, Math.floor(out.width * k)) + "px";
  out.style.height = Math.max(1, Math.floor(out.height * k)) + "px";
}
new ResizeObserver(fitCanvas).observe($("stage"));

function tick() {
  const now = performance.now();
  lastTickAt = now;
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  if (!src.kind || busy || exporting) return;
  if (playing && src.kind !== "video") {
    clockT += dt;
    const L = loopLength();
    if (L) clockT %= L;
  }
  const T = currentT();
  const Te = quantT(T);
  const camFrame = src.kind === "cam" && playing;
  if (!dirty && Te === lastT && !(camFrame && !S.fpsLimit)) { updateTransport(T); return; }
  if (src.kind === "video" && (video.readyState < 2 || !video.videoWidth)) return;
  busy = true;
  try {
    if (src.kind === "demo") drawDemo(Te);
    const w0 = out.width, h0 = out.height;
    const t0 = performance.now();
    lastLayout = renderer.render(srcView(), S, Te, frameOf(Te), previewScale, out, false);
    lastMs = performance.now() - t0;
    if (out.width !== w0 || out.height !== h0) fitCanvas();
    if (lastRenderAt) fpsEMA = fpsEMA * 0.9 + (1000 / Math.max(1, now - lastRenderAt)) * 0.1;
    lastRenderAt = now;
    lastT = Te; dirty = false;
    drawCompare();
    updateStats();
  } catch (e) {
    console.error(e);
    dirty = false;
  } finally { busy = false; }
  updateTransport(T);
}

function srcView() { return { el: src.el, width: src.kind === "cam" ? (cam.videoWidth || src.width) : src.width, height: src.kind === "cam" ? (cam.videoHeight || src.height) : src.height }; }

function loop() { tick(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
// rAF stalls in background tabs and some embedded views — keep a slow heartbeat.
setInterval(() => { if (performance.now() - lastTickAt > 120) tick(); }, 100);

let scrubbing = false;
function updateTransport(T) {
  const L = loopLength();
  if (!scrubbing && L) $("timeline").value = Math.round((T / L) * 1000);
  $("time").textContent = src.kind === "cam" ? "live" : fmtTime(T) + " / " + fmtTime(L);
}

function updateStats() {
  const el = $("stats");
  el.classList.toggle("hidden", !statsOn);
  if (!statsOn || !lastLayout) return;
  const Lo = lastLayout;
  const unit = S.mode === "ascii" ? "chars" : S.mode === "braille" ? "cells" : "px";
  el.textContent = Lo.cols + "×" + Lo.rows + " " + unit + " · " + Lo.outW + "×" + Lo.outH +
    (previewScale !== 1 ? " (preview " + previewScale + "×)" : "") + " · " + lastMs.toFixed(1) + " ms · " + Math.round(fpsEMA) + " fps";
}

const compare = $("compare");
let compareOn = false;
function drawCompare() {
  if (!compareOn || !src.el) return;
  const w = 240, h = Math.round(240 * src.height / src.width);
  if (compare.width !== w) compare.width = w;
  if (compare.height !== h) compare.height = h;
  const c = compare.getContext("2d");
  c.save();
  if (S.flipH) { c.translate(w, 0); c.scale(-1, 1); }
  c.drawImage(src.el, 0, 0, w, h);
  c.restore();
}

/* ================================================================
 * STILL EXPORT
 * ================================================================ */
function baseName() {
  const n = (srcFile && srcFile.name) ? srcFile.name.replace(/\.[^.]+$/, "") : src.kind || "frame";
  return n + "-" + S.mode;
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Renders the current frame at full size with capture on, so vector and
// text exports see exactly the geometry the canvas got.
function captureFrame() {
  if (!src.kind) { toast("Load a source first"); return null; }
  const T = quantT(currentT());
  if (src.kind === "demo") drawDemo(T);
  const c = document.createElement("canvas");
  renderer.render(srcView(), S, T, frameOf(T), 1, c, true);
  dirty = true;
  return { canvas: c, fd: renderer.frameData };
}

$("pngBtn").addEventListener("click", () => {
  const f = captureFrame(); if (!f) return;
  f.canvas.toBlob(b => { download(b, baseName() + ".png"); toast("PNG saved"); }, "image/png");
});
$("svgBtn").addEventListener("click", () => {
  const f = captureFrame(); if (!f) return;
  download(new Blob([frameToSVG(f.fd)], { type: "image/svg+xml" }), baseName() + ".svg");
  const fx = S.glow || S.scanlines || S.crt || S.chroma || S.vignette || S.grain || S.trails;
  toast(fx ? "SVG saved — post effects are raster-only and left out" : "SVG saved");
});
$("txtBtn").addEventListener("click", () => {
  const f = captureFrame(); if (!f) return;
  download(new Blob([frameToText(f.fd)], { type: "text/plain;charset=utf-8" }), baseName() + ".txt");
  toast("Text saved");
});
$("htmlBtn").addEventListener("click", () => {
  const f = captureFrame(); if (!f) return;
  download(new Blob([frameToHTML(f.fd)], { type: "text/html;charset=utf-8" }), baseName() + ".html");
  toast("HTML saved");
});
$("copyBtn").addEventListener("click", async () => {
  const f = captureFrame(); if (!f) return;
  try { await navigator.clipboard.writeText(frameToText(f.fd)); toast("Copied " + f.fd.Lo.cols + "×" + f.fd.Lo.rows + " characters"); }
  catch { toast("Clipboard blocked by the browser"); }
});

/* ================================================================
 * VIDEO RENDER (offline, frame accurate, via ffmpeg.wasm)
 * ================================================================ */
let fmt = store("studio-pixel-fmt") || "mp4";
let exporting = false, cancelRender = false;
let ffmpegInstance = null, ffmpegLoading = null;

function updateFmtUI() {
  document.querySelectorAll("#fmtSeg button").forEach(b => b.classList.toggle("active", b.dataset.fmt === fmt));
  const q = +$("exQual").value;
  const lbl = fmt === "mp4" ? "CRF " + crfMp4(q) : fmt === "webm" ? "CRF " + crfWebm(q) : fmt === "gif" ? gifColours(q) + " colours" : "lossless";
  $("exQualVal").textContent = lbl;
  $("exQualFld").style.display = fmt === "png" ? "none" : "";
  $("exAudioRow").style.display = src.kind === "video" && (fmt === "mp4" || fmt === "webm") ? "" : "none";
  $("renderBtn").textContent = exporting ? "Cancel" : fmt === "png" ? "Save frames…" : "Render";
}
const crfMp4 = q => Math.round(40 - q * 0.3);
const crfWebm = q => Math.round(44 - q * 0.38);
const gifColours = q => Math.max(4, Math.min(256, Math.round(8 + q * 2.48)));

document.querySelectorAll("#fmtSeg button").forEach(b => b.addEventListener("click", () => {
  fmt = b.dataset.fmt; store("studio-pixel-fmt", fmt); updateFmtUI();
}));
$("exQual").addEventListener("input", updateFmtUI);
$("rangeBtn").addEventListener("click", () => { $("exStart").value = 0; $("exEnd").value = +loopLength().toFixed(2); });

async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoading) return ffmpegLoading;
  if (!window.__ffmpegModule) throw new Error("Export engine unavailable — reload the page, and try Chrome if it persists.");
  ffmpegLoading = (async () => {
    const inst = new window.__ffmpegModule.FFmpeg();
    await inst.load({
      coreURL: new URL("/tools/vendor/core/ffmpeg-core.js", location.href).href,
      wasmURL: new URL("/tools/vendor/core/ffmpeg-core.wasm", location.href).href,
    });
    ffmpegInstance = inst;
    return inst;
  })();
  try { return await ffmpegLoading; } finally { ffmpegLoading = null; }
}

function seekVideo(t) {
  return new Promise(res => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return res();
    const done = () => { clearTimeout(to); video.removeEventListener("seeked", done); res(); };
    const to = setTimeout(done, 3000);
    video.addEventListener("seeked", done);
    video.currentTime = t;
  });
}

const progress = p => { $("progress").classList.add("show"); $("progressFill").style.width = Math.round(p * 100) + "%"; };
function note(msg, err) { const n = $("renderNote"); n.textContent = msg; n.classList.toggle("err", !!err); }

$("renderBtn").addEventListener("click", () => {
  if (exporting) {
    cancelRender = true;
    if (ffmpegInstance) { try { ffmpegInstance.terminate(); } catch {} ffmpegInstance = null; }
    return;
  }
  renderVideo();
});

async function renderVideo() {
  if (!src.kind) return toast("Load a source first");
  if (src.kind === "cam") return toast("Webcam is live — use Record live below");
  const fps = parseInt($("exFps").value, 10);
  const scale = parseFloat($("exScale").value);
  const L = loopLength();
  let start = Math.max(0, parseFloat($("exStart").value) || 0);
  let end = Math.min(src.kind === "video" ? L : 3600, parseFloat($("exEnd").value) || L);
  if (!(end > start)) return toast("End must be after start");
  const N = Math.max(1, Math.round((end - start) * fps));
  const q = +$("exQual").value;

  let dir = null;
  if (fmt === "png") {
    if (!window.showDirectoryPicker) return toast("Saving a frame folder needs Chrome or Edge");
    try { dir = await window.showDirectoryPicker({ mode: "readwrite" }); } catch { return; }
  }

  exporting = true; cancelRender = false;
  updateFmtUI();
  const wasPlaying = playing, resumeT = currentT();
  setPlaying(false);
  progress(0);
  const r = new Renderer();
  const c = document.createElement("canvas");
  const frameExt = fmt === "gif" ? "png" : "jpg";
  let ffmpeg = null;
  try {
    if (dir === null) { note("Loading encoder…"); ffmpeg = await getFFmpeg(); }
    const t0 = performance.now();
    for (let k = 0; k < N; k++) {
      if (cancelRender) throw new Error("cancelled");
      const T = quantT(start + k / fps);
      if (src.kind === "video") await seekVideo(Math.min(T, Math.max(0, L - 0.001)));
      if (src.kind === "demo") drawDemo(T % DEMO_LEN);
      r.render(srcView(), S, T, frameOf(T), scale, c, false);
      if (k === 0) note("Rendering " + N + " frames at " + c.width + "×" + c.height + "…");
      if (dir) {
        const blob = await new Promise(res => c.toBlob(res, "image/png"));
        const fh = await dir.getFileHandle(baseName() + "_" + String(k).padStart(5, "0") + ".png", { create: true });
        const w = await fh.createWritable(); await w.write(blob); await w.close();
      } else {
        const blob = await new Promise(res => c.toBlob(res, frameExt === "png" ? "image/png" : "image/jpeg", 0.95));
        const name = "f" + String(k).padStart(5, "0") + "." + frameExt;
        await ffmpeg.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
      }
      progress((k + 1) / N * (dir ? 1 : 0.8));
      if (k % 10 === 9) {
        const per = (performance.now() - t0) / (k + 1);
        note("Frame " + (k + 1) + " / " + N + " · about " + Math.ceil(per * (N - k - 1) / 1000) + " s left");
      }
    }
    if (dir) {
      note("Saved " + N + " PNG frames.");
      toast(N + " frames saved");
      return;
    }

    note("Encoding " + fmt.toUpperCase() + "…");
    const onProg = ({ progress: p }) => { if (p >= 0 && p <= 1) progress(0.8 + p * 0.2); };
    ffmpeg.on("progress", onProg);
    const inp = ["-framerate", String(fps), "-i", "f%05d." + frameExt];
    const outName = "out." + fmt;
    let audioIn = null;
    const wantAudio = src.kind === "video" && srcFile && $("exAudio").checked && fmt !== "gif";
    if (wantAudio) {
      audioIn = "src" + (srcFile.name.match(/\.[^.]+$/) || [".mp4"])[0].toLowerCase();
      await ffmpeg.writeFile(audioIn, new Uint8Array(await srcFile.arrayBuffer()));
    }
    const withAudio = a => a && audioIn ? ["-ss", String(start), "-t", String(end - start), "-i", audioIn] : [];
    const mapA = a => a && audioIn ? ["-map", "0:v", "-map", "1:a?", "-shortest"] : [];
    const build = a => {
      if (fmt === "mp4") return [...inp, ...withAudio(a), ...mapA(a), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium",
        "-tune", "animation", "-crf", String(crfMp4(q)), ...(a && audioIn ? ["-c:a", "aac", "-b:a", "192k"] : []), "-movflags", "+faststart", outName];
      // VP8, not VP9: this core's VP9 encoder runs out of memory on detailed frames.
      if (fmt === "webm") return [...inp, ...withAudio(a), ...mapA(a), "-c:v", "libvpx", "-pix_fmt", "yuv420p", "-crf", String(crfWebm(q)),
        "-b:v", "20M", "-auto-alt-ref", "0", ...(a && audioIn ? ["-c:a", "libopus", "-b:a", "160k"] : []), outName];
      return null;
    };
    if (fmt === "gif") {
      const cols = gifColours(q);
      let code = await ffmpeg.exec([...inp, "-vf", "palettegen=max_colors=" + cols + ":stats_mode=full:reserve_transparent=0", "pal.png"]);
      if (code !== 0) throw new Error("palette step failed");
      code = await ffmpeg.exec([...inp, "-i", "pal.png", "-lavfi", "[0:v][1:v]paletteuse=dither=none:diff_mode=rectangle", "-loop", "0", outName]);
      if (code !== 0) throw new Error("gif encode failed");
      try { await ffmpeg.deleteFile("pal.png"); } catch {}
    } else {
      let code = await ffmpeg.exec(build(true));
      if (code !== 0 && audioIn) { note("Audio track failed — encoding without it…"); code = await ffmpeg.exec(build(false)); }
      if (code !== 0) throw new Error("encode failed (exit " + code + ")");
    }
    const data = await ffmpeg.readFile(outName);
    try { await ffmpeg.deleteFile(outName); } catch {}
    if (audioIn) try { await ffmpeg.deleteFile(audioIn); } catch {}
    const mime = { mp4: "video/mp4", webm: "video/webm", gif: "image/gif" }[fmt];
    download(new Blob([data.buffer], { type: mime }), baseName() + "." + fmt);
    progress(1);
    note("Done — " + N + " frames, " + (data.byteLength / 1048576).toFixed(1) + " MB.");
    toast(fmt.toUpperCase() + " saved");
  } catch (e) {
    if (cancelRender || e.message === "cancelled") note("Cancelled.");
    else { console.error(e); note(e.message || String(e), true); }
  } finally {
    // A fresh core per render, so one failed encode can't poison the next.
    if (ffmpegInstance) { try { ffmpegInstance.terminate(); } catch {} ffmpegInstance = null; }
    exporting = false; cancelRender = false;
    setTimeout(() => $("progress").classList.remove("show"), 1200);
    updateFmtUI();
    if (src.kind === "video") await seekVideo(resumeT); else clockT = resumeT;
    dirty = true;
    setPlaying(wasPlaying);
  }
}

/* ================================================================
 * LIVE RECORDING (MediaRecorder on the preview canvas)
 * ================================================================ */
let recorder = null, recChunks = [], audioCtx = null, audioDest = null, recScaleWas = null;

function pickMime() {
  const opts = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return opts.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
}

function videoAudioTrack() {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
      const node = audioCtx.createMediaElementSource(video);
      audioDest = audioCtx.createMediaStreamDestination();
      node.connect(audioCtx.destination);
      node.connect(audioDest);
    }
    audioCtx.resume();
    return audioDest.stream.getAudioTracks()[0] || null;
  } catch { return null; }
}

$("recBtn").addEventListener("click", () => {
  if (recorder) { recorder.stop(); return; }
  if (!src.kind) return toast("Load a source first");
  if (!window.MediaRecorder || !out.captureStream) return toast("Recording isn't supported in this browser");
  if (previewScale !== 1) { recScaleWas = previewScale; setPreviewScale(1); }
  const stream = out.captureStream(S.fpsLimit || 30);
  if ($("recAudio").checked && src.kind === "video") {
    const tr = videoAudioTrack();
    if (tr) stream.addTrack(tr);
  }
  const mime = pickMime();
  recorder = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 16e6 });
  recChunks = [];
  recorder.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
  recorder.onstop = () => {
    const type = recorder.mimeType || mime || "video/webm";
    const ext = type.includes("mp4") ? "mp4" : "webm";
    download(new Blob(recChunks, { type }), baseName() + "-live." + ext);
    recorder = null;
    $("recBtn").classList.remove("on");
    $("recBtn").textContent = "● Record";
    if (recScaleWas) { setPreviewScale(recScaleWas); recScaleWas = null; }
    toast("Recording saved");
  };
  recorder.start(250);
  $("recBtn").classList.add("on");
  $("recBtn").textContent = "■ Stop recording";
  if (!playing) setPlaying(true);
});

/* ================================================================
 * SETTINGS FILES
 * ================================================================ */
$("saveBtn").addEventListener("click", () => {
  download(new Blob([JSON.stringify({ tool: "studio-pixel", version: 1, settings: S }, null, 2)], { type: "application/json" }),
    (activeLook || "pixel-look").toLowerCase().replace(/\s+/g, "-") + ".json");
});
$("loadBtn").addEventListener("click", () => $("jsonInput").click());
$("jsonInput").addEventListener("change", e => { if (e.target.files[0]) loadSettings(e.target.files[0]); e.target.value = ""; });

async function loadSettings(file) {
  try {
    const j = JSON.parse(await file.text());
    const s = j.settings || j;
    const next = Object.assign({}, DEFAULTS);
    for (const k of Object.keys(DEFAULTS)) if (k in s && typeof s[k] === typeof DEFAULTS[k]) next[k] = s[k];
    S = next;
    activeLook = "";
    renderer.resetTemporal();
    changed();
    toast("Settings loaded");
  } catch { toast("That isn't a settings file"); }
}

/* ================================================================
 * WIRING
 * ================================================================ */
function openFile(file) {
  if (!file) return;
  if (file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|ogv)$/i.test(file.name)) loadVideo(file);
  else if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name)) loadImage(file);
  else if (/\.json$/i.test(file.name)) loadSettings(file);
  else toast("Unsupported file: " + file.name);
}

$("srcVideo").addEventListener("click", () => $("videoInput").click());
$("srcImage").addEventListener("click", () => $("imageInput").click());
$("srcCam").addEventListener("click", startCam);
$("srcDemo").addEventListener("click", startDemo);
$("videoInput").addEventListener("change", e => { openFile(e.target.files[0]); e.target.value = ""; });
$("imageInput").addEventListener("change", e => { openFile(e.target.files[0]); e.target.value = ""; });
$("stillLen").addEventListener("change", () => { $("exEnd").value = +loopLength().toFixed(2); });

let dragDepth = 0;
window.addEventListener("dragenter", e => { e.preventDefault(); dragDepth++; $("stage").classList.add("drag"); });
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("stage").classList.remove("drag"); } });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => {
  e.preventDefault(); dragDepth = 0; $("stage").classList.remove("drag");
  openFile(e.dataTransfer.files[0]);
});

$("playBtn").addEventListener("click", () => setPlaying(!playing));
$("stepBtn").addEventListener("click", () => step(1));
$("muteBtn").addEventListener("click", () => {
  video.muted = !video.muted; store("studio-pixel-muted", video.muted ? "1" : "0"); updateMute();
});
const tl = $("timeline");
tl.addEventListener("pointerdown", () => { scrubbing = true; });
window.addEventListener("pointerup", () => { scrubbing = false; });
tl.addEventListener("input", () => seek((tl.value / 1000) * loopLength()));

function setPreviewScale(v) {
  previewScale = v;
  $("previewScale").value = String(v);
  store("studio-pixel-scale", String(v));
  dirty = true;
}
$("previewScale").addEventListener("change", e => setPreviewScale(parseFloat(e.target.value)));

$("randomBtn").addEventListener("click", randomize);
$("resetBtn").addEventListener("click", resetAll);

$("compareBtn").addEventListener("click", () => {
  compareOn = !compareOn;
  compare.classList.toggle("show", compareOn);
  $("compareBtn").classList.toggle("on", compareOn);
  dirty = true;
});
let crisp = store("studio-pixel-crisp") === "1";
function applyCrisp() { out.classList.toggle("pixelated", crisp); $("pixelBtn").classList.toggle("on", crisp); }
$("pixelBtn").addEventListener("click", () => { crisp = !crisp; store("studio-pixel-crisp", crisp ? "1" : "0"); applyCrisp(); });
$("statsBtn").addEventListener("click", () => {
  statsOn = !statsOn; store("studio-pixel-stats", statsOn ? "1" : "0");
  $("statsBtn").classList.toggle("on", statsOn); updateStats();
});
$("fullBtn").addEventListener("click", () => {
  const st = $("stage");
  if (document.fullscreenElement) document.exitFullscreen();
  else (st.requestFullscreen || st.webkitRequestFullscreen).call(st);
});

window.addEventListener("keydown", e => {
  const t = e.target;
  if (t.closest && t.closest("input, select, textarea") && !(t.type === "range" && e.key === " ")) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === " ") { e.preventDefault(); setPlaying(!playing); }
  else if (k === "ArrowRight") { e.preventDefault(); step(1); }
  else if (k === "ArrowLeft") { e.preventDefault(); step(-1); }
  else if (k >= "1" && k <= "4") set("mode", ["pixel", "bitmap", "ascii", "braille"][+k - 1]);
  else if (k === "r" || k === "R") randomize();
  else if (k === "c" || k === "C") $("compareBtn").click();
  else if (k === "i" || k === "I") $("statsBtn").click();
  else if (k === "f" || k === "F") $("fullBtn").click();
  else if (k === "m" || k === "M") $("muteBtn").click();
});

/* ---------------------------------------------------------------- boot */
buildSettings();
syncUI();
ensureFont();
applyCrisp();
updateMute();
$("statsBtn").classList.toggle("on", statsOn);
updateFmtUI();
startDemo();
