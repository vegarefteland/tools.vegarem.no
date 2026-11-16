/* Gradient Generator, controls, seeding and export.
 * Colour maths is in engine.js; the painting is in render.js. */
"use strict";

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ================================================================ chrome */
const NAV = [["/", "Tools"], ["/tools/layout/index.html", "Layout"],
  ["/tools/converter/index.html", "Converter"],
  ["/tools/animator/index.html", "Animator"], ["/tools/pixel/index.html", "Pixel"], ["/tools/gradient/index.html", "Gradient"],
  ["/tools/paths/index.html", "Paths"]];
$("#nav").innerHTML = NAV.map(([h, l]) =>
  '<a href="' + h + '"' + (l === "Gradient" ? ' class="active"' : "") + ">" + l + "</a>")
  .join('<span class="sep">&middot;</span>');

const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';
const MOON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
const root = document.documentElement;
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } }
function paintTheme() { $("#themeIcon").innerHTML = root.getAttribute("data-theme") === "dark" ? SUN : MOON; }
if (store("vegar-tools-theme")) root.setAttribute("data-theme", store("vegar-tools-theme"));
paintTheme();
$("#themeToggle").addEventListener("click", () => {
  const n = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", n); store("vegar-tools-theme", n); paintTheme();
});
let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ================================================================ state */
const DEFAULTS = {
  type: "mesh", seed: "seihitsu",
  stops: [{ pos: 0, hex: "#0a0912" }, { pos: 0.35, hex: "#241a35" },
          { pos: 0.62, hex: "#c2405c" }, { pos: 0.82, hex: "#f4b3ad" }, { pos: 1, hex: "#e9e7e4" }],
  space: "oklab", easing: "smooth", bias: 0.5,
  angle: 90, cx: 0.5, cy: 0.5, radius: 1, inner: 0, squash: 1, mirror: true,
  horizon: 0.52, reflect: 0.85, deepen: 0.5, line: 0,
  bands: 6, soft: 0.4, alternate: true,
  points: 5, spread: 0.85, falloff: 0.5,
  scale: 2.4, warp: 0.6, detail: 4, contrast: 0.2,
  smooth: 0, grain: 0.14, grainSize: 1.6, grainColour: false, dither: 0.7,
  posterize: 0, vignette: 0.16, vignetteSoft: 0.55,
  adjBright: 1, adjContrast: 1, adjSat: 1, adjHue: 0,
  w: 1080, h: 1350, margin: 0,
  label: "", hexList: false, labelAuto: true, labelColour: "#ffffff",
  labelPos: "tl", labelSize: 1.5, labelPad: 5, labelOpacity: 0.9,
};
let C = JSON.parse(JSON.stringify(DEFAULTS));
try {
  const saved = JSON.parse(store("studio-gradient") || "null");
  if (saved && saved.stops) C = Object.assign(C, saved);
} catch {}
const locks = { colours: false, type: false, finish: false };
let saveT;
function persist() { clearTimeout(saveT); saveT = setTimeout(() => store("studio-gradient", JSON.stringify(C)), 250); }

/* ============================================================== controls */
function mk(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
const dec = step => { const s = String(step); return s.includes(".") ? s.split(".")[1].length : 0; };

function R(key, label, min, max, step, o) {
  o = o || {};
  const el = mk("div", "ctl");
  const head = mk("div", "ctl-head");
  const name = mk("span", "name", label);
  name.title = "Double-click to reset";
  name.addEventListener("dblclick", () => { C[key] = DEFAULTS[key]; sync(); draw(); persist(); });
  const val = mk("span", "val");
  head.append(name, val);
  const inp = mk("input");
  inp.type = "range"; inp.min = min; inp.max = max; inp.step = step;
  el.append(head, inp);
  const d = dec(step);
  const show = () => {
    inp.value = C[key];
    val.textContent = o.fmt ? o.fmt(C[key]) : Number(C[key]).toFixed(d) + (o.unit || "");
  };
  inp.addEventListener("input", () => { C[key] = parseFloat(inp.value); show(); draw(); persist(); });
  return { el, show, key, show_if: o.show };
}
function Sel(key, label, options, o) {
  o = o || {};
  const el = mk("div", "ctl");
  el.append(mk("div", "ctl-head", '<span class="name">' + label + "</span>"));
  const sel = mk("select");
  options.forEach(([v, l]) => { const op = mk("option", null, l); op.value = v; sel.append(op); });
  el.append(sel);
  sel.addEventListener("change", () => { C[key] = o.num ? +sel.value : sel.value; sync(); draw(); persist(); });
  return { el, show: () => { sel.value = String(C[key]); }, key, show_if: o.show };
}
function Chk(key, label, o) {
  o = o || {};
  const el = mk("label", "chk");
  const sw = mk("span", "switch");
  const inp = mk("input"); inp.type = "checkbox";
  sw.append(inp, mk("b"));
  el.append(mk("span", null, label), sw);
  inp.addEventListener("change", () => { C[key] = inp.checked; sync(); draw(); persist(); });
  return { el, show: () => { inp.checked = !!C[key]; }, key, show_if: o.show };
}

const isType = (...t) => () => t.includes(C.type);
const pct = v => Math.round(v * 100) + "%";

const TYPE_PARAMS = [
  R("angle", "Angle", 0, 360, 1, { unit: "°", show: isType("linear", "conic", "bands") }),
  R("cx", "Centre X", 0, 1, 0.01, { fmt: pct, show: isType("radial", "conic") }),
  R("cy", "Centre Y", 0, 1, 0.01, { fmt: pct, show: isType("radial", "conic") }),
  R("radius", "Radius", 0.2, 2.5, 0.01, { fmt: pct, show: isType("radial") }),
  R("inner", "Inner stop", 0, 0.9, 0.01, { fmt: pct, show: isType("radial") }),
  R("squash", "Squash", 0.1, 2, 0.01, { fmt: v => Number(v).toFixed(2) + "×", show: isType("radial") }),
  Chk("mirror", "Mirror the seam", { show: isType("conic") }),
  R("horizon", "Horizon line", 0.05, 0.95, 0.01, { fmt: pct, show: isType("horizon") }),
  R("reflect", "Reflection", 0.15, 2, 0.01, { show: isType("horizon") }),
  R("deepen", "Depth falloff", 0, 1, 0.01, { show: isType("horizon") }),
  R("line", "Horizon glow", 0, 1, 0.01, { show: isType("horizon") }),
  R("bands", "Bands", 2, 24, 1, { show: isType("bands") }),
  R("soft", "Band softness", 0, 1, 0.01, { show: isType("bands") }),
  Chk("alternate", "Alternate direction", { show: isType("bands") }),
  R("points", "Colour points", 2, 12, 1, { show: isType("mesh") }),
  R("spread", "Spread", 0.2, 2, 0.01, { show: isType("mesh") }),
  R("falloff", "Falloff", 0, 1, 0.01, { show: isType("mesh") }),
  R("scale", "Scale", 0.5, 10, 0.1, { show: isType("fluid") }),
  R("warp", "Warp", 0, 2, 0.01, { show: isType("fluid") }),
  R("detail", "Detail", 1, 7, 1, { show: isType("fluid") }),
  R("contrast", "Contrast", 0, 1, 0.01, { show: isType("fluid") }),
];
const FINISH_PARAMS = [
  R("smooth", "Smooth", 0, 8, 0.1, { fmt: v => Number(v).toFixed(1) + "%" }),
  R("grain", "Grain", 0, 0.7, 0.01),
  R("grainSize", "Grain size", 0.5, 6, 0.1, { fmt: v => Number(v).toFixed(1) + "×" }),
  Chk("grainColour", "Colour grain"),
  R("dither", "Anti-banding", 0, 2, 0.05),
  R("posterize", "Posterize", 0, 32, 1, { fmt: v => (v < 2 ? "off" : v + " steps") }),
  R("vignette", "Vignette", 0, 0.9, 0.01),
  R("vignetteSoft", "Vignette softness", 0.05, 1, 0.01),
  R("adjBright", "Brightness", 0.4, 1.8, 0.01, { fmt: v => Number(v).toFixed(2) + "×" }),
  R("adjContrast", "Contrast", 0.4, 2, 0.01, { fmt: v => Number(v).toFixed(2) + "×" }),
  R("adjSat", "Saturation", 0, 2.5, 0.01, { fmt: v => Number(v).toFixed(2) + "×" }),
  R("adjHue", "Hue shift", -180, 180, 1, { unit: "°" }),
];
const CANVAS_PARAMS = [R("margin", "Inset", 0, 25, 0.5, { fmt: v => Number(v).toFixed(1) + "%" })];
const LABEL_PARAMS = [
  R("labelSize", "Label size", 0.6, 6, 0.1, { fmt: v => Number(v).toFixed(1) + "%" }),
  R("labelPad", "Label margin", 1, 20, 0.5, { fmt: v => Number(v).toFixed(1) + "%" }),
  R("labelOpacity", "Label opacity", 0.1, 1, 0.01),
];
const ALL = TYPE_PARAMS.concat(FINISH_PARAMS, CANVAS_PARAMS, LABEL_PARAMS);
TYPE_PARAMS.forEach(c => $("#typeParams").append(c.el));
FINISH_PARAMS.forEach(c => $("#finish").append(c.el));
CANVAS_PARAMS.forEach(c => $("#canvasExtra").append(c.el));
LABEL_PARAMS.forEach(c => $("#labelParams").append(c.el));

/* type + bias + selects */
$("#typeSeg").innerHTML = TYPES.map(t => '<button data-type="' + t + '">' + TYPE_LABELS[t] + "</button>").join("");
$$("#typeSeg button").forEach(b => b.addEventListener("click", () => {
  C.type = b.dataset.type; sync(); draw(); persist();
}));
$("#space").innerHTML = SPACES.map(s => '<option value="' + s + '">' + SPACE_LABELS[s] + "</option>").join("");
$("#space").addEventListener("change", e => { C.space = e.target.value; draw(); persist(); });
$("#easing").innerHTML = Object.keys(EASINGS).map(k => '<option value="' + k + '">' + EASING_LABELS[k] + "</option>").join("");
$("#easing").addEventListener("change", e => { C.easing = e.target.value; draw(); persist(); });
const biasCtl = R("bias", "Midpoint bias", 0.05, 0.95, 0.01, { fmt: pct });
$("#biasCtl").replaceWith(biasCtl.el);
ALL.push(biasCtl);

const POSITIONS = [["tl", "┌"], ["tc", "┬"], ["tr", "┐"], ["ml", "├"], ["mc", "┼"],
  ["mr", "┤"], ["bl", "└"], ["bc", "┴"], ["br", "┘"]];
$("#labelPos").innerHTML = POSITIONS.map(([p, g]) =>
  '<button data-pos="' + p + '" title="' + p + '">' + g + "</button>").join("");
$$("#labelPos button").forEach(b => b.addEventListener("click", () => {
  C.labelPos = b.dataset.pos; sync(); draw(); persist();
}));

/* ============================================================== palettes */
let famFilter = "All";
$("#famSeg").innerHTML = ["All"].concat(PALETTE_FAMILIES)
  .map(f => '<button data-fam="' + f + '">' + f + "</button>").join("");
$$("#famSeg button").forEach(b => b.addEventListener("click", () => {
  famFilter = b.dataset.fam; drawPalettes();
}));
$("#palSearch").addEventListener("input", drawPalettes);

function rampCss(cols) {
  const ramp = makeRamp(cols.map((hex, i) => ({ pos: i / Math.max(1, cols.length - 1), hex })), C.space, "linear", 0.5);
  const out = [];
  for (let i = 0; i <= 10; i++) out.push(rgbToHex(ramp(i / 10)) + " " + i * 10 + "%");
  return "linear-gradient(90deg," + out.join(",") + ")";
}
function drawPalettes() {
  const q = $("#palSearch").value.trim().toLowerCase();
  $$("#famSeg button").forEach(b => b.classList.toggle("active", b.dataset.fam === famFilter));
  const list = PALETTES.filter(p =>
    (famFilter === "All" || p[1] === famFilter) &&
    (!q || p[0].toLowerCase().includes(q) || p[1].toLowerCase().includes(q)));
  const host = $("#palList");
  host.innerHTML = "";
  list.forEach(p => {
    const cols = paletteColours(p);
    const el = mk("div", "pal");
    el.innerHTML = '<div class="ramp" style="background:' + rampCss(cols) + '"></div>' +
      '<div class="nm"><span>' + p[0] + "</span><span>" + cols.length + "</span></div>";
    el.addEventListener("click", () => { applyPalette(cols); toast(p[0]); });
    host.append(el);
  });
  if (!list.length) host.innerHTML = '<div class="note">Nothing matches that.</div>';
}
function applyPalette(cols) {
  C.stops = cols.map((hex, i) => ({ pos: cols.length === 1 ? 0 : i / (cols.length - 1), hex }));
  sync(); draw(); persist();
}

/* ================================================================= stops */
function drawStops() {
  const host = $("#stops");
  host.innerHTML = "";
  C.stops.forEach((s, i) => {
    const row = mk("div", "stop");
    const col = mk("input"); col.type = "color"; col.value = s.hex;
    const code = mk("code", null, s.hex.toUpperCase());
    const pos = mk("input"); pos.type = "range"; pos.min = 0; pos.max = 1; pos.step = 0.01; pos.value = s.pos;
    const rm = mk("button", null, "&times;"); rm.title = "Remove";
    col.addEventListener("input", () => { s.hex = col.value; code.textContent = col.value.toUpperCase(); draw(); persist(); });
    pos.addEventListener("input", () => { s.pos = +pos.value; draw(); persist(); });
    rm.addEventListener("click", () => {
      if (C.stops.length <= 2) return toast("A ramp needs at least two stops");
      C.stops.splice(i, 1); sync(); draw(); persist();
    });
    row.append(col, code, pos, rm);
    host.append(row);
  });
  $("#rampPreview").style.background = rampCss(C.stops.map(s => s.hex));
}
$("#addStop").addEventListener("click", () => {
  const ramp = makeRamp(C.stops, C.space, C.easing, C.bias);
  C.stops.push({ pos: 0.5, hex: rgbToHex(ramp(0.5)) });
  C.stops.sort((a, b) => a.pos - b.pos);
  sync(); draw(); persist();
});
$("#spreadStops").addEventListener("click", () => {
  C.stops.sort((a, b) => a.pos - b.pos);
  C.stops.forEach((s, i) => { s.pos = C.stops.length === 1 ? 0 : i / (C.stops.length - 1); });
  sync(); draw(); persist();
});
$("#reverseStops").addEventListener("click", () => {
  const hexes = C.stops.map(s => s.hex).reverse();
  C.stops.forEach((s, i) => { s.hex = hexes[i]; });
  sync(); draw(); persist();
});
$("#shuffleStops").addEventListener("click", () => {
  const r = rng(C.seed + "|shuffle" + Math.random());
  const hexes = C.stops.map(s => s.hex);
  for (let i = hexes.length - 1; i > 0; i--) {
    const j = r.int(0, i);
    [hexes[i], hexes[j]] = [hexes[j], hexes[i]];
  }
  C.stops.forEach((s, i) => { s.hex = hexes[i]; });
  sync(); draw(); persist();
});

/* ================================================================ canvas */
const SIZES = [
  ["1080x1350", "1080 × 1350 (4:5 post)"], ["1080x1080", "1080 × 1080 (square)"],
  ["1080x1920", "1080 × 1920 (story)"], ["1920x1080", "1920 × 1080 (HD)"],
  ["2560x1440", "2560 × 1440 (desktop)"], ["3840x2160", "3840 × 2160 (4K)"],
  ["1200x630", "1200 × 630 (link card)"], ["1414x2000", "1414 × 2000 (A4 @150)"],
  ["2480x3508", "2480 × 3508 (A4 @300)"], ["custom", "Custom…"],
];
$("#sizePreset").innerHTML = SIZES.map(([v, l]) => '<option value="' + v + '">' + l + "</option>").join("");
$("#sizePreset").addEventListener("change", e => {
  if (e.target.value === "custom") return;
  const [w, h] = e.target.value.split("x").map(Number);
  C.w = w; C.h = h; sync(); draw(); persist();
});
$("#cw").addEventListener("change", e => { C.w = Math.max(16, +e.target.value | 0); sync(); draw(); persist(); });
$("#chh").addEventListener("change", e => { C.h = Math.max(16, +e.target.value | 0); sync(); draw(); persist(); });
$("#swapSize").addEventListener("click", () => { const t = C.w; C.w = C.h; C.h = t; sync(); draw(); persist(); });

/* ================================================================= label */
$("#label").addEventListener("input", e => { C.label = e.target.value; draw(); persist(); });
$("#hexList").addEventListener("change", e => { C.hexList = e.target.checked; draw(); persist(); });
$("#labelAuto").addEventListener("change", e => { C.labelAuto = e.target.checked; sync(); draw(); persist(); });
$("#labelColour").addEventListener("input", e => {
  C.labelColour = e.target.value; $("#labelColourHex").textContent = e.target.value; draw(); persist();
});

/* ============================================================ seed + rng */
const WORDS = ["kumo", "seihitsu", "dusk", "tide", "ember", "haze", "drift", "kiln", "mist",
  "ridge", "lantern", "harbour", "signal", "quartz", "vellum", "bloom", "static", "aurora"];
function newSeedString() {
  const r = Math.random();
  return WORDS[Math.floor(r * WORDS.length)] + "-" + Math.floor(Math.random() * 9000 + 1000);
}

// Everything the dice touch comes out of this, so a seed is a whole artwork.
function applySeed(seed) {
  const r = rng(seed);
  C.seed = seed;
  if (!locks.type) C.type = r.pick(TYPES);
  if (!locks.colours) {
    if (r.chance(0.55)) {
      const p = r.pick(PALETTES);
      applyPaletteSilent(paletteColours(p));
    } else {
      applyPaletteSilent(generatePalette(seed + "|pal", r.pick(HARMONIES), r.int(3, 6)));
    }
    C.space = r.chance(0.75) ? "oklab" : r.pick(SPACES);
    C.easing = r.pick(Object.keys(EASINGS));
    C.bias = +r.range(0.3, 0.7).toFixed(2);
  }
  C.angle = r.int(0, 359);
  C.cx = +r.range(0.2, 0.8).toFixed(2);
  C.cy = +r.range(0.2, 0.8).toFixed(2);
  C.radius = +r.range(0.6, 1.6).toFixed(2);
  C.inner = r.chance(0.3) ? +r.range(0, 0.5).toFixed(2) : 0;
  C.squash = r.chance(0.4) ? +r.range(0.3, 1.6).toFixed(2) : 1;
  C.horizon = +r.range(0.3, 0.7).toFixed(2);
  C.reflect = +r.range(0.4, 1.5).toFixed(2);
  C.deepen = +r.range(0.2, 0.8).toFixed(2);
  C.bands = r.int(3, 12);
  C.soft = +r.range(0, 0.8).toFixed(2);
  C.points = r.int(3, 8);
  C.spread = +r.range(0.5, 1.3).toFixed(2);
  C.falloff = +r.range(0.2, 0.8).toFixed(2);
  C.scale = +r.range(1, 5).toFixed(1);
  C.warp = +r.range(0.1, 1.4).toFixed(2);
  C.detail = r.int(2, 6);
  C.contrast = +r.range(0, 0.6).toFixed(2);
  if (!locks.finish) {
    C.grain = +r.range(0.04, 0.3).toFixed(2);
    C.grainSize = +r.range(1, 3).toFixed(1);
    C.grainColour = r.chance(0.2);
    C.vignette = r.chance(0.6) ? +r.range(0.05, 0.4).toFixed(2) : 0;
    C.posterize = r.chance(0.15) ? r.int(3, 12) : 0;
    C.smooth = r.chance(0.3) ? +r.range(0.5, 3).toFixed(1) : 0;
  }
  sync(); draw(); persist(); pushHistory();
}
function applyPaletteSilent(cols) {
  C.stops = cols.map((hex, i) => ({ pos: cols.length === 1 ? 0 : i / (cols.length - 1), hex }));
}
$("#randomBtn").addEventListener("click", () => applySeed(newSeedString()));
$("#newSeed").addEventListener("click", () => applySeed(newSeedString()));
$("#seed").addEventListener("change", e => { applySeed(e.target.value || newSeedString()); });
$$("#lockSeg button").forEach(b => b.addEventListener("click", () => {
  locks[b.dataset.lock] = !locks[b.dataset.lock];
  b.classList.toggle("active", locks[b.dataset.lock]);
}));

/* =============================================================== history */
const history = [];
function pushHistory() {
  const snap = JSON.parse(JSON.stringify(C));
  history.unshift(snap);
  if (history.length > 14) history.pop();
  const host = $("#history");
  host.innerHTML = "";
  history.forEach(cfg => {
    const c = document.createElement("canvas");
    const small = Object.assign({}, cfg, { label: "", hexList: false, grain: Math.min(cfg.grain, 0.1) });
    renderGradient(c, small, 108, 76);
    c.title = cfg.seed + " · " + TYPE_LABELS[cfg.type];
    c.addEventListener("click", () => {
      C = JSON.parse(JSON.stringify(cfg));
      sync(); draw(); persist(); toast(cfg.seed);
    });
    host.append(c);
  });
}

/* ================================================================ render */
const out = $("#out");
let drawT = null;
function stageFit() {
  const s = $("#stage").getBoundingClientRect();
  const maxW = Math.max(80, s.width - 28), maxH = Math.max(80, s.height - 28);
  const k = Math.min(maxW / C.w, maxH / C.h, 1);
  return { w: Math.max(2, Math.round(C.w * k)), h: Math.max(2, Math.round(C.h * k)) };
}
function draw(immediate) {
  clearTimeout(drawT);
  const run = () => {
    const fit = stageFit();
    // Render above display size and let the browser downsample. Grain is the
    // reason: a grain cell under one device pixel aliases into coarse noise,
    // so a 1:1 preview lies about what the export will look like.
    const ss = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const rw = Math.max(2, Math.min(C.w, Math.round(fit.w * ss)));
    const rh = Math.max(2, Math.round(rw * C.h / C.w));
    const t0 = performance.now();
    renderGradient(out, C, rw, rh);
    out.style.width = fit.w + "px"; out.style.height = fit.h + "px";
    $("#sizeNote").textContent = C.w + " × " + C.h + " px  ·  preview " + rw + " × " + rh +
      "  ·  " + (performance.now() - t0).toFixed(0) + " ms";
  };
  if (immediate) run(); else drawT = setTimeout(run, 16);
}
new ResizeObserver(() => draw()).observe($("#stage"));

function sync() {
  ALL.forEach(c => {
    const vis = !c.show_if || c.show_if();
    c.el.classList.toggle("hidden", !vis);
    if (vis) c.show();
  });
  $$("#typeSeg button").forEach(b => b.classList.toggle("active", b.dataset.type === C.type));
  $$("#labelPos button").forEach(b => b.classList.toggle("active", b.dataset.pos === C.labelPos));
  $("#space").value = C.space;
  $("#easing").value = C.easing;
  $("#seed").value = C.seed;
  $("#cw").value = C.w; $("#chh").value = C.h;
  const key = C.w + "x" + C.h;
  $("#sizePreset").value = SIZES.some(s => s[0] === key) ? key : "custom";
  $("#label").value = C.label;
  $("#hexList").checked = C.hexList;
  $("#labelAuto").checked = C.labelAuto;
  $("#labelColour").value = C.labelColour;
  $("#labelColourHex").textContent = C.labelColour;
  $("#labelColourCtl").classList.toggle("hidden", C.labelAuto);
  $("#exportNote").textContent = VECTOR_TYPES.includes(C.type)
    ? "SVG exports as real gradient stops."
    : "SVG is an approximation for " + TYPE_LABELS[C.type].toLowerCase() + ", PNG keeps exactly what you see.";
  drawStops();
}

/* ================================================================ export */
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fileName = ext => (C.seed || "gradient").replace(/[^a-z0-9-]+/gi, "-").toLowerCase() + "." + ext;

function exportRaster(scale, mime, quality) {
  const c = document.createElement("canvas");
  renderGradient(c, C, C.w * scale, C.h * scale);
  c.toBlob(b => {
    download(b, fileName(mime === "image/jpeg" ? "jpg" : "png"));
    toast((mime === "image/jpeg" ? "JPEG" : "PNG") + " " + c.width + "×" + c.height + " saved");
  }, mime, quality);
}
$("#png1").addEventListener("click", () => exportRaster(1, "image/png"));
$("#png2").addEventListener("click", () => exportRaster(2, "image/png"));
$("#jpg").addEventListener("click", () => exportRaster(1, "image/jpeg", 0.92));
$("#svg").addEventListener("click", () => {
  download(new Blob([svgGradient(C, C.w, C.h)], { type: "image/svg+xml" }), fileName("svg"));
  toast(VECTOR_TYPES.includes(C.type) ? "SVG saved" : "SVG saved, approximate for this type");
});
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(what + " copied"); }
  catch { toast("Clipboard blocked by the browser"); }
}
$("#copyCss").addEventListener("click", () => copy(cssGradient(C), "CSS"));
$("#copyHex").addEventListener("click", () => copy(C.stops.map(s => s.hex.toUpperCase()).join("\n"), "Hex codes"));
$("#savePreset").addEventListener("click", () => {
  download(new Blob([JSON.stringify({ tool: "studio-gradient", version: 1, config: C }, null, 2)],
    { type: "application/json" }), fileName("json"));
});
$("#loadPreset").addEventListener("click", () => $("#jsonInput").click());
$("#jsonInput").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const cfg = j.config || j;
    if (!cfg.stops) throw new Error("not a preset");
    C = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), cfg);
    sync(); draw(); persist(); toast("Preset loaded");
  } catch { toast("That isn't a gradient preset"); }
});

/* ============================================================== keyboard */
window.addEventListener("keydown", e => {
  if (e.target.closest("input, select, textarea")) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "r") { e.preventDefault(); applySeed(newSeedString()); }
  else if (k === "s") { e.preventDefault(); applySeed(newSeedString()); }
  else if (k === "e") { e.preventDefault(); exportRaster(1, "image/png"); }
  else if (k === "c") { e.preventDefault(); copy(cssGradient(C), "CSS"); }
});

/* ================================================================== boot */
drawPalettes();
sync();
draw(true);
pushHistory();
