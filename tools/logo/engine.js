/* Logo Tester — loading, measurement and the canvas-side tests.
 *
 * The board itself is plain DOM: a logo drawn as a CSS mask recolours and
 * scales more crisply than anything redrawn into a canvas, and CSS filters
 * cover blur, greyscale and the colour-vision simulations. Canvas is used
 * where pixels are genuinely the point — measuring the mark, the 1-bit and
 * pixelation tests, and composing the exported sheet.
 *
 * Nothing here touches the DOM at load time, so the maths runs under Node too.
 */
"use strict";

/* ------------------------------------------------------------ colour */

function hexToRgb(hex) {
  let h = String(hex || "#000").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = c => "#" + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

const srgbToLin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };

function relLuminance(rgb) {
  return 0.2126 * srgbToLin(rgb[0]) + 0.7152 * srgbToLin(rgb[1]) + 0.0722 * srgbToLin(rgb[2]);
}

// WCAG 2.1 contrast. For a logo the number to beat is 3:1 — the non-text
// threshold — not the 4.5:1 that applies to body copy.
function contrastRatio(a, b) {
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function contrastVerdict(ratio) {
  if (ratio >= 4.5) return { label: "strong", cls: "ok" };
  if (ratio >= 3) return { label: "passes 3:1", cls: "ok" };
  if (ratio >= 2) return { label: "weak", cls: "warn" };
  return { label: "fails", cls: "bad" };
}

// Composite a colour with alpha over an opaque background.
function over(fg, bg, alpha) {
  return [0, 1, 2].map(i => fg[i] * alpha + bg[i] * (1 - alpha));
}

/* Colour-vision simulations. Linear-RGB matrices of the usual Viénot /
 * Brettel flavour — an approximation, but the one most design tools show. */
const CVD = {
  protanopia:    [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
  deuteranopia:  [0.625, 0.375, 0, 0.700, 0.300, 0, 0, 0.300, 0.700],
  tritanopia:    [0.950, 0.050, 0, 0, 0.433, 0.567, 0, 0.475, 0.525],
  achromatopsia: [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114],
};
const CVD_LABELS = {
  protanopia: "Protanopia — no red cones (~1% of men)",
  deuteranopia: "Deuteranopia — no green cones (~1% of men)",
  tritanopia: "Tritanopia — no blue cones (rare)",
  achromatopsia: "Achromatopsia — no colour at all",
};

function applyMatrix(rgb, m) {
  return [
    m[0] * rgb[0] + m[1] * rgb[1] + m[2] * rgb[2],
    m[3] * rgb[0] + m[4] * rgb[1] + m[5] * rgb[2],
    m[6] * rgb[0] + m[7] * rgb[1] + m[8] * rgb[2],
  ];
}

/* ------------------------------------------------------------ SVG side */

// Strip anything that executes or phones home. The file came off the user's
// disk, but it is still markup we are about to inline into the page.
function sanitizeSVG(text) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  const svg = doc.documentElement;
  if (err || !svg || svg.nodeName.toLowerCase() !== "svg") return null;
  svg.querySelectorAll("script, foreignObject").forEach(n => n.remove());
  const walk = doc.createTreeWalker(svg, NodeFilter.SHOW_ELEMENT);
  const kill = [];
  for (let n = svg; n; n = walk.nextNode()) {
    for (const at of Array.from(n.attributes || [])) {
      const name = at.name.toLowerCase(), val = String(at.value || "");
      if (name.startsWith("on")) kill.push([n, at.name]);
      else if ((name === "href" || name === "xlink:href") && /^\s*(javascript|data:text\/html)/i.test(val))
        kill.push([n, at.name]);
    }
  }
  kill.forEach(([n, a]) => n.removeAttribute(a));
  return svg;
}

function parseLogoSVG(text) {
  const svg = sanitizeSVG(text);
  if (!svg) return { ok: false, error: "That file isn't valid SVG." };
  let w = parseFloat(svg.getAttribute("width")) || 0;
  let h = parseFloat(svg.getAttribute("height")) || 0;
  const vb = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(v => isFinite(v))) {
    if (!w) w = vb[2];
    if (!h) h = vb[3];
  } else if (w && h) {
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
  }
  if (!w || !h) { w = w || 300; h = h || 300; }
  // Let CSS size it; the viewBox carries the proportions.
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const notes = [];
  if (svg.querySelector("text, tspan"))
    notes.push("The SVG contains live text. Convert type to outlines, or it will " +
               "render differently on a machine without the font.");
  if (svg.querySelector("image"))
    notes.push("The SVG embeds a bitmap image, so it will not scale like true vector art.");
  if (svg.querySelector("filter, feGaussianBlur"))
    notes.push("The SVG uses filter effects. These often drop out in print workflows.");
  return { ok: true, svg, markup: new XMLSerializer().serializeToString(svg), w, h, notes };
}

// Apostrophes survive encodeURIComponent, and the URL gets quoted with single
// quotes inside a style attribute — so encode them here rather than hope.
function svgURL(markup) {
  return "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(markup).replace(/'/g, "%27");
}

// A copy of the mark with every paint forced to one colour, for the
// silhouette test and for the mono files the export writes out.
function monoSVG(svgEl, colour) {
  const clone = svgEl.cloneNode(true);
  const all = [clone].concat(Array.from(clone.querySelectorAll("*")));
  for (const el of all) {
    const tag = el.nodeName.toLowerCase();
    if (["defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "title", "desc"].includes(tag))
      continue;
    const style = el.getAttribute("style");
    if (style) {
      el.setAttribute("style", style
        .replace(/fill\s*:\s*[^;]+/gi, m => /none/i.test(m) ? m : "fill:" + colour)
        .replace(/stroke\s*:\s*[^;]+/gi, m => /none/i.test(m) ? m : "stroke:" + colour));
    }
    const f = el.getAttribute("fill");
    if (f !== null && !/^none$/i.test(f)) el.setAttribute("fill", colour);
    const s = el.getAttribute("stroke");
    if (s !== null && !/^none$/i.test(s)) el.setAttribute("stroke", colour);
    if (f === null && s === null && ["path", "circle", "rect", "ellipse", "polygon", "polyline", "g", "svg", "use"].includes(tag))
      el.setAttribute("fill", colour);
  }
  return new XMLSerializer().serializeToString(clone);
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("could not render that image"));
    img.src = src;
  });
}

/* ------------------------------------------------------- measurement */

// Rasterise the mark big, then measure the bitmap: it is the only way that
// treats SVG and PNG logos alike, and it is what the eye actually gets.
const REF = 900;

function rasterise(img, aspect) {
  const w = REF, h = Math.max(1, Math.round(REF / aspect));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.clearRect(0, 0, w, h);
  x.drawImage(img, 0, 0, w, h);
  return { canvas: c, ctx: x, w, h };
}

// Chebyshev distance to the nearest transparent pixel, by repeated erosion.
// Each ink pixel ends up labelled with how many rounds it survived, which is
// half its local stroke width in reference pixels.
function distanceMap(mask, w, h, maxR) {
  const dist = new Uint16Array(w * h);
  let cur = mask, next = new Uint8Array(w * h);
  let alive = 0;
  for (let i = 0; i < w * h; i++) if (cur[i]) alive++;
  for (let r = 1; r <= maxR && alive; r++) {
    alive = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!cur[i]) { next[i] = 0; continue; }
        let keep = 1;
        for (let dy = -1; dy <= 1 && keep; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) { keep = 0; break; }
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w || !cur[yy * w + xx]) { keep = 0; break; }
          }
        }
        next[i] = keep;
        if (keep) { dist[i] = r; alive++; }
      }
    }
    const t = cur === mask ? new Uint8Array(w * h) : cur;
    cur = next; next = t;
  }
  return dist;
}

function analyse(img, aspect) {
  const { ctx, w, h } = rasterise(img, aspect);
  const d = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  let ink = 0, minX = w, minY = h, maxX = -1, maxY = -1;
  let sr = 0, sg = 0, sb = 0, sa = 0;
  // Colours are bucketed coarsely to group antialiasing and gradients, but each
  // bucket reports the mean of the pixels in it — a bucket's own corner value
  // is a colour that may appear nowhere in the artwork.
  const buckets = new Map();
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const a = d[i * 4 + 3] / 255;
    if (a < 0.5) continue;
    mask[i] = 1; ink++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    sr += r * a; sg += g * a; sb += b * a; sa += a;
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    let e = buckets.get(key);
    if (!e) buckets.set(key, e = { n: 0, r: 0, g: 0, b: 0 });
    e.n++; e.r += r; e.g += g; e.b += b;
  }
  if (!ink) return { ok: false, error: "The file rendered empty — nothing to test." };

  const bboxW = maxX - minX + 1, bboxH = maxY - minY + 1;
  const dist = distanceMap(mask, w, h, 40);
  const widths = [];
  for (let i = 0; i < w * h; i++) if (mask[i]) widths.push(dist[i] * 2);
  widths.sort((a, b) => a - b);
  const pct = p => widths[Math.min(widths.length - 1, Math.floor(widths.length * p))] || 0;

  const palette = Array.from(buckets.values())
    .map(e => ({ rgb: [e.r / e.n, e.g / e.n, e.b / e.n].map(Math.round), share: e.n / ink }))
    .filter(e => e.share >= 0.02)
    .sort((a, b) => b.share - a.share).slice(0, 6)
    .map(e => ({ hex: rgbToHex(e.rgb), rgb: e.rgb, share: e.share }));

  return {
    ok: true,
    refW: w, refH: h,
    ink: [sr / sa, sg / sa, sb / sa].map(Math.round),
    inkMain: palette.length ? palette[0].rgb : [sr / sa, sg / sa, sb / sa].map(Math.round),
    coverage: ink / (bboxW * bboxH),
    bbox: { x: minX, y: minY, w: bboxW, h: bboxH },
    trim: { left: minX / w, right: (w - 1 - maxX) / w, top: minY / h, bottom: (h - 1 - maxY) / h },
    aspect: bboxW / bboxH,
    thinP05: pct(0.05), thinP25: pct(0.25), thinP50: pct(0.5),
    thickest: widths[widths.length - 1] || 0,
    palette,
  };
}

// Worst contrast any substantial colour in the mark makes against a background.
// A multicolour logo is only as legible as its weakest colour, and averaging
// the colours together invents one that is in none of them.
function worstContrast(stats, bgRgb) {
  const sig = (stats.palette || []).filter(p => p.share >= 0.08);
  const list = sig.length ? sig : [{ rgb: stats.inkMain, share: 1 }];
  let worst = null;
  for (const p of list) {
    const r = contrastRatio(p.rgb, bgRgb);
    if (!worst || r < worst.ratio) worst = { ratio: r, rgb: p.rgb, hex: rgbToHex(p.rgb) };
  }
  return worst;
}

// Smallest rendered width at which the thinnest 5% of the mark still carries
// `minPx` of ink. Below it, hairlines drop out — on screen they vanish into
// antialiasing, in print they break up.
function minSize(stats, minPx) {
  if (!stats || !stats.thinP05) return null;
  return Math.ceil(stats.refW * minPx / stats.thinP05);
}

/* -------------------------------------------------------- pixel tests */

function drawFitted(ctx, img, bx, by, bw, bh, aspect) {
  const k = Math.min(bw / aspect, bh);
  const w = k * aspect, h = k;
  ctx.drawImage(img, bx + (bw - w) / 2, by + (bh - h) / 2, w, h);
  return { x: bx + (bw - w) / 2, y: by + (bh - h) / 2, w, h };
}

function thresholdCtx(ctx, w, h, level, dither) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const t = dither ? BAYER[(y & 3) * 4 + (x & 3)] : level;
    const on = dither ? v > t * (level * 2) : v > t;
    d[i] = d[i + 1] = d[i + 2] = on ? 255 : 0;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function cvdCtx(ctx, w, h, type) {
  const m = CVD[type];
  if (!m) return;
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const o = applyMatrix([d[i], d[i + 1], d[i + 2]], m);
    d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2];
  }
  ctx.putImageData(img, 0, 0);
}

if (typeof module !== "undefined") {
  module.exports = { hexToRgb, rgbToHex, relLuminance, contrastRatio, contrastVerdict,
    CVD, CVD_LABELS, applyMatrix, over, minSize };
}
