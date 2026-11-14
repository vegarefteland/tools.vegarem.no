/* Path View — a font parser, enough of one to get real outlines.
 *
 * The browser will happily draw text but will not tell you where the points
 * are, and that is the whole subject here. So this reads the font file: the
 * `glyf` table for TrueType curves (quadratic, one control point) and the
 * `CFF ` charstrings for PostScript curves (cubic, two). What comes out is the
 * designer's own point structure, not an approximation traced off a bitmap.
 *
 * Runs in Node as well as the browser, so the parser can be tested directly.
 */
"use strict";

function Reader(buf) {
  this.d = buf instanceof DataView ? buf : new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  this.p = 0;
}
Reader.prototype = {
  seek(p) { this.p = p; return this; },
  u8() { return this.d.getUint8(this.p++); },
  i8() { return this.d.getInt8(this.p++); },
  u16() { const v = this.d.getUint16(this.p); this.p += 2; return v; },
  i16() { const v = this.d.getInt16(this.p); this.p += 2; return v; },
  u32() { const v = this.d.getUint32(this.p); this.p += 4; return v; },
  i32() { const v = this.d.getInt32(this.p); this.p += 4; return v; },
  tag() { let s = ""; for (let i = 0; i < 4; i++) s += String.fromCharCode(this.u8()); return s; },
  bytes(n) { const v = new Uint8Array(this.d.buffer, this.d.byteOffset + this.p, n); this.p += n; return v; },
};

class FontError extends Error {}

/* ------------------------------------------------------------- container */

// A collection (.ttc) is several fonts sharing tables; each has its own
// directory at an offset listed in the header.
function collectionOffsets(r) {
  r.seek(0);
  if (r.u32() !== 0x74746366) return null;
  r.u32();
  const n = r.u32();
  const offs = [];
  for (let i = 0; i < n; i++) offs.push(r.u32());
  return offs;
}

function postscriptNameAt(r, tables) {
  const t = tables.name;
  if (!t) return "";
  r.seek(t.off);
  r.u16();
  const count = r.u16(), strOff = r.u16();
  for (let i = 0; i < count; i++) {
    const pid = r.u16();
    r.u16(); r.u16();
    const nid = r.u16(), len = r.u16(), off = r.u16();
    if (nid !== 6) continue;
    const save = r.p;
    r.seek(t.off + strOff + off);
    let s = "";
    if (pid === 3 || pid === 0) for (let k = 0; k < len / 2; k++) s += String.fromCharCode(r.u16());
    else for (let k = 0; k < len; k++) s += String.fromCharCode(r.u8());
    r.seek(save);
    return s;
  }
  return "";
}

function tableDirectory(r, base) {
  r.seek(base);
  const ver = r.u32();
  if (ver === 0x74746366) throw new FontError("Font collections need a font chosen from inside them.");
  if (ver !== 0x00010000 && ver !== 0x4F54544F && ver !== 0x74727565)
    throw new FontError("Not a font file this tool understands.");
  const num = r.u16();
  r.p += 6;
  const tables = {};
  for (let i = 0; i < num; i++) {
    const tag = r.tag();
    r.u32();
    const off = r.u32(), len = r.u32();
    tables[tag] = { off, len };
  }
  return tables;
}

// WOFF is the same tables, individually deflated. WOFF2 is not: it reorders and
// transforms the glyf table and needs Brotli, which is a project of its own.
function unwrapWOFF(bytes, inflate) {
  const r = new Reader(bytes);
  const sig = r.u32();
  if (sig === 0x774F4632) throw new FontError("WOFF2 is not supported — use the .ttf, .otf or .woff.");
  if (sig !== 0x774F4646) return null;
  r.u32();                      // flavour
  r.u32();                      // length
  const num = r.u16();
  // reserved, totalSfntSize, major, minor, then five u32s: meta offset,
  // meta length, meta original length, private offset, private length
  r.p += 2 + 4 + 2 + 2 + 4 * 5;
  const out = { tables: {}, data: {} };
  for (let i = 0; i < num; i++) {
    const tag = r.tag();
    const off = r.u32(), comp = r.u32(), orig = r.u32();
    r.u32();
    const raw = bytes.subarray(off, off + comp);
    let data;
    if (comp === orig) data = raw;
    else {
      if (!inflate) throw new FontError("This .woff needs the inflate library, which did not load.");
      data = inflate(raw);
    }
    out.tables[tag] = { off: 0, len: orig };
    out.data[tag] = data instanceof Uint8Array ? data : new Uint8Array(data);
  }
  return out;
}

/* ------------------------------------------------------------------ cmap */

function parseCmap(r, off) {
  r.seek(off);
  r.u16();
  const n = r.u16();
  let best = 0, bestScore = -1;
  for (let i = 0; i < n; i++) {
    const pid = r.u16(), eid = r.u16(), sub = r.u32();
    // prefer a full Unicode table, then BMP
    const score = (pid === 3 && eid === 10) ? 5 : (pid === 3 && eid === 1) ? 4
      : (pid === 0) ? 3 : (pid === 3 && eid === 0) ? 2 : 1;
    if (score > bestScore) { bestScore = score; best = off + sub; }
  }
  if (!best) return new Map();
  r.seek(best);
  const fmt = r.u16();
  const map = new Map();
  if (fmt === 4) {
    r.u16(); r.u16();
    const segX2 = r.u16();
    const seg = segX2 / 2;
    r.p += 6;
    const ends = [], starts = [], deltas = [], rangeOffsets = [];
    for (let i = 0; i < seg; i++) ends.push(r.u16());
    r.u16();
    for (let i = 0; i < seg; i++) starts.push(r.u16());
    for (let i = 0; i < seg; i++) deltas.push(r.i16());
    const roBase = r.p;
    for (let i = 0; i < seg; i++) rangeOffsets.push(r.u16());
    for (let i = 0; i < seg; i++) {
      for (let c = starts[i]; c <= ends[i] && c !== 0xFFFF; c++) {
        let g;
        if (rangeOffsets[i] === 0) g = (c + deltas[i]) & 0xFFFF;
        else {
          const gp = roBase + i * 2 + rangeOffsets[i] + (c - starts[i]) * 2;
          r.seek(gp);
          g = r.u16();
          if (g) g = (g + deltas[i]) & 0xFFFF;
        }
        if (g) map.set(c, g);
      }
    }
  } else if (fmt === 12) {
    r.p += 2 + 4 + 4;
    const groups = r.u32();
    for (let i = 0; i < groups; i++) {
      const s = r.u32(), e = r.u32(), g = r.u32();
      for (let c = s; c <= e && c - s < 0x10000; c++) map.set(c, g + (c - s));
    }
  } else if (fmt === 6) {
    r.u16(); r.u16();
    const first = r.u16(), count = r.u16();
    for (let i = 0; i < count; i++) map.set(first + i, r.u16());
  }
  return map;
}

/* ------------------------------------------------------------------ glyf */

// TrueType stores quadratic curves and omits on-curve points that sit exactly
// between two control points, so they have to be put back.
function parseGlyf(r, start, end, font, depth) {
  if (end <= start) return { contours: [], advance: 0 };
  r.seek(start);
  const nc = r.i16();
  r.p += 8;
  if (nc < 0) return parseComposite(r, font, depth || 0);

  const endPts = [];
  for (let i = 0; i < nc; i++) endPts.push(r.u16());
  const nPts = nc ? endPts[nc - 1] + 1 : 0;
  // Read the length first: `r.p += r.u16()` would capture r.p before the read
  // advanced it, silently dropping these two bytes and misaligning every flag.
  const instructionLength = r.u16();
  r.p += instructionLength;                         // skip hinting

  const flags = new Uint8Array(nPts);
  for (let i = 0; i < nPts;) {
    const f = r.u8();
    flags[i++] = f;
    if (f & 8) { let rep = r.u8(); while (rep-- > 0 && i < nPts) flags[i++] = f; }
  }
  const xs = new Int16Array(nPts), ys = new Int16Array(nPts);
  let v = 0;
  for (let i = 0; i < nPts; i++) {
    const f = flags[i];
    if (f & 2) { const d = r.u8(); v += (f & 16) ? d : -d; }
    else if (!(f & 16)) v += r.i16();
    xs[i] = v;
  }
  v = 0;
  for (let i = 0; i < nPts; i++) {
    const f = flags[i];
    if (f & 4) { const d = r.u8(); v += (f & 32) ? d : -d; }
    else if (!(f & 32)) v += r.i16();
    ys[i] = v;
  }

  const contours = [];
  let s = 0;
  for (let c = 0; c < nc; c++) {
    const e = endPts[c];
    const pts = [];
    for (let i = s; i <= e; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
    s = e + 1;
    if (pts.length) contours.push(quadContour(pts));
  }
  return { contours };
}

function quadContour(pts) {
  const segs = [];
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true, implied: true });
  // find a starting on-curve point, inventing one if the contour has none
  // `ordered` is every point after the start and not the start itself — the
  // close below brings the contour home exactly once. (Visiting the start
  // again here used to add a zero-length segment and a duplicate node.)
  const startIdx = pts.findIndex(p => p.on);
  let start, ordered;
  if (startIdx < 0) {
    // no on-curve point at all: the start is implied between last and first
    start = mid(pts[pts.length - 1], pts[0]);
    ordered = pts.slice();
  } else {
    start = pts[startIdx];
    ordered = [];
    for (let i = 1; i < pts.length; i++) ordered.push(pts[(startIdx + i) % pts.length]);
  }

  // Midpoints the file never stored are marked `implied`: font editors hide
  // them and draw the off-curve points chained together instead.
  let cur = start, ctrl = null;
  for (const p of ordered) {
    if (p.on) {
      if (ctrl) { segs.push({ type: "quad", c: [ctrl.x, ctrl.y], to: [p.x, p.y] }); ctrl = null; }
      else segs.push({ type: "line", to: [p.x, p.y] });
      cur = p;
    } else {
      if (ctrl) {
        const m = mid(ctrl, p);
        segs.push({ type: "quad", c: [ctrl.x, ctrl.y], to: [m.x, m.y], implied: true });
        cur = m;
      }
      ctrl = p;
    }
  }
  void cur;
  if (ctrl) segs.push({ type: "quad", c: [ctrl.x, ctrl.y], to: [start.x, start.y], implied: !!start.implied });
  else if (segs.length) {
    // fonts sometimes repeat the first point at the end; don't close onto it twice
    const last = segs[segs.length - 1].to;
    if (last[0] !== start.x || last[1] !== start.y) segs.push({ type: "line", to: [start.x, start.y] });
  }
  return { start: [start.x, start.y], segs, closed: true, startImplied: !!start.implied };
}

function parseComposite(r, font, depth) {
  if (depth > 5) return { contours: [] };
  const contours = [];
  for (;;) {
    const flags = r.u16(), gi = r.u16();
    let dx, dy;
    if (flags & 1) { dx = r.i16(); dy = r.i16(); }
    else { dx = r.i8(); dy = r.i8(); }
    let a = 1, b = 0, c = 0, d = 1;
    const f2d = () => r.i16() / 16384;
    if (flags & 8) { a = d = f2d(); }
    else if (flags & 0x40) { a = f2d(); d = f2d(); }
    else if (flags & 0x80) { a = f2d(); b = f2d(); c = f2d(); d = f2d(); }
    const save = r.p;
    const sub = font.glyphByIndex(gi, depth + 1);
    r.seek(save);
    for (const cont of sub.contours) {
      const tx = (x, y) => [a * x + c * y + dx, b * x + d * y + dy];
      const nstart = tx(cont.start[0], cont.start[1]);
      const nsegs = cont.segs.map(sg => {
        const o = { type: sg.type, to: tx(sg.to[0], sg.to[1]) };
        if (sg.c) o.c = tx(sg.c[0], sg.c[1]);
        if (sg.c1) { o.c1 = tx(sg.c1[0], sg.c1[1]); o.c2 = tx(sg.c2[0], sg.c2[1]); }
        return o;
      });
      contours.push({ start: nstart, segs: nsegs, closed: true });
    }
    if (!(flags & 0x20)) break;
  }
  return { contours };
}

/* ------------------------------------------------------------------- CFF */

function cffIndex(r, pos) {
  r.seek(pos);
  const count = r.u16();
  if (count === 0) return { items: [], end: pos + 2 };
  const offSize = r.u8();
  const offsets = [];
  for (let i = 0; i <= count; i++) {
    let v = 0;
    for (let k = 0; k < offSize; k++) v = (v << 8) | r.u8();
    offsets.push(v);
  }
  const base = r.p - 1;
  const items = [];
  for (let i = 0; i < count; i++) items.push([base + offsets[i], base + offsets[i + 1]]);
  return { items, end: base + offsets[count] };
}

function cffDict(r, start, end) {
  const dict = {};
  let operands = [];
  r.seek(start);
  while (r.p < end) {
    let b = r.u8();
    if (b <= 21) {
      let op = b;
      if (b === 12) op = 1200 + r.u8();
      dict[op] = operands;
      operands = [];
    } else if (b === 28) operands.push(r.i16());
    else if (b === 29) operands.push(r.i32());
    else if (b === 30) {                       // real number
      let s = "";
      for (;;) {
        const v = r.u8();
        const nib = [v >> 4, v & 15];
        let done = false;
        for (const n of nib) {
          if (n <= 9) s += n;
          else if (n === 10) s += ".";
          else if (n === 11) s += "E";
          else if (n === 12) s += "E-";
          else if (n === 14) s += "-";
          else if (n === 15) { done = true; break; }
        }
        if (done) break;
      }
      operands.push(parseFloat(s) || 0);
    }
    else if (b >= 32 && b <= 246) operands.push(b - 139);
    else if (b >= 247 && b <= 250) operands.push((b - 247) * 256 + r.u8() + 108);
    else if (b >= 251 && b <= 254) operands.push(-(b - 251) * 256 - r.u8() - 108);
    else if (b === 255) operands.push(r.i32() / 65536);
  }
  return dict;
}

const subrBias = n => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

function parseCFF(r, off, len) {
  r.seek(off);
  const hdrSize = (r.u8(), r.u8(), r.u8());
  const nameIdx = cffIndex(r, off + hdrSize);
  const topIdx = cffIndex(r, nameIdx.end);
  const stringIdx = cffIndex(r, topIdx.end);
  const gsubrs = cffIndex(r, stringIdx.end);
  const top = cffDict(r, topIdx.items[0][0], topIdx.items[0][1]);
  const charStringsOff = (top[17] || [0])[0];
  if (!charStringsOff) throw new FontError("This OTF has no CharStrings table.");
  const charStrings = cffIndex(r, off + charStringsOff);

  // private dict → local subroutines
  function readPrivate(entry) {
    if (!entry) return { subrs: { items: [] }, nominalWidth: 0 };
    const [sz, poff] = entry;
    const pd = cffDict(r, off + poff, off + poff + sz);
    let subrs = { items: [] };
    if (pd[19]) subrs = cffIndex(r, off + poff + pd[19][0]);
    return { subrs };
  }
  const isCID = !!top[1230];
  let fdSelect = null, fdPrivates = null;
  const priv = readPrivate(top[18]);
  if (isCID && top[1236]) {
    const fdArray = cffIndex(r, off + top[1236][0]);
    fdPrivates = fdArray.items.map(([s, e]) => readPrivate(cffDict(r, s, e)[18]));
    if (top[1237]) {
      const p = off + top[1237][0];
      r.seek(p);
      const fmt = r.u8();
      fdSelect = new Uint8Array(charStrings.items.length);
      if (fmt === 0) for (let i = 0; i < fdSelect.length; i++) fdSelect[i] = r.u8();
      else if (fmt === 3) {
        const nRanges = r.u16();
        let first = r.u16();
        for (let i = 0; i < nRanges; i++) {
          const fd = r.u8(), next = r.u16();
          for (let g = first; g < next && g < fdSelect.length; g++) fdSelect[g] = fd;
          first = next;
        }
      }
    }
  }
  return { charStrings, gsubrs, priv, fdSelect, fdPrivates, isCID,
           fontMatrix: (top[1207] || [0.001, 0, 0, 0.001, 0, 0]) };
}

// Type 2 charstring interpreter.
function runCharstring(r, cff, gid) {
  const local = (cff.fdSelect && cff.fdPrivates)
    ? (cff.fdPrivates[cff.fdSelect[gid]] || cff.priv) : cff.priv;
  const lsubrs = local.subrs.items, gsubrs = cff.gsubrs.items;
  const lbias = subrBias(lsubrs.length), gbias = subrBias(gsubrs.length);

  const contours = [];
  let cur = null, x = 0, y = 0, nStems = 0, haveWidth = false, open = false;
  const stack = [];
  const trans = [];

  const moveTo = (nx, ny) => { closeC(); cur = { start: [nx, ny], segs: [], closed: true }; open = true; };
  // CFF closes every subpath implicitly with a straight line home. Make that
  // line explicit, or the first node never learns what arrives at it.
  const closeC = () => {
    if (cur && cur.segs.length) {
      const last = cur.segs[cur.segs.length - 1].to;
      if (Math.abs(last[0] - cur.start[0]) > 1e-9 || Math.abs(last[1] - cur.start[1]) > 1e-9)
        cur.segs.push({ type: "line", to: cur.start.slice() });
      contours.push(cur);
    }
    cur = null;
  };
  const lineTo = (nx, ny) => { if (cur) cur.segs.push({ type: "line", to: [nx, ny] }); };
  const curveTo = (x1, y1, x2, y2, nx, ny) => {
    if (cur) cur.segs.push({ type: "cubic", c1: [x1, y1], c2: [x2, y2], to: [nx, ny] });
  };
  const stems = () => {
    if (stack.length % 2 && !haveWidth) stack.shift();
    nStems += stack.length >> 1;
    stack.length = 0;
    haveWidth = true;
  };

  function exec(start, end, depth) {
    if (depth > 10) return;
    const save = r.p;
    r.seek(start);
    while (r.p < end) {
      const b = r.u8();
      if (b >= 32 || b === 28) {
        if (b === 28) stack.push(r.i16());
        else if (b <= 246) stack.push(b - 139);
        else if (b <= 250) stack.push((b - 247) * 256 + r.u8() + 108);
        else if (b <= 254) stack.push(-(b - 251) * 256 - r.u8() - 108);
        else stack.push(r.i32() / 65536);
        continue;
      }
      switch (b) {
        case 1: case 3: case 18: case 23: stems(); break;
        case 19: case 20: stems(); r.p += (nStems + 7) >> 3; break;
        case 21:
          if (stack.length > 2 && !haveWidth) stack.shift();
          haveWidth = true;
          x += stack[0] || 0; y += stack[1] || 0; moveTo(x, y); stack.length = 0; break;
        case 22:
          if (stack.length > 1 && !haveWidth) stack.shift();
          haveWidth = true;
          x += stack[0] || 0; moveTo(x, y); stack.length = 0; break;
        case 4:
          if (stack.length > 1 && !haveWidth) stack.shift();
          haveWidth = true;
          y += stack[0] || 0; moveTo(x, y); stack.length = 0; break;
        case 5:
          for (let i = 0; i + 1 < stack.length; i += 2) { x += stack[i]; y += stack[i + 1]; lineTo(x, y); }
          stack.length = 0; break;
        case 6: case 7: {
          let horiz = b === 6;
          for (let i = 0; i < stack.length; i++) {
            if (horiz) x += stack[i]; else y += stack[i];
            lineTo(x, y); horiz = !horiz;
          }
          stack.length = 0; break;
        }
        case 8:
          for (let i = 0; i + 5 < stack.length; i += 6) rrcurve(stack.slice(i, i + 6));
          stack.length = 0; break;
        case 24: {
          let i = 0;
          for (; i + 5 < stack.length - 2; i += 6) rrcurve(stack.slice(i, i + 6));
          x += stack[i]; y += stack[i + 1]; lineTo(x, y);
          stack.length = 0; break;
        }
        case 25: {
          let i = 0;
          for (; i + 1 < stack.length - 6; i += 2) { x += stack[i]; y += stack[i + 1]; lineTo(x, y); }
          rrcurve(stack.slice(i, i + 6));
          stack.length = 0; break;
        }
        case 26: case 27: {                       // vvcurveto / hhcurveto
          let i = 0, d = 0;
          if (stack.length % 4) d = stack[i++];
          for (; i + 3 < stack.length; i += 4) {
            let x1, y1;
            if (b === 26) { x1 = x + d; y1 = y + stack[i]; } else { x1 = x + stack[i]; y1 = y + d; }
            const x2 = x1 + stack[i + 1], y2 = y1 + stack[i + 2];
            if (b === 26) { x = x2; y = y2 + stack[i + 3]; } else { x = x2 + stack[i + 3]; y = y2; }
            curveTo(x1, y1, x2, y2, x, y);
            d = 0;
          }
          stack.length = 0; break;
        }
        case 30: case 31: {                       // vhcurveto / hvcurveto
          let horiz = b === 31, i = 0;
          while (i + 3 < stack.length) {
            const last = stack.length - i === 5;
            let x1, y1, x2, y2;
            if (horiz) {
              x1 = x + stack[i]; y1 = y;
              x2 = x1 + stack[i + 1]; y2 = y1 + stack[i + 2];
              y = y2 + stack[i + 3];
              x = last ? x2 + stack[i + 4] : x2;
            } else {
              x1 = x; y1 = y + stack[i];
              x2 = x1 + stack[i + 1]; y2 = y1 + stack[i + 2];
              x = x2 + stack[i + 3];
              y = last ? y2 + stack[i + 4] : y2;
            }
            curveTo(x1, y1, x2, y2, x, y);
            i += last ? 5 : 4;
            horiz = !horiz;
          }
          stack.length = 0; break;
        }
        case 10: case 29: {
          const idx = stack.pop();
          const list = b === 10 ? lsubrs : gsubrs;
          const bias = b === 10 ? lbias : gbias;
          const item = list[idx + bias];
          if (item) exec(item[0], item[1], depth + 1);
          break;
        }
        case 11: r.seek(save); return;
        case 14:
          if (stack.length && !haveWidth) stack.shift();
          haveWidth = true;
          closeC(); stack.length = 0; r.seek(save); return;
        case 12: {
          const b2 = r.u8();
          if (b2 === 35) {                        // flex
            rrcurve(stack.slice(0, 6)); rrcurve(stack.slice(6, 12));
          } else if (b2 === 34) {                 // hflex
            const y0 = y;
            curveAbs(x + stack[0], y, x + stack[0] + stack[1], y + stack[2],
                     x + stack[0] + stack[1] + stack[3], y + stack[2]);
            curveAbs(x + stack[4], y, x + stack[4] + stack[5], y0, x + stack[4] + stack[5] + stack[6], y0);
          } else if (b2 === 36) {                 // hflex1
            const y0 = y;
            curveAbs(x + stack[0], y + stack[1], x + stack[0] + stack[2], y + stack[1] + stack[3],
                     x + stack[0] + stack[2] + stack[4], y + stack[1] + stack[3]);
            curveAbs(x + stack[5], y, x + stack[5] + stack[6], y + stack[7],
                     x + stack[5] + stack[6] + stack[8], y0);
          } else if (b2 === 37) {                 // flex1
            const sx = x, sy = y;
            let dx = 0, dy = 0;
            for (let i = 0; i < 10; i += 2) { dx += stack[i]; dy += stack[i + 1]; }
            rrcurve(stack.slice(0, 6));
            curveAbs(x + stack[6], y + stack[7], x + stack[6] + stack[8], y + stack[7] + stack[9],
                     sx + dx, sy + dy);
          }
          stack.length = 0; break;
        }
        default: stack.length = 0; break;
      }
    }
    r.seek(save);
  }
  function rrcurve(a) {
    const x1 = x + a[0], y1 = y + a[1], x2 = x1 + a[2], y2 = y1 + a[3];
    x = x2 + a[4]; y = y2 + a[5];
    curveTo(x1, y1, x2, y2, x, y);
  }
  function curveAbs(x1, y1, x2, y2, nx, ny) { x = nx; y = ny; curveTo(x1, y1, x2, y2, nx, ny); }

  const item = cff.charStrings.items[gid];
  if (item) exec(item[0], item[1], 0);
  closeC();
  void trans; void open;
  return { contours };
}

/* --------------------------------------------------------------- kerning */
//
// Two places keep it. GPOS is the modern one: a "kern" feature points at pair
// adjustment lookups, which come either glyph by glyph (format 1) or by class —
// every round left side against every diagonal right side (format 2). The old
// `kern` table is a flat list of pairs. A browser uses GPOS when it has a kern
// feature and falls back to the old table otherwise, and so does this.

function readCoverage(r, off) {
  r.seek(off);
  const fmt = r.u16(), map = new Map();
  if (fmt === 1) {
    const n = r.u16();
    for (let i = 0; i < n; i++) map.set(r.u16(), i);
  } else if (fmt === 2) {
    const n = r.u16();
    for (let i = 0; i < n; i++) {
      const s = r.u16(), e = r.u16(), idx = r.u16();
      for (let g = s; g <= e; g++) map.set(g, idx + g - s);
    }
  }
  return map;
}

function readClassDef(r, off) {
  r.seek(off);
  const fmt = r.u16(), map = new Map();
  if (fmt === 1) {
    const start = r.u16(), n = r.u16();
    for (let i = 0; i < n; i++) map.set(start + i, r.u16());
  } else if (fmt === 2) {
    const n = r.u16();
    for (let i = 0; i < n; i++) {
      const s = r.u16(), e = r.u16(), c = r.u16();
      for (let g = s; g <= e; g++) map.set(g, c);
    }
  }
  return g => map.get(g) || 0;
}

// A ValueRecord holds only the fields its format bits switch on, two bytes each,
// in a fixed order. Kerning lives in the advance; placement is read too.
const valueSize = fmt => { let n = 0; for (let b = fmt; b; b >>= 1) n += b & 1; return n * 2; };
function readValue(r, fmt) {
  const v = { xPla: 0, xAdv: 0 };
  if (fmt & 0x0001) v.xPla = r.i16();
  if (fmt & 0x0002) r.i16();
  if (fmt & 0x0004) v.xAdv = r.i16();
  if (fmt & 0x0008) r.i16();
  for (const bit of [0x10, 0x20, 0x40, 0x80]) if (fmt & bit) r.u16();   // device tables: hinting only
  return v;
}

function parseGPOSKern(r, off) {
  r.seek(off);
  r.u16(); r.u16();
  r.u16();                                    // script list — kern applies to all scripts here
  const featOff = off + r.u16(), lookOff = off + r.u16();
  r.seek(featOff);
  const fc = r.u16();
  const wanted = new Set();
  const feats = [];
  for (let i = 0; i < fc; i++) { const tag = r.tag(); feats.push([tag, featOff + r.u16()]); }
  for (const [tag, fo] of feats) {
    if (tag !== "kern") continue;
    r.seek(fo + 2);
    const n = r.u16();
    for (let i = 0; i < n; i++) wanted.add(r.u16());
  }
  if (!wanted.size) return null;
  r.seek(lookOff);
  const lc = r.u16();
  const lookupOffs = [];
  for (let i = 0; i < lc; i++) lookupOffs.push(lookOff + r.u16());
  const lookups = [];
  for (const li of Array.from(wanted).sort((a, b) => a - b)) {
    const lo = lookupOffs[li];
    if (lo == null) continue;
    r.seek(lo);
    const type = r.u16();
    r.u16();
    const sc = r.u16();
    const subs = [];
    for (let i = 0; i < sc; i++) subs.push(lo + r.u16());
    const tables = [];
    for (let so of subs) {
      let t = type;
      if (t === 9) {                            // extension: the real subtable sits further on
        r.seek(so); r.u16();
        t = r.u16();
        so = so + r.u32();
      }
      if (t !== 2) continue;
      r.seek(so);
      const fmt = r.u16(), covOff = r.u16(), vf1 = r.u16(), vf2 = r.u16();
      const body = r.p;
      const cov = readCoverage(r, so + covOff);
      r.seek(body);
      if (fmt === 1) {
        const n = r.u16(), sets = [];
        for (let i = 0; i < n; i++) sets.push(so + r.u16());
        tables.push({ fmt, cov, vf1, vf2, sets, cache: new Map() });
      } else if (fmt === 2) {
        const cd1Off = so + r.u16(), cd2Off = so + r.u16();
        const c1n = r.u16(), c2n = r.u16();
        const recs = r.p;
        tables.push({ fmt, cov, vf1, vf2, c1n, c2n, recs,
          cd1: readClassDef(r, cd1Off), cd2: readClassDef(r, cd2Off) });
      }
    }
    if (tables.length) lookups.push(tables);
  }
  return lookups.length ? lookups : null;
}

function gposPair(r, lookups, left, right) {
  let adv = 0, pla2 = 0, adv2 = 0, hit = false;
  for (const tables of lookups) {
    for (const t of tables) {
      const ci = t.cov.get(left);
      if (ci === undefined) continue;
      let v1 = null, v2 = null;
      if (t.fmt === 1) {
        let set = t.cache.get(ci);
        if (!set) {
          set = new Map();
          r.seek(t.sets[ci]);
          const n = r.u16();
          for (let i = 0; i < n; i++) {
            const second = r.u16();
            const a = readValue(r, t.vf1), b = readValue(r, t.vf2);
            set.set(second, [a, b]);
          }
          t.cache.set(ci, set);
        }
        const pv = set.get(right);
        if (pv) { v1 = pv[0]; v2 = pv[1]; }
      } else {
        const c1 = t.cd1(left), c2 = t.cd2(right);
        if (c1 < t.c1n && c2 < t.c2n) {
          const rec = valueSize(t.vf1) + valueSize(t.vf2);
          r.seek(t.recs + (c1 * t.c2n + c2) * rec);
          v1 = readValue(r, t.vf1); v2 = readValue(r, t.vf2);
        }
      }
      // within a lookup the first subtable that covers the pair decides
      if (v1) {
        adv += v1.xAdv; pla2 += v2.xPla; adv2 += v2.xAdv;
        hit = hit || !!(v1.xAdv || v2.xPla || v2.xAdv);
        break;
      }
    }
  }
  return { adv, pla2, adv2, hit };
}

// The old table comes in two flavours (Microsoft and Apple headers) and two
// useful formats: 0 is a flat list of pairs, 2 is a class grid — each glyph
// belongs to a left class and a right class, and the value sits where the row
// and column meet. Returns a lookup function, or null if nothing applies.
function parseKernTable(r, off) {
  r.seek(off);
  const pairs = new Map();
  const grids = [];
  const ver = r.u16();
  let nTables, apple = false;
  if (ver === 0) nTables = r.u16();
  else { r.seek(off); if (r.u32() !== 0x00010000) return null; nTables = r.u32(); apple = true; }
  for (let t = 0; t < nTables; t++) {
    const start = r.p;
    let length, format, horizontal;
    if (apple) {
      length = r.u32(); const cov = r.u16(); r.u16();
      // Apple: high bit = vertical, 0x40 = cross-stream, 0x20 = variation
      format = cov & 0xFF; horizontal = !(cov & 0x8000) && !(cov & 0x4000) && !(cov & 0x2000);
    } else {
      r.u16(); length = r.u16(); const cov = r.u16();
      format = cov >> 8; horizontal = !!(cov & 1) && !(cov & 4);
    }
    if (horizontal && format === 0) {
      const n = r.u16(); r.p += 6;
      for (let i = 0; i < n; i++) {
        const key = r.u16() * 65536 + r.u16();
        pairs.set(key, (pairs.get(key) || 0) + r.i16());
      }
    } else if (horizontal && format === 2) {
      r.u16();                                            // row width — implied by the class values
      const leftOff = r.u16(), rightOff = r.u16(), arrayOff = r.u16();
      const classTable = o => {
        r.seek(start + o);
        const first = r.u16(), n = r.u16(), vals = [];
        for (let i = 0; i < n; i++) vals.push(r.u16());
        return { first, vals };
      };
      grids.push({ start, arrayOff, end: start + length, left: classTable(leftOff), right: classTable(rightOff) });
    }
    r.seek(start + length);
  }
  if (!pairs.size && !grids.length) return null;
  return function (left, right) {
    let v = pairs.get(left * 65536 + right) || 0;
    for (const g of grids) {
      const li = left - g.left.first, ri = right - g.right.first;
      if (li < 0 || li >= g.left.vals.length || ri < 0 || ri >= g.right.vals.length) continue;
      // left values already point from the subtable start to the row; right
      // values are the offset along it
      const at = g.start + g.left.vals[li] + g.right.vals[ri];
      if (at < g.start + g.arrayOff || at + 2 > g.end) continue;
      r.seek(at);
      v += r.i16();
    }
    return v;
  };
}

/* ------------------------------------------------------------------ font */

class Font {
  // opts.postscriptName picks a face out of a .ttc; otherwise the first.
  constructor(bytes, inflate, opts) {
    opts = opts || {};
    const woff = unwrapWOFF(bytes, inflate);
    if (woff) {
      // rebuild a flat buffer so every table reader can share one view
      let total = 0;
      const order = Object.keys(woff.data);
      for (const t of order) total += (woff.data[t].length + 3) & ~3;
      const flat = new Uint8Array(total);
      const tables = {};
      let p = 0;
      for (const t of order) {
        flat.set(woff.data[t], p);
        tables[t] = { off: p, len: woff.data[t].length };
        p = (p + woff.data[t].length + 3) & ~3;
      }
      this.r = new Reader(flat);
      this.tables = tables;
    } else {
      this.r = new Reader(bytes);
      const offs = collectionOffsets(this.r);
      if (offs) {
        let chosen = offs[0];
        this.faces = [];
        for (const o of offs) {
          const tb = tableDirectory(this.r, o);
          const ps = postscriptNameAt(this.r, tb);
          this.faces.push(ps);
          if (opts.postscriptName && ps === opts.postscriptName) chosen = o;
        }
        this.tables = tableDirectory(this.r, chosen);
      } else {
        this.tables = tableDirectory(this.r, 0);
      }
    }
    const t = this.tables, r = this.r;
    if (!t.head) throw new FontError("The font has no head table — the file may be damaged.");
    r.seek(t.head.off + 18);
    this.unitsPerEm = r.u16() || 1000;
    r.seek(t.head.off + 50);
    this.indexToLocFormat = r.i16();
    r.seek(t.maxp.off + 4);
    this.numGlyphs = r.u16();

    if (t.hhea && t.hmtx) {
      r.seek(t.hhea.off + 4);
      this.ascender = r.i16();
      this.descender = r.i16();
      r.seek(t.hhea.off + 34);
      this.numberOfHMetrics = r.u16();
    }
    if (t["OS/2"]) {
      r.seek(t["OS/2"].off);
      const ver = r.u16();
      r.seek(t["OS/2"].off + 68);
      this.typoAscender = r.i16();
      this.typoDescender = r.i16();
      if (ver >= 2) {
        r.seek(t["OS/2"].off + 86);
        this.xHeight = r.i16();
        this.capHeight = r.i16();
      }
    }
    this.cmap = t.cmap ? parseCmap(r, t.cmap.off) : new Map();
    // A damaged kerning table should cost the kerning, not the whole font.
    this.gposKern = null; this.kernPairs = null;
    try { if (t.GPOS) this.gposKern = parseGPOSKern(r, t.GPOS.off); } catch (e) { this.gposKern = null; }
    try { if (!this.gposKern && t.kern) this.kernPairs = parseKernTable(r, t.kern.off); } catch (e) { this.kernPairs = null; }
    this.kernSource = this.gposKern ? "GPOS" : this.kernPairs ? "kern table" : null;
    this.cff = t["CFF "] ? parseCFF(r, t["CFF "].off, t["CFF "].len) : null;
    this.kind = this.cff ? "PostScript (cubic)" : "TrueType (quadratic)";
    if (!this.cff && !t.glyf) throw new FontError("No outlines found — this may be a bitmap or colour font.");
    this.name = this.readName() || "Untitled";
  }

  readName() {
    const t = this.tables.name;
    if (!t) return null;
    const r = this.r;
    r.seek(t.off);
    r.u16();
    const count = r.u16(), strOff = r.u16();
    let family = null, sub = null;
    for (let i = 0; i < count; i++) {
      const pid = r.u16(), eid = r.u16();
      r.u16();
      const nid = r.u16(), len = r.u16(), off = r.u16();
      if (nid !== 1 && nid !== 2) continue;
      const save = r.p;
      r.seek(t.off + strOff + off);
      let s = "";
      if (pid === 3 || (pid === 0)) { for (let k = 0; k < len / 2; k++) s += String.fromCharCode(r.u16()); }
      else { for (let k = 0; k < len; k++) s += String.fromCharCode(r.u8()); }
      r.seek(save);
      if (nid === 1 && !family) family = s;
      if (nid === 2 && !sub) sub = s;
    }
    return family ? (sub && sub !== "Regular" ? family + " " + sub : family) : null;
  }

  advance(gid) {
    const t = this.tables;
    if (!t.hmtx || !this.numberOfHMetrics) return this.unitsPerEm / 2;
    const r = this.r;
    const i = Math.min(gid, this.numberOfHMetrics - 1);
    r.seek(t.hmtx.off + i * 4);
    return r.u16();
  }

  glyphIndex(ch) {
    return this.cmap.get(ch.codePointAt(0)) || 0;
  }

  glyphByIndex(gid, depth) {
    if (this.cff) return runCharstring(this.r, this.cff, gid);
    const t = this.tables, r = this.r;
    if (!t.loca || !t.glyf) return { contours: [] };
    let start, end;
    if (this.indexToLocFormat === 0) {
      r.seek(t.loca.off + gid * 2); start = r.u16() * 2;
      end = r.u16() * 2;
    } else {
      r.seek(t.loca.off + gid * 4); start = r.u32();
      end = r.u32();
    }
    return parseGlyf(r, t.glyf.off + start, t.glyf.off + end, this, depth || 0);
  }

  // Horizontal adjustment for a pair of glyphs, in font units.
  //   adv  — added to the first glyph's advance (what "kerning" usually means)
  //   pla2 — shifts the second glyph without moving what follows
  //   adv2 — added to the second glyph's advance
  kernPair(left, right) {
    if (this.gposKern) return gposPair(this.r, this.gposKern, left, right);
    if (this.kernPairs) {
      const v = this.kernPairs(left, right);
      return { adv: v, pla2: 0, adv2: 0, hit: !!v };
    }
    return { adv: 0, pla2: 0, adv2: 0, hit: false };
  }

  // Lay a string out into positioned glyph outlines, in font units, y up.
  // Each glyph records the kerning applied between it and the one before.
  layout(text, tracking, kerning) {
    const useKern = kerning !== false;
    const out = [];
    let pen = 0, prev = null, pairs = 0;
    for (const ch of String(text)) {
      if (ch === "\n") continue;
      const gid = this.glyphIndex(ch);
      const g = this.glyphByIndex(gid);
      let kern = 0, pla = 0, adv2 = 0;
      if (useKern && prev !== null) {
        const k = this.kernPair(prev, gid);
        kern = k.adv; pla = k.pla2; adv2 = k.adv2;
        if (k.hit) pairs++;
        pen += kern;
      }
      out.push({ ch, gid, x: pen + pla, contours: g.contours, advance: this.advance(gid), kern: kern + pla });
      pen += this.advance(gid) + adv2 + (tracking || 0) * this.unitsPerEm / 1000;
      prev = gid;
    }
    return { glyphs: out, width: pen, kernPairs: pairs };
  }
}

if (typeof module !== "undefined") module.exports = { Font, FontError, Reader };
