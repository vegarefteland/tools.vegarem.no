/* Logo Tester — board, controls and exports. Measurement lives in engine.js. */
"use strict";

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ================================================================
 * NAV + THEME (shared across Studio)
 * ================================================================ */
const NAV = [["/", "Studio"], ["/tools/layout/index.html", "Layout"],
  ["/tools/converter/index.html", "Converter"],
  ["/tools/animator/index.html", "Animator"], ["/tools/pixel/index.html", "Pixel"],
  ["/tools/logo/index.html", "Logo"], ["/tools/gradient/index.html", "Gradient"],
  ["/tools/paths/index.html", "Paths"]];
$(".hub-pill").innerHTML = NAV.map(([href, label]) =>
  '<a href="' + href + '"' + (label === "Logo" ? ' class="active"' : '') + '>' + label + '</a>')
  .join('<span class="sep">&middot;</span>');

const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';
const MOON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
const root = document.documentElement;
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } }
function paintTheme() { $("#themeIcon").innerHTML = root.getAttribute("data-theme") === "dark" ? SUN : MOON; }
if (store("vegar-tools-theme")) root.setAttribute("data-theme", store("vegar-tools-theme"));
paintTheme();
$("#themeToggle").addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next); store("vegar-tools-theme", next); paintTheme();
});

let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2300);
}
const say = msg => { $("#status").textContent = msg || ""; };

/* ================================================================
 * STATE
 * ================================================================ */
const TESTS = [
  ["overview", "Measurements"],
  ["scale", "Scale ladder"],
  ["colour", "Colour variants"],
  ["backgrounds", "Backgrounds & contrast"],
  ["squint", "Squint test"],
  ["cvd", "Colour vision"],
  ["onebit", "One-bit & engraving"],
  ["contexts", "In context"],
  ["clearspace", "Clear space & geometry"],
  ["distance", "Viewing distance"],
  ["degrade", "Rough handling"],
  ["compare", "A / B compare"],
];
const DEFAULTS = {
  ink: "#111111", ink2: "#ffffff", page: "#f4f1ea",
  palette: ["#ffffff", "#000000", "#1d3fbb", "#d9534f", "#2f6f4e", "#8a8f98"],
  sizes: "16, 24, 32, 48, 64, 96, 128, 192",
  printSizes: "6, 10, 15, 25, 40, 70",
  dpi: 96, minfeat: 1, clear: 25,
  on: Object.fromEntries(TESTS.map(([k]) => [k, true])),
};
let S = JSON.parse(JSON.stringify(DEFAULTS));
try { Object.assign(S, JSON.parse(store("studio-logo-settings") || "{}")); } catch {}
S.on = Object.assign({}, DEFAULTS.on, S.on || {});

const marks = { A: null, B: null };
let saveT;
function persist() { clearTimeout(saveT); saveT = setTimeout(() => store("studio-logo-settings", JSON.stringify(S)), 250); }

const nums = str => String(str || "").split(/[,\s]+/).map(parseFloat).filter(v => v > 0);
const mmToPx = mm => mm / 25.4 * (S.dpi || 96);

/* ================================================================
 * LOADING
 * ================================================================ */
async function loadFile(file, slot) {
  const isSVG = file.type.includes("svg") || /\.svg$/i.test(file.name);
  try {
    let mark;
    if (isSVG) {
      const text = await file.text();
      const p = parseLogoSVG(text);
      if (!p.ok) throw new Error(p.error);
      const markup = p.markup;
      const url = svgURL(markup);
      const img = await loadImage(url);
      mark = { name: file.name, kind: "svg", svgEl: p.svg, markup, url, img,
               aspect: p.w / p.h, notes: p.notes.slice() };
    } else {
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      mark = { name: file.name, kind: "raster", url, img,
               aspect: img.naturalWidth / img.naturalHeight, notes: [],
               px: img.naturalWidth + " × " + img.naturalHeight + " px" };
      mark.notes.push("This is a bitmap. It cannot scale past its own resolution — " +
        "test the vector original if you have one.");
    }
    const stats = analyse(mark.img, mark.aspect);
    if (!stats.ok) throw new Error(stats.error);
    mark.stats = stats;
    marks[slot] = mark;
    $("#workspace").classList.add("show");
    $("#dropZone").style.display = "none";
    render();
  } catch (e) {
    toast(e.message || "Could not read that file");
  }
}

function chip(slot) {
  const host = $("#chip" + slot);
  const m = marks[slot];
  if (!m) { host.innerHTML = ""; return; }
  host.innerHTML = '<div class="file-chip"><span class="mini" style="background-image:url(\'' +
    m.url + '\')"></span><span class="nm">' + esc(m.name) + '</span>' +
    '<button title="Replace">&#8635;</button>' + (slot === "B" ? '<button title="Remove">&times;</button>' : '') + '</div>';
  const btns = host.querySelectorAll("button");
  btns[0].addEventListener("click", () => $("#file" + slot).click());
  if (btns[1]) btns[1].addEventListener("click", () => { marks.B = null; render(); });
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

$("#dropZone").addEventListener("click", () => $("#fileA").click());
$("#addB").addEventListener("click", () => $("#fileB").click());
$("#fileA").addEventListener("change", e => { if (e.target.files[0]) loadFile(e.target.files[0], "A"); e.target.value = ""; });
$("#fileB").addEventListener("change", e => { if (e.target.files[0]) loadFile(e.target.files[0], "B"); e.target.value = ""; });

let dragN = 0;
window.addEventListener("dragenter", e => { e.preventDefault(); dragN++; $("#dropZone").classList.add("drag-over"); });
window.addEventListener("dragleave", () => { if (--dragN <= 0) { dragN = 0; $("#dropZone").classList.remove("drag-over"); } });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => {
  e.preventDefault(); dragN = 0; $("#dropZone").classList.remove("drag-over");
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f, marks.A ? (e.shiftKey ? "B" : "A") : "A");
});

/* ================================================================
 * RENDER HELPERS
 * ================================================================ */
// The mark as a recolourable block: a CSS mask keeps it crisp at any size and
// works the same for SVG and for a PNG with an alpha channel.
function maskEl(m, w, h, colour, extra) {
  // Single quotes: the style attribute itself is delimited with double quotes,
  // and a data URL quoted with those would close it on the spot.
  const url = "'" + m.url + "'";
  return '<div class="mark" style="width:' + w + 'px;height:' + h + 'px;background-color:' + colour +
    ';-webkit-mask-image:url(' + url + ');mask-image:url(' + url + ')' + (extra || "") + '"></div>';
}
function imgEl(m, w, h, extra) {
  return '<img class="markimg" src="' + esc(m.url) + '" width="' + w + '" height="' + h +
    '" alt="" style="width:' + w + 'px;height:' + h + 'px' + (extra || "") + '">';
}
const sizeFor = (m, w) => ({ w: Math.round(w), h: Math.round(w / m.aspect) });

function card(id, title, sub, body, tag) {
  if (!S.on[id]) return "";
  return '<section class="card" id="card-' + id + '">' +
    '<div class="card-head"><h3>' + title + "</h3>" +
    (tag ? '<span class="tag">' + tag + "</span>" : "") + "</div>" +
    (sub ? '<p class="sub">' + sub + "</p>" : "") + body + "</section>";
}

// A blur has to go on a wrapper, not on the masked element: filters are applied
// before the mask, so blurring a mask's flat background colour changes nothing
// and the mask then cuts a razor edge out of it anyway.
function blurWrap(inner, px) {
  return px ? '<div style="filter:blur(' + px + 'px);line-height:0">' + inner + "</div>" : inner;
}

// One sample: a fixed-height stage with its caption underneath, so rows line up.
function stage(inner, cap, o) {
  o = o || {};
  const st = "background:" + (o.bg || S.page) +
    (o.h ? ";--stage:" + o.h + "px" : "") + (o.w ? ";width:" + o.w + "px" : "") + (o.style || "");
  return '<div class="sample"><div class="stage' + (o.tight ? " tight" : "") + '" style="' + st + '">' +
    inner + "</div>" + (cap ? '<span class="cap">' + cap + "</span>" : "") + "</div>";
}

/* ================================================================
 * THE TESTS
 * ================================================================ */
function cardOverview(m) {
  const st = m.stats;
  const detailPx = minSize(st, S.minfeat);                 // every hairline survives
  const shapePx = Math.ceil(st.refW * S.minfeat / (st.thinP25 || st.thinP50 || 1)); // the bulk survives
  const thinPct = st.thinP05 / st.refW * 100;
  const printMM = st.thinP05 ? (0.25 / (st.thinP05 / st.refW)) : null;
  const worst = worstContrast(st, hexToRgb(S.page));
  const v = contrastVerdict(worst.ratio);
  const stats =
    '<div class="stats">' +
    '<div><span>Aspect</span><b>' + st.aspect.toFixed(2) + ":1</b><small>" +
      (st.aspect > 2.5 ? "wide — awkward in square slots" : st.aspect < 0.5 ? "tall — awkward in wide slots" : "fits most slots") + "</small></div>" +
    '<div><span>Ink coverage</span><b>' + Math.round(st.coverage * 100) + '%</b><small>of its bounding box</small></div>' +
    '<div><span>Thinnest 5%</span><b>' + thinPct.toFixed(2) + '%</b><small>of the mark\'s width</small></div>' +
    '<div><span>Holds its shape from</span><b>' + shapePx + ' px</b><small>the bulk of the mark survives</small></div>' +
    '<div><span>Every detail from</span><b>' + (detailPx ? detailPx + " px" : "—") + '</b><small>including the finest stroke</small></div>' +
    '<div><span>Smallest in print</span><b>' + (printMM ? printMM.toFixed(0) + " mm" : "—") + '</b><small>keeps 0.25 mm of ink</small></div>' +
    '<div><span>Weakest colour</span><b>' + worst.hex + '</b><small>' + worst.ratio.toFixed(1) +
      ':1 on the page <span class="badge ' + v.cls + '">' + v.label + '</span></small></div>' +
    "</div>";
  const pal = st.palette.length > 1 ? '<div style="margin-top:14px"><span style="font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted)">Colours found</span>' +
    '<div style="display:flex;gap:6px;margin-top:7px;flex-wrap:wrap">' +
    st.palette.map(p => '<span title="' + p.hex + ' — ' + Math.round(p.share * 100) +
      '% of the ink" style="width:28px;height:20px;border-radius:4px;border:1px solid var(--border);background:' +
      p.hex + '"></span>').join("") + "</div></div>" : "";
  const auto = [];
  if (detailPx && detailPx > shapePx * 2.2)
    auto.push("One hairline is setting the limit: the mark reads from " + shapePx + " px, but its " +
      "finest stroke needs " + detailPx + " px. Thicken that detail, or draw a small-size version " +
      "without it, and the usable range widens enormously.");
  if (st.aspect > 3)
    auto.push("At " + st.aspect.toFixed(1) + ":1 this is a very wide mark. Square slots — avatars, " +
      "app icons, favicons — will either crop it or shrink it to nothing. A stacked variant is worth drawing.");
  if (st.coverage < 0.18)
    auto.push("The mark covers only " + Math.round(st.coverage * 100) + "% of its own bounding box, " +
      "so it carries a lot of internal air. It will look smaller than everything beside it at the same nominal size.");
  const notes = m.notes.concat(auto);
  const notesHtml = notes.length ? '<div class="notes">' +
    notes.map(n => '<div class="note"><i></i><span>' + esc(n) + "</span></div>").join("") + "</div>" : "";
  return card("overview", "Measurements", "Taken from the mark as rendered, not from the file — " +
    "so a stroke made thin by scaling counts as thin.", stats + pal + notesHtml);
}

function cardScale(m) {
  const px = nums(S.sizes), mm = nums(S.printSizes);
  const minPx = minSize(m.stats, S.minfeat);
  const tallest = Math.max.apply(null, px.map(w => w / m.aspect).concat([90]));
  const H = Math.round(tallest + 30);
  const row = px.map(w => {
    const s = sizeFor(m, w);
    const weak = minPx && w < minPx;
    return stage(maskEl(m, s.w, s.h, S.ink),
      "<b>" + w + "</b> px" + (weak ? ' <span class="badge bad">thin</span>' : ""), { h: H });
  }).join("");
  const tallestMM = Math.max.apply(null, mm.map(w => mmToPx(w) / m.aspect).concat([90]));
  const HM = Math.round(tallestMM + 30);
  const prow = mm.map(w => {
    const s = sizeFor(m, mmToPx(w));
    const weakMM = m.stats.thinP05 && (w * (m.stats.thinP05 / m.stats.refW)) < 0.25;
    return stage(maskEl(m, s.w, s.h, S.ink),
      "<b>" + w + "</b> mm" + (weakMM ? ' <span class="badge bad">thin</span>' : ""), { h: HM });
  }).join("");
  return card("scale", "Scale ladder",
    "Where the mark stops holding together. Anything flagged has strokes thinner than " +
    S.minfeat.toFixed(1) + " px on screen, or 0.25 mm on press — below that it fills in or drops out.",
    '<div class="row-label">On screen</div><div class="samples">' + row + "</div>" +
    '<div class="row-label">In print, shown at ' + S.dpi + " dpi</div>" +
    '<div class="samples">' + prow + "</div>",
    minPx ? "wants " + minPx + " px or more" : "");
}

function cardColour(m) {
  const H = 92, s = sizeFor(m, H * m.aspect);
  const opts = { h: H + 36 };
  const body = '<div class="samples">' +
    stage(imgEl(m, s.w, s.h), "original", opts) +
    stage(maskEl(m, s.w, s.h, S.ink), "one colour", opts) +
    stage(maskEl(m, s.w, s.h, S.ink2), "reversed", { h: opts.h, bg: S.ink }) +
    stage(imgEl(m, s.w, s.h, ";filter:grayscale(1)"), "greyscale", opts) +
    stage(imgEl(m, s.w, s.h, ";filter:grayscale(1) contrast(1.6)"), "greyscale, pushed", opts) +
    stage(imgEl(m, s.w, s.h, ";filter:invert(1)"), "inverted", { h: opts.h, bg: "#ffffff" }) +
    stage(maskEl(m, s.w, s.h, "#808080"), "flat silhouette", opts) +
    "</div>";
  return card("colour", "Colour variants",
    "A mark has to work in one colour before it works in several. The silhouette is the test " +
    "that matters most: if it turns to mush, the shape is doing less work than the colour.", body);
}

function cardBackgrounds(m) {
  const H = 72, s = sizeFor(m, H * m.aspect);
  const opts = { h: H + 36 };
  const cells = S.palette.map(bg => {
    const worst = worstContrast(m.stats, hexToRgb(bg));
    const v = contrastVerdict(worst.ratio);
    return stage(imgEl(m, s.w, s.h),
      bg + " · " + worst.ratio.toFixed(1) + ':1 <span class="badge ' + v.cls + '">' + v.label + "</span>",
      { h: opts.h, bg });
  }).join("");
  const photo = stage(imgEl(m, s.w, s.h), "busy background",
    { h: opts.h, bg: "linear-gradient(135deg,#6b7a8f,#2c3440 45%,#a8907a)" });
  const busy = stage(imgEl(m, s.w, s.h), "pattern",
    { h: opts.h, bg: "repeating-linear-gradient(45deg,#d8d4cc 0 8px,#8f8a81 8px 16px)" });
  return card("backgrounds", "Backgrounds & contrast",
    "Ratios are WCAG, measured between the mark's dominant ink and the background. " +
    "A logo is a graphic, so <b>3:1</b> is the bar — not the 4.5:1 you need for body text.",
    '<div class="samples">' + cells + photo + busy + "</div>");
}

function cardSquint(m) {
  const H = 96, s = sizeFor(m, H * m.aspect);
  const levels = [0, 1.5, 3, 6, 10];
  const body = '<div class="samples">' + levels.map(b =>
    stage(blurWrap(maskEl(m, s.w, s.h, S.ink), b), b ? b + " px blur" : "sharp",
      { h: H + 42 })).join("") + "</div>";
  return card("squint", "Squint test",
    "Blur stands in for distance, bad printing and a glance rather than a look. A strong mark " +
    "keeps a distinct silhouette well past the point where the detail has gone.", body);
}

function cardCVD(m) {
  const H = 90, s = sizeFor(m, H * m.aspect);
  const kinds = ["protanopia", "deuteranopia", "tritanopia", "achromatopsia"];
  const opts = { h: H + 36 };
  const body = '<div class="samples">' +
    stage(imgEl(m, s.w, s.h), "typical vision", opts) +
    kinds.map(k => stage(imgEl(m, s.w, s.h, ";filter:url(#cvd-" + k + ")"),
      k.charAt(0).toUpperCase() + k.slice(1), opts)).join("") + "</div>" +
    '<p class="sub" style="margin:12px 0 0">Around one man in twelve sees red and green differently. ' +
    'If two colours in the mark merge here, they are carrying meaning they cannot hold.</p>';
  return card("cvd", "Colour vision", "", body);
}

function cardOneBit(m) {
  const id = "ob-" + Math.random().toString(36).slice(2, 7);
  setTimeout(() => {
    const host = document.getElementById(id);
    if (!host) return;
    const defs = [["hard threshold", 0.5, false], ["heavy ink", 0.72, false],
                  ["light ink", 0.3, false], ["dithered", 0.5, true]];
    host.innerHTML = "";
    for (const [label, level, dith] of defs) {
      const W = 150, Hh = Math.round(W / m.aspect);
      const c = document.createElement("canvas");
      c.width = W * 2; c.height = Hh * 2;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(m.img, 0, 0, c.width, c.height);
      thresholdCtx(x, c.width, c.height, level, dith);
      c.style.width = W + "px"; c.style.height = Hh + "px";
      c.className = "markimg";
      const wrap = document.createElement("div");
      wrap.className = "sample";
      const st = document.createElement("div");
      st.className = "stage tight";
      st.style.background = "#fff";
      st.style.setProperty("--stage", (Hh + 2) + "px");
      st.appendChild(c);
      wrap.appendChild(st);
      const cap = document.createElement("span");
      cap.className = "cap"; cap.textContent = label;
      wrap.appendChild(cap);
      host.appendChild(wrap);
    }
  }, 0);
  return card("onebit", "One-bit & engraving",
    "What a stamp, an engraver, a fax or a cheap photocopier will do with it: every pixel goes " +
    "fully on or fully off. Mid-tones and thin outlines are what break here.",
    '<div class="samples" id="' + id + '"></div>');
}

function cardContexts(m) {
  const fav = sizeFor(m, 16), fav13 = sizeFor(m, 13);
  const icon = sizeFor(m, 56 * Math.min(1, m.aspect)), av = sizeFor(m, 54);
  const page = S.page, ink = S.ink;
  const tab =
    '<div class="ctx"><div class="tabbar"><div class="tab">' +
      maskEl(m, fav.w, fav.h, "#e8e8ea", ";flex-shrink:0") +
      "<span>" + esc(m.name.replace(/\.[^.]+$/, "")) + "</span></div>" +
      '<div class="urlbar">' + maskEl(m, fav13.w, fav13.h, "#9b9ba2") + "<span>example.com</span></div></div>" +
      '<span class="cap">browser tab &amp; address bar — 16 px</span></div>';
  const phone =
    '<div class="ctx"><div class="phone"><div class="icons">' +
      '<div class="app"><div class="sq" style="background:' + page + '">' +
        maskEl(m, icon.w * 0.8, icon.h * 0.8, ink) + '</div><div class="lbl">Brand</div></div>' +
      '<div class="app"><div class="sq" style="background:' + ink + '">' +
        maskEl(m, icon.w * 0.8, icon.h * 0.8, page) + '</div><div class="lbl">Brand</div></div>' +
      '<div class="app"><div class="sq ghost"></div><div class="lbl">&nbsp;</div></div>' +
      '<div class="app"><div class="sq ghost"></div><div class="lbl">&nbsp;</div></div>' +
      "</div></div><span class=\"cap\">app icon on a home screen</span></div>";
  const avatar =
    '<div class="ctx"><div style="display:flex;gap:10px;align-items:center">' +
      '<div class="avatar tile" style="width:72px;height:72px;background:' + page + '">' +
        maskEl(m, av.w, av.h, ink) + "</div>" +
      '<div class="avatar tile" style="width:48px;height:48px;background:' + ink + '">' +
        maskEl(m, av.w * 0.66, av.h * 0.66, page) + "</div>" +
      '<div class="avatar tile" style="width:32px;height:32px;background:' + page + '">' +
        maskEl(m, av.w * 0.44, av.h * 0.44, ink) + "</div>" +
      '</div><span class="cap">circle crop — profile pictures clip the corners</span></div>';
  const cardMock =
    '<div class="ctx"><div class="bizcard" style="background:' + page + '">' +
      maskEl(m, sizeFor(m, 110).w, sizeFor(m, 110).h, ink) + "</div>" +
      '<span class="cap">business card, 85 × 55 mm</span></div>';
  const shirtArt =
    '<svg viewBox="0 0 200 190" width="190" height="180" aria-hidden="true">' +
      '<path d="M66 12 L34 28 L18 62 L44 76 L50 60 L50 180 L150 180 L150 60 L156 76 L182 62 L166 28 L134 12 ' +
      'C128 30 112 38 100 38 C88 38 72 30 66 12 Z" fill="#2a2d33" stroke="#1b1d21" stroke-width="2"/>' +
      '</svg>';
  const shirt =
    '<div class="ctx"><div style="position:relative;width:190px;height:180px">' + shirtArt +
      '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding-top:26px">' +
      maskEl(m, sizeFor(m, 66).w, sizeFor(m, 66).h, "#efece6") + "</div></div>" +
      '<span class="cap">chest print on a dark garment</span></div>';
  const sign =
    '<div class="ctx"><div class="sign">' + maskEl(m, sizeFor(m, 150).w, sizeFor(m, 150).h, "#f2f2f0") +
      '</div><span class="cap">sign above a door</span></div>';
  return card("contexts", "In context",
    "The same mark in the places it actually has to live. Favicons and avatars are where most " +
    "logos fail — they crop, they shrink, and nobody redraws them for you.",
    '<div class="ctx-row">' + tab + phone + avatar + "</div>" +
    '<div class="ctx-row" style="margin-top:20px">' + cardMock + shirt + sign + "</div>");
}

function cardClearSpace(m) {
  const H = 120, s = sizeFor(m, H * m.aspect);
  const pad = Math.round(s.h * (S.clear / 100));
  const box =
    '<div class="clearbox" style="padding:' + pad + "px;background:" + S.page + ';border-radius:8px">' +
      '<div class="edge" style="inset:' + pad + "px\"></div>" +
      '<div class="edge"></div>' + maskEl(m, s.w, s.h, S.ink) + "</div>";
  const circle =
    '<div class="tile" style="width:150px;height:150px;border-radius:50%;background:' + S.page + '">' +
      maskEl(m, sizeFor(m, 150 * 0.62).w, sizeFor(m, 150 * 0.62).h, S.ink) + "</div>";
  const square =
    '<div class="tile" style="width:150px;height:150px;border-radius:14px;background:' + S.page + '">' +
      maskEl(m, sizeFor(m, 150 * 0.66).w, sizeFor(m, 150 * 0.66).h, S.ink) + "</div>";
  const st = m.stats;
  const trim = st.trim;
  const trimNote = (Math.max(trim.left, trim.right, trim.top, trim.bottom) > 0.04)
    ? '<div class="note" style="margin-top:12px"><i></i><span>The artboard carries up to ' +
      Math.round(Math.max(trim.left, trim.right, trim.top, trim.bottom) * 100) +
      '% empty margin on one side. That padding travels into every layout and makes the mark ' +
      'sit off-centre — crop the file to the artwork and set clear space deliberately.</span></div>' : "";
  return card("clearspace", "Clear space & geometry",
    "Dashed outer line is the artboard; inner line is the clear space you have set (" + S.clear +
    "% of the mark's height). The circle and rounded square are the crops platforms impose.",
    '<div class="samples">' +
      [[box, "clear space"], [circle, "circle crop"], [square, "rounded square"]]
        .map(([inner, cap]) => stage(inner, cap,
          { h: 180, bg: "transparent", tight: true, style: ";border:0" })).join("") +
    "</div>" + trimNote);
}

function cardDistance(m) {
  const steps = [[1, "arm's length"], [0.55, "across a desk"], [0.3, "across a room"], [0.16, "across the street"]];
  const H = 120;
  const W = Math.round(H * m.aspect) + 28;
  const body = '<div class="samples">' + steps.map(([k, label]) => {
    const s = sizeFor(m, H * m.aspect * k);
    const blur = (1 - k) * 2.6;
    return stage(blurWrap(maskEl(m, s.w, s.h, S.ink), +blur.toFixed(2)), label,
      { h: H + 36, w: W });
  }).join("") + "</div>";
  return card("distance", "Viewing distance",
    "Size and blur together, the way distance really works. The question is not whether you can " +
    "read it — you know what it says — but whether the shape is still recognisable.", body);
}

function cardDegrade(m) {
  const id = "dg-" + Math.random().toString(36).slice(2, 7);
  setTimeout(async () => {
    const host = document.getElementById(id);
    if (!host) return;
    host.innerHTML = "";
    const W = 150, Hh = Math.round(W / m.aspect);
    const mk = (canvas, label) => {
      canvas.style.width = W + "px"; canvas.style.height = Hh + "px";
      canvas.className = "markimg";
      const wrap = document.createElement("div"); wrap.className = "sample";
      const st = document.createElement("div");
      st.className = "stage tight"; st.style.background = S.page;
      st.style.setProperty("--stage", (Hh + 2) + "px");
      st.appendChild(canvas); wrap.appendChild(st);
      const cap = document.createElement("span"); cap.className = "cap"; cap.textContent = label;
      wrap.appendChild(cap); host.appendChild(wrap);
    };
    // pixelation: drawn small, blown up with no smoothing
    for (const small of [24, 14]) {
      const c = document.createElement("canvas");
      c.width = W * 2; c.height = Hh * 2;
      const x = c.getContext("2d");
      x.fillStyle = S.page; x.fillRect(0, 0, c.width, c.height);
      const t = document.createElement("canvas");
      t.width = small; t.height = Math.max(1, Math.round(small / m.aspect));
      t.getContext("2d").drawImage(m.img, 0, 0, t.width, t.height);
      x.imageSmoothingEnabled = false;
      x.drawImage(t, 0, 0, c.width, c.height);
      mk(c, small + " px, enlarged");
    }
    // jpeg mangling
    const src = document.createElement("canvas");
    src.width = W * 2; src.height = Hh * 2;
    const sx = src.getContext("2d");
    sx.fillStyle = S.page; sx.fillRect(0, 0, src.width, src.height);
    sx.drawImage(m.img, 0, 0, src.width, src.height);
    for (const q of [0.3, 0.08]) {
      const img = await loadImage(src.toDataURL("image/jpeg", q));
      const c = document.createElement("canvas");
      c.width = W * 2; c.height = Hh * 2;
      c.getContext("2d").drawImage(img, 0, 0);
      mk(c, "jpeg, quality " + Math.round(q * 100) + "%");
    }
  }, 0);
  return card("degrade", "Rough handling",
    "What happens when someone screenshots it, scales it in a slide deck, or saves it as a small " +
    "jpeg — which is most of the life of a logo once it leaves you.",
    '<div class="samples" id="' + id + '"></div>');
}

function cardCompare() {
  const a = marks.A, b = marks.B;
  if (!b) return "";
  const H = 86;
  const row = (m, label) => {
    const s = sizeFor(m, H * m.aspect), tiny = sizeFor(m, 24);
    const minPx = minSize(m.stats, S.minfeat);
    const o = { h: H + 34 };
    return '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;padding:14px 0">' +
      '<b style="width:22px;font-size:12px;line-height:' + (H + 34) + 'px">' + label + "</b>" +
      '<div class="samples">' +
        stage(imgEl(m, s.w, s.h), "full colour", o) +
        stage(maskEl(m, s.w, s.h, S.ink), "one colour", o) +
        stage(maskEl(m, s.w, s.h, S.ink2), "reversed", { h: o.h, bg: S.ink }) +
        stage(blurWrap(maskEl(m, s.w, s.h, S.ink), 4), "blurred", o) +
        stage(maskEl(m, tiny.w, tiny.h, S.ink), "24 px", o) +
        stage('<span style="font:11px/1.6 ui-monospace,Menlo,monospace;color:var(--muted);text-align:left">' +
          m.stats.aspect.toFixed(2) + ":1<br>thinnest " + (m.stats.thinP05 / m.stats.refW * 100).toFixed(2) +
          "%<br>min " + (minPx || "—") + " px</span>", "", { h: o.h, bg: "transparent" }) +
      "</div></div>";
  };
  return card("compare", "A / B compare",
    "The same five checks on both versions: full colour, one colour, reversed, blurred, and at 24 px.",
    row(a, "A") + '<div class="divider"></div>' + row(b, "B"));
}

/* ================================================================
 * BOARD
 * ================================================================ */
function render() {
  chip("A"); chip("B");
  $("#addB").style.display = marks.B ? "none" : "";
  const m = marks.A;
  if (!m) { $("#board").innerHTML = ""; return; }
  const cards = [
    cardOverview(m), cardScale(m), cardColour(m), cardBackgrounds(m), cardSquint(m),
    cardCVD(m), cardOneBit(m), cardContexts(m), cardClearSpace(m), cardDistance(m),
    cardDegrade(m), cardCompare(),
  ].join("");
  const jump = TESTS.filter(([k]) => S.on[k] && (k !== "compare" || marks.B))
    .map(([k, label]) => '<a href="#card-' + k + '">' + label + "</a>").join("");
  $("#board").innerHTML = '<nav class="jump">' + jump + "</nav>" + cards;
}

/* ================================================================
 * CONTROLS
 * ================================================================ */
function bindColour(id, key, codeId) {
  const el = $("#" + id);
  el.value = S[key]; $("#" + codeId).textContent = S[key];
  el.addEventListener("input", () => {
    S[key] = el.value; $("#" + codeId).textContent = el.value; persist(); render();
  });
}
bindColour("ink", "ink", "inkHex");
bindColour("ink2", "ink2", "ink2Hex");
bindColour("page", "page", "pageHex");

function drawPalette() {
  const host = $("#palette");
  host.innerHTML = S.palette.map((c, i) =>
    '<span class="sw"><input type="color" value="' + c + '" data-i="' + i + '">' +
    '<button class="rm" data-i="' + i + '" title="Remove">&times;</button></span>').join("");
  host.querySelectorAll('input[type="color"]').forEach(inp =>
    inp.addEventListener("input", () => { S.palette[+inp.dataset.i] = inp.value; persist(); render(); }));
  host.querySelectorAll(".rm").forEach(b =>
    b.addEventListener("click", () => { S.palette.splice(+b.dataset.i, 1); persist(); drawPalette(); render(); }));
}
$("#addSw").addEventListener("click", () => { S.palette.push("#cccccc"); persist(); drawPalette(); render(); });
drawPalette();

function bindText(id, key) {
  const el = $("#" + id);
  el.value = S[key];
  el.addEventListener("change", () => { S[key] = el.value; persist(); render(); });
}
bindText("sizes", "sizes");
bindText("printSizes", "printSizes");

$("#dpi").value = S.dpi;
$("#dpi").addEventListener("change", e => { S.dpi = +e.target.value || 96; persist(); render(); });
$("#minfeat").value = S.minfeat;
$("#minfeatVal").textContent = (+S.minfeat).toFixed(1) + " px";
$("#minfeat").addEventListener("input", e => {
  S.minfeat = +e.target.value; $("#minfeatVal").textContent = S.minfeat.toFixed(1) + " px"; persist(); render();
});
$("#clear").value = S.clear;
$("#clearVal").textContent = S.clear + "% of height";
$("#clear").addEventListener("input", e => {
  S.clear = +e.target.value; $("#clearVal").textContent = S.clear + "% of height"; persist(); render();
});

$("#testToggles").innerHTML = TESTS.map(([k, label]) =>
  '<label class="chk"><input type="checkbox" data-test="' + k + '"' + (S.on[k] ? " checked" : "") +
  "><span>" + label + "</span></label>").join("");
$$('#testToggles input').forEach(inp => inp.addEventListener("change", () => {
  S.on[inp.dataset.test] = inp.checked; persist(); render();
}));

/* ================================================================
 * EXPORT
 * ================================================================ */
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const baseName = () => (marks.A ? marks.A.name.replace(/\.[^.]+$/, "") : "logo");

// A flat PNG of the mark at one size, recoloured, on a background.
function flatten(m, w, colour, bg) {
  const h = Math.max(1, Math.round(w / m.aspect));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.drawImage(m.img, 0, 0, w, h);
  if (colour) {
    x.globalCompositeOperation = "source-in";
    x.fillStyle = colour; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = "source-over";
  }
  return c;
}

$("#sheetBtn").addEventListener("click", async () => {
  const m = marks.A;
  if (!m) return;
  say("composing…");
  const W = 1800, pad = 48;
  const rows = [];
  const px = nums(S.sizes).slice(0, 8);
  rows.push({ title: "Scale ladder", kind: "scale", items: px });
  rows.push({ title: "Colour variants", kind: "colour" });
  rows.push({ title: "Backgrounds", kind: "bg", items: S.palette.slice(0, 7) });
  rows.push({ title: "Squint test", kind: "blur", items: [0, 2, 5, 9] });
  rows.push({ title: "Colour vision", kind: "cvd", items: ["none", "protanopia", "deuteranopia", "tritanopia", "achromatopsia"] });
  const rowH = 190, headH = 150;
  const c = document.createElement("canvas");
  c.width = W; c.height = headH + rows.length * rowH + pad;
  const x = c.getContext("2d");
  const fg = "#141414", sub = "#6c6c6c";
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = fg;
  x.font = "600 30px Arimo, Helvetica, Arial, sans-serif";
  x.fillText(baseName(), pad, 58);
  x.fillStyle = sub;
  x.font = "16px Arimo, Helvetica, Arial, sans-serif";
  const minPx = minSize(m.stats, S.minfeat);
  x.fillText("aspect " + m.stats.aspect.toFixed(2) + ":1   ·   thinnest 5% of ink " +
    (m.stats.thinP05 / m.stats.refW * 100).toFixed(2) + "% of width   ·   smallest clean size " +
    (minPx || "—") + " px   ·   tested " + new Date().toLocaleDateString(), pad, 86);
  x.fillStyle = "#e6e6e6"; x.fillRect(pad, 110, W - pad * 2, 1);

  let y = headH;
  for (const row of rows) {
    x.fillStyle = sub;
    x.font = "600 13px Arimo, Helvetica, Arial, sans-serif";
    x.fillText(row.title.toUpperCase(), pad, y + 4);
    let cx = pad, boxH = 110;
    const put = (canvasOrImg, w, h, label, bg) => {
      if (bg) { x.fillStyle = bg; x.fillRect(cx, y + 20, Math.max(w, 60) + 24, boxH + 16); }
      x.drawImage(canvasOrImg, cx + 12 + Math.max(0, (Math.max(w, 60) - w) / 2), y + 28 + (boxH - h) / 2, w, h);
      x.fillStyle = sub;
      x.font = "12px Arimo, Helvetica, Arial, sans-serif";
      x.fillText(label, cx + 12, y + boxH + 50);
      cx += Math.max(w, 60) + 44;
    };
    if (row.kind === "scale") {
      for (const w of row.items) put(flatten(m, w, S.ink, null), w, Math.round(w / m.aspect), w + " px");
    } else if (row.kind === "colour") {
      const w = Math.round(boxH * m.aspect * 0.8), h = Math.round(w / m.aspect);
      put(flatten(m, w, null, null), w, h, "original");
      put(flatten(m, w, S.ink, null), w, h, "one colour");
      put(flatten(m, w, S.ink2, S.ink), w, h, "reversed", S.ink);
      const g = flatten(m, w, null, "#ffffff");
      cvdCtx(g.getContext("2d"), g.width, g.height, "achromatopsia");
      put(g, w, h, "greyscale");
      const ob = flatten(m, w, null, "#ffffff");
      thresholdCtx(ob.getContext("2d"), ob.width, ob.height, 0.5, false);
      put(ob, w, h, "one-bit");
    } else if (row.kind === "bg") {
      const w = Math.round(boxH * m.aspect * 0.62), h = Math.round(w / m.aspect);
      for (const bg of row.items) {
        const r = contrastRatio(m.stats.ink, hexToRgb(bg));
        put(flatten(m, w, null, bg), w, h, bg + "  " + r.toFixed(1) + ":1", bg);
      }
    } else if (row.kind === "blur") {
      const w = Math.round(boxH * m.aspect * 0.8), h = Math.round(w / m.aspect);
      for (const b of row.items) {
        const t = document.createElement("canvas");
        t.width = w + 40; t.height = h + 40;
        const tx = t.getContext("2d");
        tx.filter = b ? "blur(" + b + "px)" : "none";
        tx.drawImage(flatten(m, w, S.ink, null), 20, 20);
        put(t, t.width, t.height, b ? b + " px blur" : "sharp");
      }
    } else if (row.kind === "cvd") {
      const w = Math.round(boxH * m.aspect * 0.7), h = Math.round(w / m.aspect);
      for (const k of row.items) {
        const t = flatten(m, w, null, "#ffffff");
        if (k !== "none") cvdCtx(t.getContext("2d"), t.width, t.height, k);
        put(t, w, h, k === "none" ? "typical" : k);
      }
    }
    y += rowH;
  }
  c.toBlob(b => { download(b, baseName() + "-test-sheet.png"); say(""); toast("Test sheet saved"); }, "image/png");
});

const ICON_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024];
$("#iconBtn").addEventListener("click", async () => {
  const m = marks.A;
  if (!m) return;
  const blobs = [];
  for (const s of ICON_SIZES) {
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const x = c.getContext("2d");
    const k = Math.min(s / m.aspect, s) * 0.82;
    x.drawImage(m.img, (s - k * m.aspect) / 2, (s - k) / 2, k * m.aspect, k);
    blobs.push([s, await new Promise(r => c.toBlob(r, "image/png"))]);
  }
  if (window.showDirectoryPicker) {
    try {
      const dir = await window.showDirectoryPicker({ mode: "readwrite" });
      for (const [s, b] of blobs) {
        const fh = await dir.getFileHandle(baseName() + "-" + s + ".png", { create: true });
        const w = await fh.createWritable(); await w.write(b); await w.close();
      }
      toast(blobs.length + " icons saved");
      return;
    } catch (e) { if (e && e.name === "AbortError") return; }
  }
  blobs.forEach(([s, b], i) => setTimeout(() => download(b, baseName() + "-" + s + ".png"), i * 120));
  toast("Saving " + blobs.length + " icons");
});

$("#monoBtn").addEventListener("click", () => {
  const m = marks.A;
  if (!m) return;
  if (m.kind !== "svg") return toast("Mono SVGs need a vector original");
  download(new Blob([monoSVG(m.svgEl, S.ink)], { type: "image/svg+xml" }), baseName() + "-mono.svg");
  setTimeout(() => download(new Blob([monoSVG(m.svgEl, S.ink2)], { type: "image/svg+xml" }),
    baseName() + "-reverse.svg"), 150);
  toast("Mono SVGs saved");
});
