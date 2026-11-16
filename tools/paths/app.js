/* Path View, draws outlines the way a type editor shows them: on-curve
 * points, off-curve points, and the handles between them.
 * Parsing lives in font.js (fonts) and paths.js (SVG + analysis). */
"use strict";

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ================================================================ chrome */
const NAV = [["/", "Tools"], ["/tools/layout/index.html", "Layout"],
  ["/tools/converter/index.html", "Converter"],
  ["/tools/animator/index.html", "Animator"], ["/tools/pixel/index.html", "Pixel"], ["/tools/gradient/index.html", "Gradient"],
  ["/tools/paths/index.html", "Paths"]];
$("#nav").innerHTML = NAV.map(([h, l]) =>
  '<a href="' + h + '"' + (l === "Paths" ? ' class="active"' : "") + ">" + l + "</a>")
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
  root.setAttribute("data-theme", n); store("vegar-tools-theme", n); paintTheme(); draw();
});
let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2300);
}
const note = (msg, err) => { const n = $("#srcNote"); n.textContent = msg || ""; n.classList.toggle("err", !!err); };

/* ================================================================ looks */
// Every number that sets a size is in px at a 1000 px wide frame, so the
// preview and an export of any width are the same picture at different scales.
// A look is colour, shape and weight. What is on the page, the text, its
// spacing, the frame and which guides are showing, belongs to the setting,
// so picking a look never switches a guide off and picking a setting never
// recolours anything.
const LOOK_KEYS = ["bg", "transparent", "fillOn", "fillColour", "fillOpacity", "outlineOn", "outlineColour",
  "outlineWidth", "handlesOn", "handleColour", "handleWidth", "handleDash", "onShape", "onSize", "onColour",
  "onStyle", "smoothShape", "offShape", "offSize", "offColour", "offStyle", "pointStroke",
  "impliedColour", "smoothDistinct", "smoothColour", "accent", "labelSize", "labelColour",
  "metricsColour", "guideColour", "gridColour"];
const SETTING_KEYS = ["text", "tracking", "kerning", "kernMarks", "lineHeight", "aspect", "pad", "pointScale", "pointsOn", "showImplied",
  "startOn", "dirOn", "dirCheckOn", "extremaOn", "numbersOn", "coordsOn",
  "metricsOn", "metricsLabels", "advanceOn", "bboxOn", "gridOn", "gridStep"];
const SETTING_DEFAULTS = {
  text: "a", tracking: 0, kerning: true, kernMarks: false, lineHeight: 1.25, aspect: "1:1", pad: 12, pointScale: 1, pointsOn: true, showImplied: false,
  startOn: false, dirOn: false, dirCheckOn: false, extremaOn: false, numbersOn: false, coordsOn: false,
  metricsOn: false, metricsLabels: true, advanceOn: false, bboxOn: false, gridOn: false, gridStep: 50,
};

const THEMES = {
  Specimen: { bg: "#e6e6e6", transparent: false, fillOn: false, fillColour: "#141414", fillOpacity: 1,
    outlineOn: true, outlineColour: "#141414", outlineWidth: 2, handlesOn: true, handleColour: "#141414",
    handleWidth: 1.6, handleDash: false, onShape: "square", onSize: 17, onColour: "#141414", onStyle: "fill",
    smoothShape: "same", offShape: "circle", offSize: 9, offColour: "#141414", offStyle: "fill", pointStroke: 1.6,
    impliedColour: "#8a8a8a", smoothDistinct: false, smoothColour: "#141414", accent: "#d9534f",
    labelSize: 11, labelColour: "#555555", metricsColour: "#9c9c9c", guideColour: "#9c9c9c", gridColour: "#d2d2d2" },
  Inverse: { bg: "#000000", fillOn: true, fillColour: "#ffffff", outlineOn: false, outlineColour: "#ffffff",
    handlesOn: true, handleColour: "#b8b8b8", handleWidth: 2, onShape: "square", onSize: 18, onColour: "#b8b8b8",
    offShape: "circle", offSize: 10, offColour: "#b8b8b8", labelColour: "#9a9a9a", metricsColour: "#4a4a4a",
    guideColour: "#4a4a4a", gridColour: "#1c1c1c" },
  Blueprint: { bg: "#0f2b55", fillOn: false, outlineOn: true, outlineColour: "#e6eefb", outlineWidth: 1.4,
    handleColour: "#7fa6dc", handleWidth: 1.1, onColour: "#ffffff", onShape: "square", onSize: 11,
    offColour: "#7fa6dc", offShape: "circle", offSize: 7, offStyle: "hollow",
    gridColour: "#1d3d6e", metricsColour: "#5f86c0", guideColour: "#5f86c0", labelColour: "#9fbbe3" },
  Editor: { bg: "#ffffff", fillOn: true, fillColour: "#ededf2", fillOpacity: 1, outlineOn: true,
    outlineColour: "#1d1d22", outlineWidth: 1.5, handleColour: "#a3a3ad", handleWidth: 1.1, onShape: "square",
    onSize: 12, onColour: "#2f6fe4", smoothShape: "circle", smoothDistinct: true, smoothColour: "#2fa85f",
    offShape: "circle", offSize: 7.5, offColour: "#8e8e98", offStyle: "fill", accent: "#2f6fe4",
    metricsColour: "#d0d0d8", guideColour: "#d0d0d8", labelColour: "#6b6b75" },
  Riso: { bg: "#f4efe3", fillOn: true, fillColour: "#ff48b0", fillOpacity: 0.9, outlineOn: true,
    outlineColour: "#1d3fbb", outlineWidth: 1.6, handleColour: "#1d3fbb", handleWidth: 1.3, onColour: "#1d3fbb",
    onShape: "diamond", onSize: 14, offColour: "#1d3fbb", offShape: "circle", offSize: 7, labelColour: "#1d3fbb",
    metricsColour: "#c7b9a0", guideColour: "#c7b9a0" },
  Night: { bg: "#111114", fillOn: false, outlineOn: true, outlineColour: "#f1f1f1", outlineWidth: 1.3,
    handleColour: "#5d5d66", handleWidth: 1, handleDash: true, onShape: "diamond", onSize: 12, onColour: "#f1f1f1",
    offShape: "circle", offSize: 6, offColour: "#8c8c96", offStyle: "hollow", labelColour: "#8c8c96",
    metricsColour: "#33333a", guideColour: "#33333a", gridColour: "#1b1b20", accent: "#e8a33c" },
};
const THEME_SWATCH = { Specimen: ["#e6e6e6", "#141414"], Inverse: ["#000", "#fff"], Blueprint: ["#0f2b55", "#e6eefb"],
  Editor: ["#ffffff", "#1d1d22"], Riso: ["#f4efe3", "#ff48b0"], Night: ["#111114", "#f1f1f1"] };

// Setting presets: what to study and how it sits in the frame. The strings
// are the usual type-design test strings, nothing borrowed.
const SETTINGS = [
  { name: "Single glyph", tip: "One letter, centred, nothing else", v: { text: "a" } },
  { name: "Construction", tip: "Point numbers, coordinates, start and direction, and the checks",
    v: { text: "a", pointScale: 0.85, numbersOn: true, coordsOn: true, startOn: true, dirOn: true,
         dirCheckOn: true, extremaOn: true } },
  { name: "Metrics", tip: "Baseline, x-height, caps, ascender, descender and advance widths",
    v: { text: "Hxgp", aspect: "16:9", pad: 10, pointScale: 0.5, metricsOn: true, advanceOn: true } },
  { name: "Grid study", tip: "A capital on a unit grid, with metrics",
    v: { text: "R", pointScale: 0.9, gridOn: true, gridStep: 50, metricsOn: true, metricsLabels: false } },
  { name: "Pair", tip: "Upper and lower case side by side", v: { text: "Aa", aspect: "4:5", pointScale: 0.75 } },
  { name: "Word", tip: "A spacing test word across a wide frame",
    v: { text: "Hamburgefonstiv", aspect: "16:9", pad: 7, pointScale: 0.32 } },
  { name: "Spacing", tip: "Control strings with advance widths, sidebearings at a glance",
    v: { text: "nnonoonnhnh\nHHOHOOHHIHI", aspect: "16:9", pad: 7, pointScale: 0.28, lineHeight: 1.1,
         advanceOn: true } },
  { name: "Kerning", tip: "Classic kerning pairs, with each adjustment measured underneath",
    v: { text: "AV Ta To Ty Wa\nLT Yo P. r, F.", aspect: "16:9", pad: 7, pointScale: 0.3, lineHeight: 1.3,
         kernMarks: true, advanceOn: true } },
  { name: "Lowercase", tip: "The lowercase alphabet in three rows",
    v: { text: "abcdefghi\njklmnopqr\nstuvwxyz", aspect: "1:1", pad: 6, pointScale: 0.3, lineHeight: 1.12 } },
  { name: "Uppercase", tip: "The capitals in three rows",
    v: { text: "ABCDEFGHI\nJKLMNOPQR\nSTUVWXYZ", aspect: "1:1", pad: 6, pointScale: 0.3, lineHeight: 1.05 } },
  { name: "Figures", tip: "Numerals in a row", v: { text: "0123456789", aspect: "16:9", pad: 7, pointScale: 0.36 } },
  { name: "Punctuation", tip: "The small marks that are easy to neglect",
    v: { text: "&?!@#%*()", aspect: "16:9", pad: 7, pointScale: 0.4 } },
  { name: "Poster", tip: "Two letters on a portrait poster, generous margin",
    v: { text: "Ag", aspect: "3:4", pad: 16, pointScale: 0.85 } },
  { name: "Story", tip: "One glyph on a 9:16 frame for a story or reel",
    v: { text: "g", aspect: "9:16", pad: 16, pointScale: 1.05 } },
  { name: "Outline only", tip: "Shape without points, for comparing silhouettes",
    v: { text: "a", pointsOn: false } },
];

const BASE = Object.assign({ src: "type", exportW: 2000 }, SETTING_DEFAULTS, THEMES.Specimen);

let S = JSON.parse(JSON.stringify(BASE));
try { Object.assign(S, JSON.parse(store("studio-paths") || "{}")); } catch {}
let activeTheme = store("studio-paths-theme") || "Specimen";
let activeSetting = store("studio-paths-setting") || "Single glyph";
let saveT;
function persist() { clearTimeout(saveT); saveT = setTimeout(() => store("studio-paths", JSON.stringify(S)), 250); }

function applyTheme(name) {
  const t = Object.assign({}, THEMES.Specimen, THEMES[name]);
  LOOK_KEYS.forEach(k => { if (k in t) S[k] = t[k]; });
  activeTheme = name; store("studio-paths-theme", name);
  syncUI(); draw(); persist();
}

// A setting preset starts from the defaults, so nothing lingers from the last one.
function applySetting(p) {
  SETTING_KEYS.forEach(k => { S[k] = SETTING_DEFAULTS[k]; });
  Object.assign(S, p.v);
  activeSetting = p.name; store("studio-paths-setting", p.name);
  if (S.src === "type" && !font) note("Load a font to see this setting's text; the logo stands in until then.");
  fitView(); syncUI(); draw(); persist();
}

/* ============================================================= controls */
function mk(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
const dec = step => { const s = String(step); return s.includes(".") ? s.split(".")[1].length : 0; };
const controls = [];

function changed(key) {
  if (LOOK_KEYS.includes(key) && activeTheme) { activeTheme = ""; store("studio-paths-theme", ""); }
  if (SETTING_KEYS.includes(key) && activeSetting) { activeSetting = ""; store("studio-paths-setting", ""); }
  syncUI(); draw(); persist();
}
function nameEl(key, label) {
  const n = mk("span", "name", label);
  n.title = "Double-click to reset";
  n.addEventListener("dblclick", () => { S[key] = BASE[key]; changed(key); });
  return n;
}
function R(key, label, min, max, step, o) {
  o = o || {};
  const el = mk("div", "ctl"), head = mk("div", "ctl-head"), val = mk("span", "val");
  head.append(nameEl(key, label), val);
  const inp = mk("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step;
  el.append(head, inp);
  const d = dec(step);
  inp.addEventListener("input", () => { S[key] = parseFloat(inp.value); changed(key); });
  return { el, show: o.show, sync() {
    inp.value = S[key];
    val.textContent = o.fmt ? o.fmt(S[key]) : Number(S[key]).toFixed(d) + (o.unit || "");
  } };
}
function Chk(key, label, o) {
  o = o || {};
  const el = mk("label", "chk"), sw = mk("span", "switch"), inp = mk("input");
  inp.type = "checkbox"; sw.append(inp, mk("b"));
  el.append(nameEl(key, label), sw);
  inp.addEventListener("change", () => { S[key] = inp.checked; changed(key); });
  return { el, show: o.show, sync() { inp.checked = !!S[key]; } };
}
function Col(key, label, o) {
  o = o || {};
  const el = mk("div", "colrow"), lab = mk("label"), code = mk("code"), inp = mk("input");
  inp.type = "color"; lab.append(code, inp);
  el.append(nameEl(key, label), lab);
  inp.addEventListener("input", () => { S[key] = inp.value; changed(key); });
  return { el, show: o.show, sync() { inp.value = S[key]; code.textContent = S[key]; } };
}
function Seg(key, options, o) {
  o = o || {};
  const el = mk("div", "seg");
  const btns = options.map(([v, l]) => {
    const b = mk("button", null, l);
    b.addEventListener("click", () => { S[key] = v; changed(key); });
    el.append(b); return [v, b];
  });
  return { el, show: o.show, sync() { btns.forEach(([v, b]) => b.classList.toggle("active", S[key] === v)); } };
}
function Sel(key, label, options, o) {
  o = o || {};
  const el = mk("div", "ctl");
  el.append(mk("div", "ctl-head", '<span class="name">' + label + "</span>"));
  const sel = mk("select");
  options.forEach(([v, l]) => { const op = mk("option", null, l); op.value = v; sel.append(op); });
  el.append(sel);
  sel.addEventListener("change", () => { S[key] = o.num ? +sel.value : sel.value; changed(key); });
  return { el, show: o.show, sync() { sel.value = String(S[key]); } };
}

function section(host, title, open, items, show) {
  const d = mk("details", "sec");
  const saved = JSON.parse(store("studio-paths-open") || "{}");
  d.open = title in saved ? saved[title] : open;
  d.append(mk("summary", null, title));
  const body = mk("div", "sec-body");
  items.forEach(it => { body.append(it.el); controls.push(it); });
  d.append(body);
  d.addEventListener("toggle", () => {
    const s = JSON.parse(store("studio-paths-open") || "{}");
    s[title] = d.open; store("studio-paths-open", JSON.stringify(s));
  });
  if (show) controls.push({ el: d, show, sync() {} });
  host.append(d);
}

const SHAPES = [["square", "Square"], ["circle", "Circle"], ["diamond", "Diamond"], ["cross", "Cross"]];
const px = v => Number(v).toFixed(1) + " px";
const isType = () => S.src === "type";

/* left: layout and frame */
const leftHost = $("#left");
section(leftHost, "Setting", true, [
  R("tracking", "Tracking", -200, 600, 5, { fmt: v => v + " ‰", show: isType }),
  Chk("kerning", "Kerning", { show: isType }),
  Chk("kernMarks", "Show kerning values", { show: () => isType() && S.kerning }),
  R("lineHeight", "Line height", 0.6, 3, 0.05, { fmt: v => Number(v).toFixed(2) + "×", show: isType }),
  R("pointScale", "Point scale", 0.1, 2.5, 0.01, { fmt: v => Number(v).toFixed(2) + "×" }),
  Chk("pointsOn", "Show points and handles"),
]);
section(leftHost, "Frame", true, [
  Sel("aspect", "Shape", [["fit", "Fit the artwork"], ["1:1", "Square 1:1"], ["4:5", "Portrait 4:5"],
    ["3:4", "Portrait 3:4"], ["9:16", "Tall 9:16"], ["16:9", "Wide 16:9"], ["3:2", "Landscape 3:2"]]),
  R("pad", "Padding", 0, 40, 0.5, { fmt: v => Number(v).toFixed(1) + "%" }),
  R("exportW", "Export width", 400, 8000, 50, { fmt: v => v + " px" }),
]);

/* right: the look */
const rightHost = $("#right");
const exportHead = rightHost.querySelector(".sep-line:last-of-type");
const rightSections = mk("div");
rightSections.style.cssText = "display:flex;flex-direction:column;gap:12px";
rightHost.insertBefore(rightSections, rightHost.children[2]);

section(rightSections, "Background", true, [
  Col("bg", "Colour", { show: () => !S.transparent }),
  Chk("transparent", "Transparent export"),
]);
section(rightSections, "Fill", false, [
  Chk("fillOn", "Fill the shape"),
  Col("fillColour", "Colour", { show: () => S.fillOn }),
  R("fillOpacity", "Opacity", 0.05, 1, 0.01, { show: () => S.fillOn }),
]);
section(rightSections, "Outline", false, [
  Chk("outlineOn", "Draw the outline"),
  Col("outlineColour", "Colour", { show: () => S.outlineOn }),
  R("outlineWidth", "Weight", 0.25, 8, 0.05, { fmt: px, show: () => S.outlineOn }),
]);
section(rightSections, "Handles", true, [
  Chk("handlesOn", "Draw handles"),
  Col("handleColour", "Colour", { show: () => S.handlesOn }),
  R("handleWidth", "Weight", 0.25, 6, 0.05, { fmt: px, show: () => S.handlesOn }),
  Chk("handleDash", "Dashed", { show: () => S.handlesOn }),
]);
section(rightSections, "On-curve points", true, [
  Seg("onShape", SHAPES),
  R("onSize", "Size", 0, 40, 0.5, { fmt: px }),
  Col("onColour", "Colour"),
  Seg("onStyle", [["fill", "Solid"], ["hollow", "Hollow"]]),
  Sel("smoothShape", "Smooth points", [["same", "Same as corners"], ["circle", "Circles"],
    ["diamond", "Diamonds"], ["square", "Squares"]]),
  Chk("smoothDistinct", "Colour smooth points differently"),
  Col("smoothColour", "Smooth colour", { show: () => S.smoothDistinct }),
]);
section(rightSections, "Off-curve points", true, [
  Seg("offShape", SHAPES),
  R("offSize", "Size", 0, 30, 0.5, { fmt: px }),
  Col("offColour", "Colour"),
  Seg("offStyle", [["fill", "Solid"], ["hollow", "Hollow"]]),
  R("pointStroke", "Hollow stroke", 0.25, 5, 0.05, { fmt: px }),
  Chk("showImplied", "Show implied TrueType points"),
  Col("impliedColour", "Implied colour", { show: () => S.showImplied }),
]);
section(rightSections, "Annotations", false, [
  Chk("startOn", "Start point triangle"),
  Chk("dirOn", "Direction arrows"),
  Chk("dirCheckOn", "Flag reversed contours"),
  Chk("extremaOn", "Flag missing extrema"),
  Col("accent", "Marker colour", { show: () => S.startOn || S.dirOn || S.extremaOn || S.dirCheckOn }),
  Chk("numbersOn", "Point numbers"),
  Chk("coordsOn", "Coordinates"),
  R("labelSize", "Label size", 5, 28, 0.5, { fmt: px, show: () => S.numbersOn || S.coordsOn || S.metricsLabels }),
  Col("labelColour", "Label colour", { show: () => S.numbersOn || S.coordsOn || S.metricsLabels }),
]);
section(rightSections, "Guides", false, [
  Chk("metricsOn", "Vertical metrics", { show: isType }),
  Chk("metricsLabels", "Label the metrics", { show: () => isType() && S.metricsOn }),
  Col("metricsColour", "Metrics colour", { show: () => isType() && S.metricsOn }),
  Chk("advanceOn", "Advance widths", { show: isType }),
  Chk("bboxOn", "Bounding boxes"),
  Col("guideColour", "Box colour", { show: () => S.bboxOn || S.advanceOn }),
  Chk("gridOn", "Grid"),
  R("gridStep", "Grid step", 5, 250, 5, { fmt: v => v + " units", show: () => S.gridOn }),
  Col("gridColour", "Grid colour", { show: () => S.gridOn }),
]);
void exportHead;

$("#themes").innerHTML = Object.keys(THEMES).map(n =>
  '<button class="theme" data-theme="' + n + '"><i style="background:linear-gradient(135deg,' +
  THEME_SWATCH[n][0] + " 50%," + THEME_SWATCH[n][1] + ' 50%)"></i>' + n + "</button>").join("");
$$("#themes .theme").forEach(b => b.addEventListener("click", () => applyTheme(b.dataset.theme)));

$("#settingList").innerHTML = SETTINGS.map((p, i) =>
  '<button class="theme" data-setting="' + esc(p.name) + '" data-i="' + i + '" title="' + esc(p.tip) + '">' +
  esc(p.name) + "</button>").join("");
$$("#settingList .theme").forEach(b => b.addEventListener("click", () => applySetting(SETTINGS[+b.dataset.i])));

const USER_KEY = "studio-paths-user-settings";
const userSettings = () => { try { return JSON.parse(store(USER_KEY) || "[]"); } catch { return []; } };
function drawUserSettings() {
  const list = userSettings();
  $("#userSettings").innerHTML = list.map((p, i) =>
    '<button class="theme" data-setting="' + esc(p.name) + '" data-u="' + i + '" title="Your saved setting">' +
    esc(p.name) + '<span class="x" data-del="' + i + '" title="Delete">&times;</span></button>').join("");
  $$("#userSettings .theme").forEach(b => b.addEventListener("click", e => {
    const del = e.target.closest(".x");
    const items = userSettings();
    if (del) {
      items.splice(+del.dataset.del, 1);
      store(USER_KEY, JSON.stringify(items));
      drawUserSettings(); syncUI();
      return;
    }
    applySetting(items[+b.dataset.u]);
  }));
}
$("#savePreset").addEventListener("click", () => {
  const name = $("#presetName").value.trim();
  if (!name) return toast("Give the setting a name first");
  const v = {};
  SETTING_KEYS.forEach(k => { v[k] = S[k]; });
  const items = userSettings().filter(p => p.name !== name);
  items.push({ name, v });
  store(USER_KEY, JSON.stringify(items));
  $("#presetName").value = "";
  activeSetting = name; store("studio-paths-setting", name);
  drawUserSettings(); syncUI();
  toast("Saved “" + name + "”");
});
$("#presetName").addEventListener("keydown", e => { if (e.key === "Enter") $("#savePreset").click(); });

// A random character the font actually draws, skipping spaces, controls and
// anything that maps to an empty glyph.
function randomGlyph() {
  if (!font) return toast("Load a font first");
  const codes = Array.from(font.cmap.keys()).filter(c => c > 32 && !(c >= 0x7f && c < 0xa0) && !(c >= 0x300 && c < 0x370));
  for (let tries = 0; tries < 60 && codes.length; tries++) {
    const c = codes[Math.floor(Math.random() * codes.length)];
    const g = font.glyphByIndex(font.cmap.get(c));
    if (g.contours && g.contours.length) {
      S.text = String.fromCodePoint(c);
      $("#text").value = S.text;
      fitView(); draw(); persist();
      toast("U+" + c.toString(16).toUpperCase().padStart(4, "0") + "  " + S.text);
      return;
    }
  }
  toast("Couldn't find a drawn glyph in this font");
}
$("#randomGlyph").addEventListener("click", randomGlyph);

function syncUI() {
  controls.forEach(c => {
    const vis = !c.show || c.show();
    c.el.classList.toggle("hidden", !vis);
    if (vis) c.sync();
  });
  $$("#themes .theme").forEach(b => b.classList.toggle("active", b.dataset.theme === activeTheme));
  $$("#settingList .theme, #userSettings .theme").forEach(b =>
    b.classList.toggle("active", b.dataset.setting === activeSetting));
  $$("#srcSeg button").forEach(b => b.classList.toggle("active", b.dataset.src === S.src));
  $("#typeBox").classList.toggle("hidden", S.src !== "type");
  $("#svgBox").classList.toggle("hidden", S.src !== "svg");
  if (document.activeElement !== $("#text")) $("#text").value = S.text;
}

/* =============================================================== sources */
let font = null, fontLabel = "";
let svgArt = null, svgLabel = "";

// The preview before a font or SVG is loaded: the vegarem.no logo
// (Graphic Design/ny logo.svg). Run through the same importer as a dropped
// SVG, so the rect's rounded corners and the circle show their real points.
const DEMO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 841.89 595.28">' +
  '<path d="M296.51,161.83H94.39c-18.6,0-30.87,19.35-22.94,36.17l101.06,214.39c9.14,19.39,36.73,19.39,45.87,0l101.07-214.39c7.93-16.82-4.34-36.17-22.94-36.17Z"/>' +
  '<path d="M474.87,161.95h-96.99v.02c-9.29-.12-18.62,4.72-23.25,14.52l-101.08,214.27c-7.94,16.82,4.33,36.18,22.93,36.18h202.14c13.89,0,24.24-10.8,25.29-23.27.47-2.1.74-4.28.74-6.52v-205.4h0c0-16.46-13.34-29.79-29.79-29.79Z"/>' +
  '<rect x="527.19" y="162.16" width="252.94" height="264.98" rx="29.79" ry="29.79"/>' +
  '<circle cx="102.19" cy="393.74" r="33.19"/>' +
  '</svg>';
let demoContours = null;
const demoGlyphs = () => {
  if (!demoContours) demoContours = parseSVG(DEMO_SVG).contours;
  return [{ contours: demoContours, x: 0, ch: "", advance: 0, y: 0 }];
};

function currentArt() {
  if (S.src === "type") {
    if (!font) return { demo: true, glyphs: demoGlyphs() };
    const lines = String(S.text || "").split("\n");
    const upm = font.unitsPerEm;
    const glyphs = [];
    let kernPairs = 0;
    lines.forEach((line, li) => {
      const lay = font.layout(line, S.tracking, S.kerning);
      kernPairs += lay.kernPairs;
      const y = li * upm * S.lineHeight;
      lay.glyphs.forEach(g => {
        // font units are y-up; flip into screen space here, once
        const flipped = g.contours.map(c => ({
          start: [c.start[0] + g.x, -c.start[1] + y], closed: true, startImplied: c.startImplied,
          segs: c.segs.map(s => {
            const o = { type: s.type, to: [s.to[0] + g.x, -s.to[1] + y], implied: s.implied };
            if (s.c) o.c = [s.c[0] + g.x, -s.c[1] + y];
            if (s.c1) { o.c1 = [s.c1[0] + g.x, -s.c1[1] + y]; o.c2 = [s.c2[0] + g.x, -s.c2[1] + y]; }
            return o;
          }),
        }));
        glyphs.push({ contours: flipped, x: g.x, y, ch: g.ch, advance: g.advance, gid: g.gid, kern: g.kern });
      });
    });
    return { glyphs, lines: lines.length, kernPairs };
  }
  if (!svgArt) return { demo: true, glyphs: demoGlyphs() };
  return { glyphs: [{ contours: svgArt.contours, x: 0, y: 0, ch: "", advance: 0 }] };
}

async function loadFontBytes(bytes, label, opts) {
  try {
    const inflate = window.pako ? (d => window.pako.inflate(d)) : null;
    font = new Font(bytes, inflate, opts);
    fontLabel = label;
    S.src = "type";
    $("#fontChip").innerHTML = '<div class="file-chip"><span class="nm">' + esc(font.name) + '</span>' +
      '<span class="k">' + (font.cff ? "cubic" : "quadratic") + " · " + font.unitsPerEm + " upm · " +
      (font.kernSource ? "kerned" : "no kerning") + "</span></div>";
    note(font.faces && font.faces.length > 1 ? "Collection of " + font.faces.length + " faces." : "");
    fitView(); syncUI(); draw(); persist();
    toast(font.name);
  } catch (e) {
    note(e.message || "Could not read that font", true);
  }
}

$("#fontBtn").addEventListener("click", () => $("#fontInput").click());
$("#fontInput").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (f) loadFontBytes(new Uint8Array(await f.arrayBuffer()), f.name);
});

// Installed fonts, through the browser's Local Font Access API (Chrome and
// Edge). It asks permission once and hands over the font file itself.
let localFonts = [];
$("#localBtn").addEventListener("click", async () => {
  if (!window.queryLocalFonts) {
    note("Your browser can't list installed fonts, Chrome and Edge can. Use Load font file instead.", true);
    return;
  }
  try {
    localFonts = await window.queryLocalFonts();
    if (!localFonts.length) { note("No installed fonts were shared.", true); return; }
    const sel = $("#localList");
    sel.innerHTML = '<option value="">Choose an installed font…</option>' +
      localFonts.map((f, i) => '<option value="' + i + '">' + esc(f.fullName) + "</option>").join("");
    sel.classList.remove("hidden");
    note(localFonts.length + " installed fonts.");
  } catch (e) {
    note("Permission to read installed fonts was not given.", true);
  }
});
$("#localList").addEventListener("change", async e => {
  const f = localFonts[+e.target.value];
  if (!f) return;
  const blob = await f.blob();
  loadFontBytes(new Uint8Array(await blob.arrayBuffer()), f.fullName, { postscriptName: f.postscriptName });
});

// The text is content, not part of a preset's mode: typing your own letters
// inside "Construction" keeps it Construction.
$("#text").addEventListener("input", e => { S.text = e.target.value; draw(); persist(); });

function loadSVGText(text, label) {
  try {
    svgArt = parseSVG(text);
    svgLabel = label;
    S.src = "svg";
    $("#svgChip").innerHTML = '<div class="file-chip"><span class="nm">' + esc(label) + '</span><span class="k">' +
      svgArt.contours.length + " contours</span></div>";
    note("");
    fitView(); syncUI(); draw(); persist();
  } catch (e) { note(e.message, true); }
}
$("#svgBtn").addEventListener("click", () => $("#svgInput").click());
$("#svgInput").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (f) loadSVGText(await f.text(), f.name);
});
$("#pasteBtn").addEventListener("click", () => {
  const d = $("#pathData").value.trim();
  if (!d) return note("Paste some path data first.", true);
  const text = /<svg/i.test(d) ? d : '<svg xmlns="http://www.w3.org/2000/svg"><path d="' + esc(d) + '"/></svg>';
  loadSVGText(text, "pasted path");
});
$$("#srcSeg button").forEach(b => b.addEventListener("click", () => {
  S.src = b.dataset.src; fitView(); syncUI(); draw(); persist();
}));

/* drag and drop: a font or an SVG, anywhere */
let dragN = 0;
window.addEventListener("dragenter", e => { e.preventDefault(); dragN++; $("#stage").classList.add("drop"); });
window.addEventListener("dragleave", () => { if (--dragN <= 0) { dragN = 0; $("#stage").classList.remove("drop"); } });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", async e => {
  e.preventDefault(); dragN = 0; $("#stage").classList.remove("drop");
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (/\.svg$/i.test(f.name) || f.type.includes("svg")) loadSVGText(await f.text(), f.name);
  else if (/\.(ttf|otf|woff|ttc)$/i.test(f.name)) loadFontBytes(new Uint8Array(await f.arrayBuffer()), f.name);
  else toast("Drop a font (.ttf .otf .woff) or an .svg");
});

/* ============================================================ painters */
// One scene, two painters: the canvas you look at and the SVG you export are
// drawn by the same code, so they cannot drift apart.
class CanvasPainter {
  constructor(ctx) { this.x = ctx; }
  begin(ops) {
    const x = this.x; x.beginPath();
    for (let i = 0; i < ops.length;) {
      const o = ops[i++];
      if (o === "M") x.moveTo(ops[i++], ops[i++]);
      else if (o === "L") x.lineTo(ops[i++], ops[i++]);
      else if (o === "Q") x.quadraticCurveTo(ops[i++], ops[i++], ops[i++], ops[i++]);
      else if (o === "C") x.bezierCurveTo(ops[i++], ops[i++], ops[i++], ops[i++], ops[i++], ops[i++]);
      else if (o === "Z") x.closePath();
    }
  }
  path(ops, st) {
    const x = this.x;
    this.begin(ops);
    x.save();
    if (st.opacity != null) x.globalAlpha = st.opacity;
    if (st.fill) { x.fillStyle = st.fill; x.fill(st.rule || "nonzero"); }
    if (st.stroke) {
      x.strokeStyle = st.stroke; x.lineWidth = st.width || 1;
      x.lineJoin = "round"; x.lineCap = "round";
      x.setLineDash(st.dash ? st.dash : []);
      x.stroke();
    }
    x.restore();
  }
  rect(x0, y0, w, h, st) { this.path(["M", x0, y0, "L", x0 + w, y0, "L", x0 + w, y0 + h, "L", x0, y0 + h, "Z"], st); }
  circle(cx, cy, r, st) {
    const x = this.x;
    if (!(r > 0)) return;
    x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2);
    if (st.fill) { x.fillStyle = st.fill; x.fill(); }
    if (st.stroke) { x.strokeStyle = st.stroke; x.lineWidth = st.width || 1; x.stroke(); }
    x.restore();
  }
  text(tx, ty, s, st) {
    const x = this.x;
    x.save();
    x.font = (st.weight || 400) + " " + st.size + 'px ui-monospace, "SF Mono", Menlo, monospace';
    x.fillStyle = st.fill; x.textAlign = st.anchor || "left"; x.textBaseline = st.baseline || "alphabetic";
    x.fillText(s, tx, ty);
    x.restore();
  }
  background(w, h, colour) { if (colour) { this.x.fillStyle = colour; this.x.fillRect(0, 0, w, h); } }
}

const f2 = v => (Math.round(v * 100) / 100).toString();
class SvgPainter {
  constructor(w, h) { this.w = w; this.h = h; this.out = []; }
  d(ops) {
    let s = "";
    for (let i = 0; i < ops.length;) {
      const o = ops[i++];
      if (o === "M" || o === "L") s += o + f2(ops[i++]) + " " + f2(ops[i++]);
      else if (o === "Q") s += "Q" + [0, 1, 2, 3].map(() => f2(ops[i++])).join(" ");
      else if (o === "C") s += "C" + [0, 1, 2, 3, 4, 5].map(() => f2(ops[i++])).join(" ");
      else if (o === "Z") s += "Z";
    }
    return s;
  }
  style(st) {
    let a = ' fill="' + (st.fill || "none") + '"';
    if (st.rule) a += ' fill-rule="' + st.rule + '"';
    if (st.stroke) {
      a += ' stroke="' + st.stroke + '" stroke-width="' + f2(st.width || 1) + '" stroke-linejoin="round" stroke-linecap="round"';
      if (st.dash) a += ' stroke-dasharray="' + st.dash.map(f2).join(" ") + '"';
    }
    if (st.opacity != null && st.opacity < 1) a += ' opacity="' + f2(st.opacity) + '"';
    return a;
  }
  path(ops, st) { this.out.push('<path d="' + this.d(ops) + '"' + this.style(st) + "/>"); }
  rect(x, y, w, h, st) { this.out.push('<rect x="' + f2(x) + '" y="' + f2(y) + '" width="' + f2(w) + '" height="' + f2(h) + '"' + this.style(st) + "/>"); }
  circle(cx, cy, r, st) { if (!(r > 0)) return; this.out.push('<circle cx="' + f2(cx) + '" cy="' + f2(cy) + '" r="' + f2(r) + '"' + this.style(st) + "/>"); }
  text(x, y, s, st) {
    const anchor = st.anchor === "center" ? "middle" : st.anchor === "right" ? "end" : "start";
    this.out.push('<text x="' + f2(x) + '" y="' + f2(y) + '" font-family="ui-monospace, SF Mono, Menlo, monospace" font-size="' +
      f2(st.size) + '" fill="' + st.fill + '" text-anchor="' + anchor + '">' + esc(s) + "</text>");
  }
  background(w, h, colour) { if (colour) this.out.push('<rect width="' + w + '" height="' + h + '" fill="' + colour + '"/>'); }
  toString() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + this.w + '" height="' + this.h +
      '" viewBox="0 0 ' + this.w + " " + this.h + '">\n' + this.out.join("\n") + "\n</svg>";
  }
}

/* ================================================================ scene */
function artBounds(art) {
  const all = [];
  art.glyphs.forEach(g => g.contours.forEach(c => all.push(c)));
  const b = contourBounds(all);
  // the metric lines and advance boxes are part of the picture when shown
  if (S.src === "type" && font && !art.demo && (S.metricsOn || S.advanceOn)) {
    const asc = font.ascender || font.unitsPerEm * 0.8, desc = font.descender || -font.unitsPerEm * 0.2;
    const lines = art.lines || 1;
    const lastY = (lines - 1) * font.unitsPerEm * S.lineHeight;
    let minX = Math.min(b.minX, 0), maxX = b.maxX;
    art.glyphs.forEach(g => { maxX = Math.max(maxX, g.x + g.advance); });
    const minY = Math.min(b.minY, -asc), maxY = Math.max(b.maxY, lastY - desc);
    return { minX, minY, maxX, maxY, x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return b;
}

// How strict the checks are, and which way contours should run. Font units
// are whole numbers, so half a unit is rounding; an SVG has no fixed unit, so
// the tolerance scales with the drawing. Glyphs and PostScript wind outer
// contours counter-clockwise; TrueType winds them the other way.
function analysisOpts(art) {
  if (S.src === "type" && font && !art.demo) return { tol: 0.5, convention: font.cff ? "ps" : "tt" };
  const all = [];
  art.glyphs.forEach(g => g.contours.forEach(c => all.push(c)));
  const b = contourBounds(all);
  return { tol: Math.max(b.w, b.h) * 0.0005, convention: "ps" };
}

// Direction is judged within each glyph. Neighbouring letters can touch, // serifs meet, and no kerning is applied, and a test point landing in the next
// letter would otherwise count as a nested counter and flag a correct contour.
function glyphDirections(art, convention) {
  const out = [];
  art.glyphs.forEach(g => contourDirections(g.contours, convention).forEach(d => out.push(d)));
  return out;
}

function frameSize(availW, availH, b) {
  let ratio;
  if (S.aspect === "fit") {
    const p = S.pad / 100;
    ratio = (b.w * (1 + 2 * p) || 1) / (b.h * (1 + 2 * p) || 1);
  } else {
    const [a, c] = S.aspect.split(":").map(Number);
    ratio = a / c;
  }
  let w = availW, h = availW / ratio;
  if (h > availH) { h = availH; w = availH * ratio; }
  return { w, h, ratio };
}

// Draws everything into `P` for a frame of size W×H. `view` adds zoom and pan
// on top of the fitted framing, the export always uses the plain fit.
function paintScene(P, W, H, art, view, opts) {
  opts = opts || {};
  const b = artBounds(art);
  const pad = Math.min(W, H) * S.pad / 100;
  const fit = Math.min((W - pad * 2) / Math.max(b.w, 1e-6), (H - pad * 2) / Math.max(b.h, 1e-6));
  const z = view ? view.zoom : 1;
  const s = fit * z;
  const ox = W / 2 - (b.minX + b.w / 2) * s + (view ? view.px : 0);
  const oy = H / 2 - (b.minY + b.h / 2) * s + (view ? view.py : 0);
  const X = x => ox + x * s, Y = y => oy + y * s;
  const k = W / 1000 * (S.pointScale || 1);             // size unit; point scale shrinks it for dense text
  const hits = [];

  if (!opts.transparent) P.background(W, H, S.bg);

  /* grid, in source units so it lines up with the outline */
  if (S.gridOn && S.gridStep > 0) {
    const step = S.gridStep;
    const x0 = Math.floor((-ox / s) / step) * step, x1 = (W - ox) / s;
    const y0 = Math.floor((-oy / s) / step) * step, y1 = (H - oy) / s;
    if ((x1 - x0) / step < 600 && (y1 - y0) / step < 600) {
      const ops = [];
      for (let gx = x0; gx <= x1; gx += step) ops.push("M", X(gx), 0, "L", X(gx), H);
      for (let gy = y0; gy <= y1; gy += step) ops.push("M", 0, Y(gy), "L", W, Y(gy));
      P.path(ops, { stroke: S.gridColour, width: Math.max(0.5, 0.8 * k) });
    }
  }

  /* metrics */
  if (S.src === "type" && font && !art.demo) {
    const lines = art.lines || 1;
    const minX = Math.min(b.minX, 0) - 40, maxX = b.maxX + 40;
    const upm = font.unitsPerEm;
    for (let li = 0; li < lines && S.metricsOn; li++) {
      const base = li * upm * S.lineHeight;
      const rows = [["baseline", 0], ["x-height", font.xHeight], ["cap height", font.capHeight],
        ["ascender", font.ascender], ["descender", font.descender]].filter(r => r[1] != null && (r[1] || r[0] === "baseline"));
      for (const [label, v] of rows) {
        const yy = Y(base - v);
        P.path(["M", X(minX) - 10 * k, yy, "L", X(maxX) + 10 * k, yy],
          { stroke: S.metricsColour, width: Math.max(0.5, (label === "baseline" ? 1.4 : 0.9) * k),
            dash: label === "baseline" ? null : [6 * k, 5 * k] });
        if (S.metricsLabels)
          P.text(X(maxX) + 14 * k, yy + S.labelSize * k * 0.35, label + " " + v,
            { size: S.labelSize * k, fill: S.labelColour });
      }
    }
    if (S.advanceOn) {
      art.glyphs.forEach(g => {
        const top = g.y - (font.ascender || upm * 0.8), bot = g.y - (font.descender || -upm * 0.2);
        P.rect(X(g.x), Y(top), g.advance * s, (bot - top) * s,
          { stroke: S.guideColour, width: Math.max(0.5, 0.9 * k), dash: [3 * k, 4 * k] });
      });
    }
  }

  /* kerning: where each kerned glyph would have sat, and how far it moved */
  if (S.kernMarks && S.kerning && S.src === "type" && font && !art.demo) {
    const fs = S.labelSize * k;
    const drop = font.unitsPerEm * 0.06;
    art.glyphs.forEach(g => {
      if (!g.kern) return;
      const x0 = X(g.x - g.kern), x1 = X(g.x), yy = Y(g.y + drop);
      const t = 5 * k;
      P.path(["M", x0, yy - t, "L", x0, yy + t, "M", x0, yy, "L", x1, yy, "M", x1, yy - t, "L", x1, yy + t],
        { stroke: S.accent, width: Math.max(1, 1.4 * k) });
      P.text((x0 + x1) / 2, yy + fs * 1.5, (g.kern > 0 ? "+" : "") + Math.round(g.kern),
        { size: fs, fill: S.accent, anchor: "center" });
    });
  }

  /* bounding boxes */
  if (S.bboxOn) {
    art.glyphs.forEach(g => {
      if (!g.contours.length) return;
      const gb = contourBounds(g.contours);
      P.rect(X(gb.minX), Y(gb.minY), gb.w * s, gb.h * s, { stroke: S.guideColour, width: Math.max(0.5, 1 * k) });
    });
  }

  /* the outline itself */
  const ops = [];
  art.glyphs.forEach(g => g.contours.forEach(c => {
    ops.push("M", X(c.start[0]), Y(c.start[1]));
    c.segs.forEach(sg => {
      if (sg.type === "line") ops.push("L", X(sg.to[0]), Y(sg.to[1]));
      else if (sg.type === "quad") ops.push("Q", X(sg.c[0]), Y(sg.c[1]), X(sg.to[0]), Y(sg.to[1]));
      else ops.push("C", X(sg.c1[0]), Y(sg.c1[1]), X(sg.c2[0]), Y(sg.c2[1]), X(sg.to[0]), Y(sg.to[1]));
    });
    if (c.closed) ops.push("Z");
  }));
  if (S.fillOn) P.path(ops, { fill: S.fillColour, opacity: S.fillOpacity, rule: S.src === "svg" ? "evenodd" : "nonzero" });
  if (S.outlineOn) P.path(ops, { stroke: S.outlineColour, width: S.outlineWidth * k });

  /* handles, then points on top of them */
  const conv = analysisOpts(art);
  const allC = [];
  art.glyphs.forEach(g => g.contours.forEach(c => allC.push(c)));
  const dirs = S.dirCheckOn ? glyphDirections(art, conv.convention) : null;
  const handleSt = { stroke: S.handleColour, width: S.handleWidth * k, dash: S.handleDash ? [4 * k, 3 * k] : null };
  const offPts = [], onPts = [], labels = [];
  const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
  let ci = 0;
  art.glyphs.forEach(g => {
    let num = 0;                                       // numbering restarts per glyph, as in an editor
    g.contours.forEach(c => {
      const nodes = contourNodes(c);
      const handleOps = [];
      // Each segment's handles. A handle retracted onto its own node isn't
      // drawn. With implied points hidden, a run of TrueType off-curve points is
      // joined control to control, the way a type editor shows it.
      let from = c.start, fromImplied = !!c.startImplied;
      c.segs.forEach(sg => {
        if (sg.type === "cubic") {
          if (!same(from, sg.c1)) handleOps.push("M", X(from[0]), Y(from[1]), "L", X(sg.c1[0]), Y(sg.c1[1]));
          if (!same(sg.to, sg.c2)) handleOps.push("M", X(sg.to[0]), Y(sg.to[1]), "L", X(sg.c2[0]), Y(sg.c2[1]));
          if (!same(from, sg.c1)) offPts.push({ x: sg.c1[0], y: sg.c1[1] });
          if (!same(sg.to, sg.c2)) offPts.push({ x: sg.c2[0], y: sg.c2[1] });
        } else if (sg.type === "quad") {
          if (S.showImplied || !fromImplied) handleOps.push("M", X(from[0]), Y(from[1]), "L", X(sg.c[0]), Y(sg.c[1]));
          if (S.showImplied || !sg.implied) handleOps.push("M", X(sg.c[0]), Y(sg.c[1]), "L", X(sg.to[0]), Y(sg.to[1]));
          offPts.push({ x: sg.c[0], y: sg.c[1] });
        }
        from = sg.to; fromImplied = !!sg.implied;
      });
      if (!S.showImplied) {
        let prevC = null, prevImplied = !!c.startImplied;
        for (const sg of c.segs) {
          if (sg.type === "quad" && prevC && prevImplied) handleOps.push("M", X(prevC[0]), Y(prevC[1]), "L", X(sg.c[0]), Y(sg.c[1]));
          prevC = sg.type === "quad" ? sg.c : null;
          prevImplied = !!sg.implied;
        }
        const last = c.segs[c.segs.length - 1], first = c.segs[0];
        if (c.startImplied && last && first && last.type === "quad" && first.type === "quad")
          handleOps.push("M", X(last.c[0]), Y(last.c[1]), "L", X(first.c[0]), Y(first.c[1]));
      }
      if (S.pointsOn !== false && S.handlesOn && handleOps.length) P.path(handleOps, handleSt);

      nodes.forEach(n => {
        if (n.implied && !S.showImplied) return;
        onPts.push({ x: n.pt[0], y: n.pt[1], kind: n.implied ? "implied" : n.kind, node: n });
      });

      // Point order as the file stores it: each node, then the controls of the
      // segment leaving it. Implied TrueType points are not stored, so not numbered.
      const vis = n => !n.implied || S.showImplied;
      c.segs.forEach((sg, i) => {
        if (i < nodes.length && vis(nodes[i])) labels.push({ x: nodes[i].pt[0], y: nodes[i].pt[1], n: num++ });
        const ctrls = sg.type === "cubic" ? [sg.c1, sg.c2] : sg.type === "quad" ? [sg.c] : [];
        ctrls.forEach(p => labels.push({ x: p[0], y: p[1], n: num++ }));
      });
      if (nodes.length > c.segs.length && vis(nodes[nodes.length - 1])) {
        const n = nodes[nodes.length - 1];
        labels.push({ x: n.pt[0], y: n.pt[1], n: num++ });
      }

      /* a reversed contour gets its outline redrawn in the marker colour */
      if (dirs && dirs[ci] && dirs[ci].wrong) {
        const ops = ["M", X(c.start[0]), Y(c.start[1])];
        c.segs.forEach(sg => {
          if (sg.type === "line") ops.push("L", X(sg.to[0]), Y(sg.to[1]));
          else if (sg.type === "quad") ops.push("Q", X(sg.c[0]), Y(sg.c[1]), X(sg.to[0]), Y(sg.to[1]));
          else ops.push("C", X(sg.c1[0]), Y(sg.c1[1]), X(sg.c2[0]), Y(sg.c2[1]), X(sg.to[0]), Y(sg.to[1]));
        });
        if (c.closed) ops.push("Z");
        P.path(ops, { stroke: S.accent, width: Math.max(2, S.outlineWidth * 2) * k, dash: [8 * k, 5 * k] });
      }

      /* start point: a triangle pointing the way the contour runs, as in Glyphs */
      if (S.startOn && c.segs.length) {
        const st = nodes[0];
        const d = leaveDir(c.start, c.segs[0]);
        if (d) {
          const ux = d.dx / d.len, uy = d.dy / d.len;
          // screen space: Y() is a plain scale, so the direction carries over
          const cx = X(st.pt[0]), cy = Y(st.pt[1]);
          const size = Math.max(9 * k, S.onSize * k * 1.15);
          const back = size * 0.25, tip = size * 1.25;
          const nx = -uy, ny = ux;
          P.path(["M", cx + ux * tip, cy + uy * tip,
                  "L", cx - ux * back + nx * size * 0.62, cy - uy * back + ny * size * 0.62,
                  "L", cx - ux * back - nx * size * 0.62, cy - uy * back - ny * size * 0.62, "Z"],
            { fill: S.accent, opacity: 0.9 });
        }
      }

      /* arrows along every segment, so the whole contour's direction reads */
      if (S.dirOn) {
        let f = c.start;
        c.segs.forEach(sg => {
          const m = segPointAt(f, sg, 0.5), t = segTangentAt(f, sg, 0.5);
          const len = Math.hypot(t[0], t[1]);
          if (len > 1e-9) {
            const ux = t[0] / len, uy = t[1] / len, h = 5.5 * k;
            const mx = X(m[0]), my = Y(m[1]), nx = -uy, ny = ux;
            P.path(["M", mx + ux * h, my + uy * h, "L", mx - ux * h + nx * h, my - uy * h + ny * h,
                    "L", mx - ux * h - nx * h, my - uy * h - ny * h, "Z"], { fill: S.accent });
          }
          f = sg.to;
        });
      }
      ci++;
    });
  });

  /* missing extrema */
  if (S.extremaOn) {
    analysePaths(allC, conv).extrema.forEach(([ex, ey]) => {
      P.circle(X(ex), Y(ey), Math.max(5 * k, S.onSize * k * 0.8), { stroke: S.accent, width: 1.8 * k });
      P.path(["M", X(ex) - 3 * k, Y(ey), "L", X(ex) + 3 * k, Y(ey), "M", X(ex), Y(ey) - 3 * k, "L", X(ex), Y(ey) + 3 * k],
        { stroke: S.accent, width: 1.4 * k });
    });
  }

  const mark = (shape, x, y, size, colour, style) => {
    const r = size / 2;
    const st = style === "hollow" ? { fill: S.transparent && opts.transparent ? null : S.bg, stroke: colour, width: S.pointStroke * k }
                                  : { fill: colour };
    if (shape === "circle") P.circle(x, y, r, st);
    else if (shape === "diamond") P.path(["M", x, y - r * 1.2, "L", x + r * 1.2, y, "L", x, y + r * 1.2, "L", x - r * 1.2, y, "Z"], st);
    else if (shape === "cross") P.path(["M", x - r, y - r, "L", x + r, y + r, "M", x + r, y - r, "L", x - r, y + r],
      { stroke: colour, width: Math.max(S.pointStroke, 1.2) * k });
    else P.rect(x - r, y - r, r * 2, r * 2, st);
  };

  if (S.pointsOn !== false && S.offSize > 0) offPts.forEach(p => {
    mark(S.offShape, X(p.x), Y(p.y), S.offSize * k, S.offColour, S.offStyle);
    hits.push({ x: X(p.x), y: Y(p.y), kind: "off-curve", ux: p.x, uy: p.y });
  });
  if (S.pointsOn !== false && S.onSize > 0) onPts.forEach(p => {
    const x = X(p.x), y = Y(p.y);
    if (p.kind === "end") {
      // open-path ends: a short bar across the path, as Glyphs draws them
      const d = p.node.start ? p.node.dirOut : p.node.dirIn;
      const ux = d ? d.dx / d.len : 1, uy = d ? d.dy / d.len : 0;
      const r = S.onSize * k * 0.7;
      P.path(["M", x - uy * r, y + ux * r, "L", x + uy * r, y - ux * r],
        { stroke: S.onColour, width: Math.max(1.5, S.handleWidth * 1.6) * k });
    } else {
      const smooth = p.kind === "smooth";
      const shape = smooth && S.smoothShape !== "same" ? S.smoothShape : S.onShape;
      const colour = p.kind === "implied" ? S.impliedColour : (smooth && S.smoothDistinct ? S.smoothColour : S.onColour);
      const size = p.kind === "implied" ? S.onSize * k * 0.6 : S.onSize * k;
      mark(shape, x, y, size, colour, p.kind === "implied" ? "hollow" : S.onStyle);
    }
    hits.push({ x, y, kind: p.kind, ux: p.x, uy: p.y });
  });

  /* labels, in path order */
  if (S.pointsOn !== false && (S.numbersOn || S.coordsOn)) {
    const fs = S.labelSize * k;
    labels.forEach(l => {
      const parts = [];
      if (S.numbersOn) parts.push(String(l.n));
      if (S.coordsOn) parts.push(Math.round(l.x) + "," + Math.round(S.src === "type" ? -l.y : l.y));
      P.text(X(l.x) + fs * 0.8, Y(l.y) - fs * 0.7, parts.join("  "), { size: fs, fill: S.labelColour });
    });
  }
  return { hits, scale: s, bounds: b };
}

/* ================================================================ view */
const view = { zoom: 1, px: 0, py: 0 };
const canvas = $("#view");
let lastHits = [];

function fitView() { view.zoom = 1; view.px = 0; view.py = 0; draw(); }

function draw() {
  const stage = $("#stage").getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = Math.max(1, Math.round(stage.width)), ch = Math.max(1, Math.round(stage.height));
  if (canvas.width !== cw * dpr) canvas.width = cw * dpr;
  if (canvas.height !== ch * dpr) canvas.height = ch * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // the stage outside the frame is the app's own background
  const appBg = getComputedStyle(document.body).backgroundColor;
  ctx.fillStyle = appBg; ctx.fillRect(0, 0, canvas.width, canvas.height);

  const art = currentArt();
  const b = artBounds(art);
  const margin = 20;
  // a stage with no size yet (a hidden tab, a window still opening) would give a
  // negative frame and negative point sizes; wait for a real size instead
  if (cw - margin * 2 < 4 || ch - margin * 2 < 4) { drawStats(art); return; }
  const fr = frameSize(cw - margin * 2, ch - margin * 2, b);
  const fx = (cw - fr.w) / 2, fy = (ch - fr.h) / 2;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.save();
  ctx.translate(fx, fy);
  ctx.beginPath(); ctx.rect(0, 0, fr.w, fr.h); ctx.clip();
  if (S.transparent) {
    // checker, so a transparent export is visibly transparent
    const t = 10;
    for (let yy = 0; yy < fr.h; yy += t) for (let xx = 0; xx < fr.w; xx += t) {
      ctx.fillStyle = ((xx / t + yy / t) & 1) ? "#cfcfcf" : "#f2f2f2";
      ctx.fillRect(xx, yy, t, t);
    }
  }
  const res = paintScene(new CanvasPainter(ctx), fr.w, fr.h, art, view, { transparent: S.transparent });
  ctx.restore();
  lastHits = res.hits.map(h => ({ x: h.x + fx, y: h.y + fy, kind: h.kind, ux: h.ux, uy: h.uy }));
  drawStats(art);
}
new ResizeObserver(() => draw()).observe($("#stage"));

function drawStats(art) {
  const all = [];
  art.glyphs.forEach(g => g.contours.forEach(c => all.push(c)));
  const opts = analysisOpts(art);
  const a = analysePaths(all, opts);
  a.reversed = glyphDirections(art, opts.convention).filter(d => d.wrong).length;
  const src = S.src === "type" ? (font ? esc(font.name) : "logo, load a font") : (svgArt ? esc(svgLabel) : "logo, load an SVG");
  const cells = [
    ["Source", src],
    ["Contours", a.contours],
    ["On-curve", a.on],
    ["Off-curve", a.off],
    ["Smooth / corner", a.smooth + " / " + a.corners],
    ["Lines · quad · cubic", a.lines + " · " + a.quads + " · " + a.cubics],
  ];
  if (a.implied) cells.push(["Implied", a.implied]);
  if (S.src === "type" && font && !art.demo) {
    cells.push(["Kerning", !font.kernSource ? "none in font" : !S.kerning ? "off"
      : font.kernSource + " · " + (art.kernPairs || 0) + (art.kernPairs === 1 ? " pair" : " pairs")]);
  }
  if (a.ends) cells.push(["Open ends", a.ends]);
  cells.push(["Missing extrema", a.missingExtrema, a.missingExtrema ? "bad" : ""]);
  cells.push(["Reversed contours", a.reversed, a.reversed ? "bad" : ""]);
  $("#stats").innerHTML = cells.map(([k, v, cls]) =>
    '<div class="stat"><span>' + k + '</span><b class="' + (cls || "") + '">' + v + "</b></div>").join("");
}

/* pan, zoom, hover */
const stageEl = $("#stage");
let drag = null;
stageEl.addEventListener("pointerdown", e => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, px: view.px, py: view.py };
  stageEl.setPointerCapture(e.pointerId); stageEl.classList.add("dragging");
});
stageEl.addEventListener("pointermove", e => {
  if (drag) {
    view.px = drag.px + (e.clientX - drag.x);
    view.py = drag.py + (e.clientY - drag.y);
    draw();
    return;
  }
  const r = stageEl.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  let best = null, bd = 12;
  for (const h of lastHits) {
    const d = Math.hypot(h.x - mx, h.y - my);
    if (d < bd) { bd = d; best = h; }
  }
  const tip = $("#tip");
  if (best) {
    const yy = S.src === "type" ? -best.uy : best.uy;
    tip.textContent = best.kind + "  " + (Math.round(best.ux * 10) / 10) + ", " + (Math.round(yy * 10) / 10);
    tip.style.left = (best.x + 12) + "px"; tip.style.top = (best.y - 28) + "px";
    tip.style.display = "block";
  } else tip.style.display = "none";
});
const endDrag = () => { drag = null; stageEl.classList.remove("dragging"); };
stageEl.addEventListener("pointerup", endDrag);
stageEl.addEventListener("pointercancel", endDrag);
stageEl.addEventListener("pointerleave", () => { $("#tip").style.display = "none"; });
stageEl.addEventListener("dblclick", fitView);
// Zoom changes how big the outline is drawn, never the size of points,
// handles or lines (their unit ignores zoom), so zooming in shows detail.
// That only holds if the browser leaves the page alone, so every zoom gesture
// over the stage is caught here instead of scaling the whole page.
function zoomAt(clientX, clientY, factor) {
  const r = stageEl.getBoundingClientRect();
  const nz = Math.max(0.2, Math.min(40, view.zoom * factor));
  const cx = clientX - r.left - r.width / 2, cy = clientY - r.top - r.height / 2;
  view.px = cx - (cx - view.px) * (nz / view.zoom);
  view.py = cy - (cy - view.py) * (nz / view.zoom);
  view.zoom = nz;
  draw();
}
stageEl.addEventListener("wheel", e => {
  e.preventDefault();
  // A trackpad pinch arrives as ctrl+wheel (Chrome, Firefox, Edge). A mouse
  // wheel sends whole notches; a two-finger scroll sends small fractional or
  // sideways deltas, and that pans, as it does in Figma or Illustrator.
  const trackpadScroll = !e.ctrlKey && e.deltaMode === 0 &&
    (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40);
  if (trackpadScroll) {
    view.px -= e.deltaX; view.py -= e.deltaY;
    draw();
    return;
  }
  const speed = e.ctrlKey ? 0.01 : 0.0015;   // pinch deltas are small, wheel notches big
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * speed));
}, { passive: false });
// Safari sends a trackpad pinch as gesture events, not wheel, and zooms the
// whole page with them unless they are stopped.
let gestureScale = 1;
stageEl.addEventListener("gesturestart", e => { e.preventDefault(); gestureScale = 1; });
stageEl.addEventListener("gesturechange", e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.scale / gestureScale);
  gestureScale = e.scale;
});
stageEl.addEventListener("gestureend", e => e.preventDefault());
const zoomBy = f => { view.zoom = Math.max(0.2, Math.min(40, view.zoom * f)); view.px *= f; view.py *= f; draw(); };
$("#fitBtn").addEventListener("click", fitView);
$("#zoomIn").addEventListener("click", () => zoomBy(1.25));
$("#zoomOut").addEventListener("click", () => zoomBy(0.8));
window.addEventListener("keydown", e => {
  if (e.target.closest("input, textarea, select")) return;
  if (e.key === "0") fitView();
  else if (e.key === "g" || e.key === "G") randomGlyph();
  else if (e.key === "+" || e.key === "=") zoomBy(1.25);
  else if (e.key === "-") zoomBy(0.8);
});

/* =============================================================== export */
function exportSize() {
  const art = currentArt();
  const b = artBounds(art);
  const W = Math.round(S.exportW);
  const fr = frameSize(W, 1e9, b);
  return { art, W, H: Math.max(1, Math.round(W / fr.ratio)) };
}
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const baseName = () => (S.src === "type" ? (font ? font.name : "demo") + "-" + (S.text || "").replace(/\s+/g, "").slice(0, 12)
  : (svgLabel || "demo").replace(/\.svg$/i, "")).replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "paths";

function buildSVG() {
  const { art, W, H } = exportSize();
  const p = new SvgPainter(W, H);
  paintScene(p, W, H, art, null, { transparent: S.transparent });
  return p.toString();
}
$("#pngBtn").addEventListener("click", () => {
  const { art, W, H } = exportSize();
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  paintScene(new CanvasPainter(ctx), W, H, art, null, { transparent: S.transparent });
  c.toBlob(b => { download(b, baseName() + ".png"); toast("PNG " + W + " × " + H + " saved"); }, "image/png");
});
$("#svgOutBtn").addEventListener("click", () => {
  download(new Blob([buildSVG()], { type: "image/svg+xml" }), baseName() + ".svg");
  toast("SVG saved");
});
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(what + " copied"); }
  catch { toast("Clipboard blocked by the browser"); }
}
$("#copySvg").addEventListener("click", () => copy(buildSVG(), "SVG"));
$("#copyD").addEventListener("click", () => {
  const art = currentArt();
  const parts = [];
  art.glyphs.forEach(g => g.contours.forEach(c => {
    let d = "M" + f2(c.start[0]) + " " + f2(c.start[1]);
    c.segs.forEach(s => {
      if (s.type === "line") d += "L" + f2(s.to[0]) + " " + f2(s.to[1]);
      else if (s.type === "quad") d += "Q" + [s.c[0], s.c[1], s.to[0], s.to[1]].map(f2).join(" ");
      else d += "C" + [s.c1[0], s.c1[1], s.c2[0], s.c2[1], s.to[0], s.to[1]].map(f2).join(" ");
    });
    if (c.closed) d += "Z";
    parts.push(d);
  }));
  copy(parts.join(" "), "Path data");
});
$("#copyPts").addEventListener("click", () => {
  const art = currentArt();
  const flipY = S.src === "type";
  const out = art.glyphs.map(g => ({
    char: g.ch || undefined,
    contours: g.contours.map(c => contourNodes(c).filter(n => S.showImplied || !n.implied).map(n => ({
      on: [round1(n.pt[0]), round1(flipY ? -n.pt[1] : n.pt[1])],
      in: n.inH ? [round1(n.inH[0]), round1(flipY ? -n.inH[1] : n.inH[1])] : null,
      out: n.outH ? [round1(n.outH[0]), round1(flipY ? -n.outH[1] : n.outH[1])] : null,
      kind: n.implied ? "implied" : n.kind,
    }))),
  }));
  copy(JSON.stringify(out, null, 1), "Points");
});
const round1 = v => Math.round(v * 10) / 10;
$("#resetBtn").addEventListener("click", () => applyTheme("Specimen"));

/* ================================================================= boot */
drawUserSettings();
syncUI();
draw();
if (document.fonts && document.fonts.load) document.fonts.load('11px Geist').then(() => draw());
