/* Path View, SVG path parsing and curve analysis.
 *
 * Both inputs (a font glyph and an uploaded SVG) end up in the same shape:
 *   contour = { start: [x,y], segs: [ {type, c|c1,c2, to} ], closed }
 * so the renderer never needs to know where the outline came from.
 */
"use strict";

/* ------------------------------------------------------------ SVG input */

const NUM_RE = /[-+]?(\d*\.\d+|\d+\.?)([eE][-+]?\d+)?/g;

function parsePathData(d) {
  const out = [];
  const cmds = String(d).match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) || [];
  let x = 0, y = 0, sx = 0, sy = 0;
  let cur = null, prevC2 = null, prevQ = null;
  const push = seg => { if (cur) cur.segs.push(seg); };
  const open = (nx, ny) => { close(false); cur = { start: [nx, ny], segs: [], closed: false }; };
  const close = (mark) => {
    if (cur && cur.segs.length) { cur.closed = !!mark || cur.closed; out.push(cur); }
    cur = null;
  };
  for (const c of cmds) {
    const code = c[0];
    const rel = code === code.toLowerCase();
    const nums = (c.slice(1).match(NUM_RE) || []).map(Number);
    const up = code.toUpperCase();
    let i = 0;
    const take = n => nums.slice(i, i + n);
    if (up === "Z") {
      // only draw the closing line if the path is not already home, otherwise
      // a path that returns explicitly gets a zero-length segment and a
      // duplicate node sitting on its start
      if (cur) {
        cur.closed = true;
        if (Math.abs(x - sx) > 1e-9 || Math.abs(y - sy) > 1e-9) push({ type: "line", to: [sx, sy] });
      }
      close(true); x = sx; y = sy; continue;
    }
    do {
      if (up === "M") {
        const [ax, ay] = take(2); i += 2;
        x = rel ? x + ax : ax; y = rel ? y + ay : ay;
        if (nums.length > 2 && i > 2) { push({ type: "line", to: [x, y] }); }
        else { open(x, y); sx = x; sy = y; }
        prevC2 = prevQ = null;
      } else if (up === "L") {
        const [ax, ay] = take(2); i += 2;
        x = rel ? x + ax : ax; y = rel ? y + ay : ay;
        push({ type: "line", to: [x, y] }); prevC2 = prevQ = null;
      } else if (up === "H") {
        const ax = nums[i++]; x = rel ? x + ax : ax;
        push({ type: "line", to: [x, y] }); prevC2 = prevQ = null;
      } else if (up === "V") {
        const ay = nums[i++]; y = rel ? y + ay : ay;
        push({ type: "line", to: [x, y] }); prevC2 = prevQ = null;
      } else if (up === "C" || up === "S") {
        let x1, y1, x2, y2, ex, ey;
        if (up === "C") {
          const a = take(6); i += 6;
          x1 = rel ? x + a[0] : a[0]; y1 = rel ? y + a[1] : a[1];
          x2 = rel ? x + a[2] : a[2]; y2 = rel ? y + a[3] : a[3];
          ex = rel ? x + a[4] : a[4]; ey = rel ? y + a[5] : a[5];
        } else {
          const a = take(4); i += 4;
          x1 = prevC2 ? 2 * x - prevC2[0] : x; y1 = prevC2 ? 2 * y - prevC2[1] : y;
          x2 = rel ? x + a[0] : a[0]; y2 = rel ? y + a[1] : a[1];
          ex = rel ? x + a[2] : a[2]; ey = rel ? y + a[3] : a[3];
        }
        push({ type: "cubic", c1: [x1, y1], c2: [x2, y2], to: [ex, ey] });
        prevC2 = [x2, y2]; prevQ = null; x = ex; y = ey;
      } else if (up === "Q" || up === "T") {
        let cx, cy, ex, ey;
        if (up === "Q") {
          const a = take(4); i += 4;
          cx = rel ? x + a[0] : a[0]; cy = rel ? y + a[1] : a[1];
          ex = rel ? x + a[2] : a[2]; ey = rel ? y + a[3] : a[3];
        } else {
          const a = take(2); i += 2;
          cx = prevQ ? 2 * x - prevQ[0] : x; cy = prevQ ? 2 * y - prevQ[1] : y;
          ex = rel ? x + a[0] : a[0]; ey = rel ? y + a[1] : a[1];
        }
        push({ type: "quad", c: [cx, cy], to: [ex, ey] });
        prevQ = [cx, cy]; prevC2 = null; x = ex; y = ey;
      } else if (up === "A") {
        const a = take(7); i += 7;
        const ex = rel ? x + a[5] : a[5], ey = rel ? y + a[6] : a[6];
        arcToCubics(x, y, a[0], a[1], a[2], a[3], a[4], ex, ey).forEach(push);
        x = ex; y = ey; prevC2 = prevQ = null;
      } else break;
    } while (i < nums.length && i > 0);
  }
  close(false);
  return out;
}

// Endpoint-parameterised arc -> cubic segments (SVG implementation notes F.6).
function arcToCubics(x1, y1, rx, ry, rot, large, sweep, x2, y2) {
  if (!rx || !ry) return [{ type: "line", to: [x2, y2] }];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = rot * Math.PI / 180, cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
  const x1p = cosP * dx2 + sinP * dy2, y1p = -sinP * dx2 + cosP * dy2;
  let lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = large !== sweep ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy, len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= Math.PI * 2;
  if (sweep && dth < 0) dth += Math.PI * 2;
  const segs = Math.ceil(Math.abs(dth / (Math.PI / 2)));
  const out = [];
  const delta = dth / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  let th = th1;
  let px = x1, py = y1;
  for (let i = 0; i < segs; i++) {
    const th2 = th + delta;
    const e = a => [cx + rx * Math.cos(a) * cosP - ry * Math.sin(a) * sinP,
                    cy + rx * Math.cos(a) * sinP + ry * Math.sin(a) * cosP];
    const d1 = a => [-rx * Math.sin(a) * cosP - ry * Math.cos(a) * sinP,
                     -rx * Math.sin(a) * sinP + ry * Math.cos(a) * cosP];
    const [ex, ey] = e(th2);
    const [dx1, dy1] = d1(th), [dx2b, dy2b] = d1(th2);
    out.push({ type: "cubic", c1: [px + t * dx1, py + t * dy1], c2: [ex - t * dx2b, ey - t * dy2b], to: [ex, ey] });
    px = ex; py = ey; th = th2;
  }
  return out;
}

function applyMatrix(contours, m) {
  const tx = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  return contours.map(c => ({
    start: tx(c.start[0], c.start[1]),
    closed: c.closed,
    segs: c.segs.map(s => {
      const o = { type: s.type, to: tx(s.to[0], s.to[1]) };
      if (s.c) o.c = tx(s.c[0], s.c[1]);
      if (s.c1) { o.c1 = tx(s.c1[0], s.c1[1]); o.c2 = tx(s.c2[0], s.c2[1]); }
      return o;
    }),
  }));
}

function parseTransform(str) {
  let m = [1, 0, 0, 1, 0, 0];
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g;
  let m2;
  while ((m2 = re.exec(str || ""))) {
    const v = (m2[2].match(NUM_RE) || []).map(Number);
    if (m2[1] === "matrix" && v.length === 6) m = mul(m, v);
    else if (m2[1] === "translate") m = mul(m, [1, 0, 0, 1, v[0] || 0, v[1] || 0]);
    else if (m2[1] === "scale") m = mul(m, [v[0] || 1, 0, 0, v.length > 1 ? v[1] : (v[0] || 1), 0, 0]);
    else if (m2[1] === "rotate") {
      const a = (v[0] || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      if (v.length >= 3) {
        m = mul(m, [1, 0, 0, 1, v[1], v[2]]);
        m = mul(m, [c, s, -s, c, 0, 0]);
        m = mul(m, [1, 0, 0, 1, -v[1], -v[2]]);
      } else m = mul(m, [c, s, -s, c, 0, 0]);
    }
  }
  return m;
}

// Basic shapes carry outlines too, and designers export them constantly.
function shapeToPath(el) {
  const n = el.nodeName.toLowerCase();
  const f = a => parseFloat(el.getAttribute(a) || 0);
  if (n === "rect") {
    const x = f("x"), y = f("y"), w = f("width"), h = f("height");
    // Rounded corners, per the SVG spec: a missing radius copies the other,
    // and each is clamped to half the side.
    let rx = el.hasAttribute("rx") ? f("rx") : NaN, ry = el.hasAttribute("ry") ? f("ry") : NaN;
    if (isNaN(rx)) rx = isNaN(ry) ? 0 : ry;
    if (isNaN(ry)) ry = rx;
    rx = Math.min(Math.max(rx, 0), w / 2); ry = Math.min(Math.max(ry, 0), h / 2);
    if (!rx || !ry) return "M" + x + "," + y + "h" + w + "v" + h + "h" + (-w) + "Z";
    const a = (dx, dy) => "a" + rx + "," + ry + " 0 0 1 " + dx + "," + dy;
    return "M" + (x + rx) + "," + y + "h" + (w - 2 * rx) + a(rx, ry) + "v" + (h - 2 * ry) + a(-rx, ry) +
           "h" + (-(w - 2 * rx)) + a(-rx, -ry) + "v" + (-(h - 2 * ry)) + a(rx, -ry) + "Z";
  }
  if (n === "circle" || n === "ellipse") {
    const cx = f("cx"), cy = f("cy");
    const rx = n === "circle" ? f("r") : f("rx"), ry = n === "circle" ? f("r") : f("ry");
    return "M" + (cx - rx) + "," + cy + "a" + rx + "," + ry + " 0 1 0 " + (rx * 2) + ",0" +
           "a" + rx + "," + ry + " 0 1 0 " + (-rx * 2) + ",0Z";
  }
  if (n === "line") return "M" + f("x1") + "," + f("y1") + "L" + f("x2") + "," + f("y2");
  if (n === "polygon" || n === "polyline") {
    const pts = (el.getAttribute("points") || "").match(NUM_RE) || [];
    if (pts.length < 4) return "";
    let d = "M" + pts[0] + "," + pts[1];
    for (let i = 2; i + 1 < pts.length; i += 2) d += "L" + pts[i] + "," + pts[i + 1];
    return d + (n === "polygon" ? "Z" : "");
  }
  return "";
}

function parseSVG(text) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("That file isn't valid SVG.");
  const svg = doc.documentElement;
  svg.querySelectorAll("script, foreignObject").forEach(n => n.remove());
  const out = [];
  const walk = (el, m) => {
    const own = parseTransform(el.getAttribute && el.getAttribute("transform"));
    const mm = [m[0] * own[0] + m[2] * own[1], m[1] * own[0] + m[3] * own[1],
      m[0] * own[2] + m[2] * own[3], m[1] * own[2] + m[3] * own[3],
      m[0] * own[4] + m[2] * own[5] + m[4], m[1] * own[4] + m[3] * own[5] + m[5]];
    const name = el.nodeName ? el.nodeName.toLowerCase() : "";
    let d = "";
    if (name === "path") d = el.getAttribute("d") || "";
    else d = shapeToPath(el);
    if (d) applyMatrix(parsePathData(d), mm).forEach(c => out.push(c));
    Array.from(el.children || []).forEach(ch => walk(ch, mm));
  };
  walk(svg, [1, 0, 0, 1, 0, 0]);
  if (!out.length) throw new Error("No outlines found in that SVG. Live text must be converted to outlines first.");
  const vb = (svg.getAttribute("viewBox") || "").match(NUM_RE);
  return { contours: out, viewBox: vb && vb.length === 4 ? vb.map(Number) : null };
}

/* ------------------------------------------------------------- analysis */

function contourBounds(contours) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  for (const c of contours) {
    see(c.start[0], c.start[1]);
    for (const s of c.segs) {
      see(s.to[0], s.to[1]);
      if (s.c) see(s.c[0], s.c[1]);
      if (s.c1) { see(s.c1[0], s.c1[1]); see(s.c2[0], s.c2[1]); }
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1, minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, minX, minY, maxX, maxY };
}

const cubeAt = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};
const quadAt = (p0, p1, p2, t) => { const u = 1 - t; return u * u * p0 + 2 * u * t * p1 + t * t * p2; };

// Where a curve runs horizontal or vertical part-way along, the place a type
// designer puts an on-curve point. `tol` absorbs integer rounding: a critical
// point within `tol` of one of the segment's own end coordinates is the end
// point doing the job, not a missing extreme.
function segExtrema(from, s, tol) {
  tol = tol || 0;
  const roots = [];
  const add = (t, k) => { if (t > 1e-6 && t < 1 - 1e-6) roots.push([t, k]); };
  if (s.type === "cubic") {
    for (const k of [0, 1]) {
      // derivative of the cubic is the quadratic A t² + B t + C
      const p0 = from[k], p1 = s.c1[k], p2 = s.c2[k], p3 = s.to[k];
      const A = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
      const B = 6 * (p0 - 2 * p1 + p2);
      const C = 3 * (p1 - p0);
      if (Math.abs(A) < 1e-12) { if (Math.abs(B) > 1e-12) add(-C / B, k); }
      else {
        const disc = B * B - 4 * A * C;
        if (disc >= 0) { const r = Math.sqrt(disc); add((-B + r) / (2 * A), k); add((-B - r) / (2 * A), k); }
      }
    }
  } else if (s.type === "quad") {
    for (const k of [0, 1]) {
      const den = from[k] - 2 * s.c[k] + s.to[k];
      if (Math.abs(den) > 1e-12) add((from[k] - s.c[k]) / den, k);
    }
  }
  const out = [];
  for (const [t, k] of roots) {
    const pt = s.type === "cubic"
      ? [cubeAt(from[0], s.c1[0], s.c2[0], s.to[0], t), cubeAt(from[1], s.c1[1], s.c2[1], s.to[1], t)]
      : [quadAt(from[0], s.c[0], s.to[0], t), quadAt(from[1], s.c[1], s.to[1], t)];
    if (Math.abs(pt[k] - from[k]) <= tol || Math.abs(pt[k] - s.to[k]) <= tol) continue;
    out.push(pt);
  }
  return out;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const EPS = 1e-6;

// The direction a segment leaves its start in: toward its first control point,
// or, when that handle is retracted onto the node, the next point along.
function leaveDir(from, s) {
  const pts = s.type === "cubic" ? [s.c1, s.c2, s.to] : s.type === "quad" ? [s.c, s.to] : [s.to];
  for (const p of pts) if (dist(p, from) > EPS) return { dx: p[0] - from[0], dy: p[1] - from[1], len: dist(p, from) };
  return null;
}
// The direction a segment arrives at its end from.
function arriveDir(from, s) {
  const pts = s.type === "cubic" ? [s.c2, s.c1, from] : s.type === "quad" ? [s.c, from] : [from];
  for (const p of pts) if (dist(p, s.to) > EPS) return { dx: s.to[0] - p[0], dy: s.to[1] - p[1], len: dist(p, s.to) };
  return null;
}

// Walk a contour into on-curve nodes, each with the handles either side.
// A node is smooth when the path is tangent-continuous through it, which is
// how Glyphs treats it, so a straight line flowing into a curve along the
// same direction counts, not only a node with two collinear handles.
function contourNodes(c) {
  const segs = c.segs, n = segs.length;
  const lastTo = n ? segs[n - 1].to : c.start;
  const returns = n > 0 && dist(lastTo, c.start) < EPS;
  const count = returns ? n : n + 1;
  const pts = [c.start];
  for (let i = 0; i < n; i++) pts.push(segs[i].to);
  const handleOut = s => !s ? null : s.type === "cubic" ? s.c1 : s.type === "quad" ? s.c : null;
  const handleIn = s => !s ? null : s.type === "cubic" ? s.c2 : s.type === "quad" ? s.c : null;
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const segOut = i < n ? segs[i] : null;
    const segIn = i > 0 ? segs[i - 1] : (returns ? segs[n - 1] : null);
    const inFrom = i > 0 ? pts[i - 1] : (returns ? pts[n - 1] : null);
    const pt = pts[i];
    const inH = handleIn(segIn), outH = handleOut(segOut);
    const node = {
      pt: pt.slice(),
      inH: inH ? inH.slice() : null,
      outH: outH ? outH.slice() : null,
      // a handle sitting on its own node is not drawn, as in a type editor
      inRetracted: !!inH && dist(inH, pt) < EPS,
      outRetracted: !!outH && dist(outH, pt) < EPS,
      implied: i === 0 ? !!c.startImplied : !!segs[i - 1].implied,
      start: i === 0,
      end: !segIn || !segOut,
      smooth: false,
      // tangent directions through the node, for drawing open-path ends
      dirIn: segIn ? arriveDir(inFrom, segIn) : null,
      dirOut: segOut ? leaveDir(pt, segOut) : null,
    };
    if (segIn && segOut) {
      const a = arriveDir(inFrom, segIn), b = leaveDir(pt, segOut);
      if (a && b) {
        let d = Math.abs(Math.atan2(a.dy, a.dx) - Math.atan2(b.dy, b.dx));
        if (d > Math.PI) d = Math.PI * 2 - d;
        // ~1° plus what rounding to whole units can bend a handle of that length
        const tol = Math.min(0.06, 0.0175 + 0.5 / a.len + 0.5 / b.len);
        node.smooth = d < tol;
      }
    }
    node.kind = node.end ? "end" : node.smooth ? "smooth" : "corner";
    nodes.push(node);
  }
  return nodes;
}

// Position and tangent part-way along a segment.
function segPointAt(from, s, t) {
  if (s.type === "line") return [from[0] + (s.to[0] - from[0]) * t, from[1] + (s.to[1] - from[1]) * t];
  if (s.type === "quad") return [quadAt(from[0], s.c[0], s.to[0], t), quadAt(from[1], s.c[1], s.to[1], t)];
  return [cubeAt(from[0], s.c1[0], s.c2[0], s.to[0], t), cubeAt(from[1], s.c1[1], s.c2[1], s.to[1], t)];
}
function segTangentAt(from, s, t) {
  const u = 1 - t;
  if (s.type === "line") return [s.to[0] - from[0], s.to[1] - from[1]];
  if (s.type === "quad") return [0, 1].map(k => 2 * u * (s.c[k] - from[k]) + 2 * t * (s.to[k] - s.c[k]));
  return [0, 1].map(k => 3 * u * u * (s.c1[k] - from[k]) + 6 * u * t * (s.c2[k] - s.c1[k]) + 3 * t * t * (s.to[k] - s.c2[k]));
}

/* --------------------------------------------------- contour direction */

function flatten(c, steps) {
  steps = steps || 8;
  const out = [c.start];
  let from = c.start;
  for (const s of c.segs) {
    if (s.type === "line") out.push(s.to);
    else for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      out.push(s.type === "cubic"
        ? [cubeAt(from[0], s.c1[0], s.c2[0], s.to[0], t), cubeAt(from[1], s.c1[1], s.c2[1], s.to[1], t)]
        : [quadAt(from[0], s.c[0], s.to[0], t), quadAt(from[1], s.c[1], s.to[1], t)]);
    }
    from = s.to;
  }
  return out;
}
function insidePoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// Which way each closed contour runs, and whether that is the right way.
// Coordinates here are screen-space (y down), so y is negated to judge
// direction as the letter is seen. Glyphs and PostScript wind outer contours
// counter-clockwise and counters clockwise; TrueType does the opposite.
function contourDirections(contours, convention) {
  const polys = contours.map(c => c.closed === false ? null : flatten(c, 10));
  return contours.map((c, i) => {
    const poly = polys[i];
    if (!poly || poly.length < 3) return { closed: false };
    let area = 0;
    for (let k = 0; k < poly.length - 1; k++)
      area += poly[k][0] * -poly[k + 1][1] - poly[k + 1][0] * -poly[k][1];
    area /= 2;
    const probe = [(poly[0][0] + poly[1][0]) / 2, (poly[0][1] + poly[1][1]) / 2];
    let depth = 0;
    polys.forEach((q, j) => { if (j !== i && q && q.length > 2 && insidePoly(probe, q)) depth++; });
    const ccw = area > 0;
    const outer = depth % 2 === 0;
    const wantCCW = convention === "tt" ? !outer : outer;
    return { closed: true, ccw, depth, outer, area, wrong: Math.abs(area) > 1e-9 && ccw !== wantCCW };
  });
}

function analysePaths(contours, opts) {
  opts = opts || {};
  let on = 0, off = 0, lines = 0, quads = 0, cubics = 0, smooth = 0, implied = 0, ends = 0;
  const extrema = [];
  for (const c of contours) {
    const nodes = contourNodes(c);
    const real = nodes.filter(n => !n.implied);
    on += real.length;
    implied += nodes.length - real.length;
    smooth += real.filter(n => n.smooth).length;
    ends += real.filter(n => n.end).length;
    let from = c.start;
    for (const s of c.segs) {
      if (s.type === "line") lines++;
      else if (s.type === "quad") { quads++; off += 1; }
      else { cubics++; off += 2; }
      segExtrema(from, s, opts.tol).forEach(p => extrema.push(p));
      from = s.to;
    }
  }
  const dirs = contourDirections(contours, opts.convention || "ps");
  return { contours: contours.length, on, off, lines, quads, cubics, smooth, implied, ends,
           corners: on - smooth - ends, missingExtrema: extrema.length, extrema,
           reversed: dirs.filter(d => d.wrong).length, directions: dirs };
}

if (typeof module !== "undefined")
  module.exports = { parsePathData, arcToCubics, contourBounds, contourNodes, analysePaths,
                     segExtrema, contourDirections, segPointAt, segTangentAt };
