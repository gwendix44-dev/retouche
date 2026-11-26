// Masques : ciel / sol / sujet automatiques (méthodes classiques, sans réseau), baguette, pinceau, dégradés
export const MASK_LONG = 1024;
export const maskDims = (sw, sh) => { const k = MASK_LONG / Math.max(sw, sh); return [Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k))]; };

const mkCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });

export function smallFrom(bitmap, long = 384) {
  const k = Math.min(1, long / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k)), h = Math.max(1, Math.round(bitmap.height * k));
  const c = mkCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high'; x.drawImage(bitmap, 0, 0, w, h);
  return { data: x.getImageData(0, 0, w, h).data, w, h };
}

// ---------- outils de base ----------
export function boxBlur(a, w, h, r, passes = 1) {
  r = Math.round(r); if (r < 1) return a;
  let src = a, tmp = new Float32Array(w * h);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) { // horizontal
      let acc = 0; const o = y * w;
      for (let x = -r; x <= r; x++) acc += src[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { tmp[o + x] = acc / (2 * r + 1); acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; }
    }
    const dst = new Float32Array(w * h);
    for (let x = 0; x < w; x++) { // vertical
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { dst[y * w + x] = acc / (2 * r + 1); acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
    }
    src = dst;
  }
  return src;
}
const toF = (d, w, h) => { const o = new Float32Array(w * h * 3); for (let i = 0; i < w * h; i++) { o[i * 3] = d[i * 4] / 255; o[i * 3 + 1] = d[i * 4 + 1] / 255; o[i * 3 + 2] = d[i * 4 + 2] / 255; } return o; };
function blur3(f, w, h, r) { // flou de chaque canal
  const o = new Float32Array(f.length);
  for (let c = 0; c < 3; c++) { const ch = new Float32Array(w * h); for (let i = 0; i < w * h; i++) ch[i] = f[i * 3 + c]; const b = boxBlur(ch, w, h, r, 2); for (let i = 0; i < w * h; i++) o[i * 3 + c] = b[i]; }
  return o;
}
function gradMag(f, w, h) {
  const g = new Float32Array(w * h); const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * f[i * 3] + 0.587 * f[i * 3 + 1] + 0.114 * f[i * 3 + 2];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = L[i + 1] * 2 - L[i - 1] * 2 + L[i - w + 1] - L[i - w - 1] + L[i + w + 1] - L[i + w - 1];
    const gy = L[i + w] * 2 - L[i - w] * 2 + L[i + w + 1] - L[i - w + 1] + L[i + w - 1] - L[i - w - 1];
    g[i] = Math.hypot(gx, gy) / 8;
  }
  return g;
}
const cdist = (f, i, j) => Math.hypot(f[i * 3] - f[j * 3], f[i * 3 + 1] - f[j * 3 + 1], f[i * 3 + 2] - f[j * 3 + 2]);
function percentile(arr, p) { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; }

// composantes connexes (4-voisins) sur un masque binaire ; renvoie labels et aires
function components(bin, w, h) {
  const lab = new Int32Array(w * h).fill(-1), areas = [], stack = [];
  const touches = [];
  for (let s = 0; s < w * h; s++) {
    if (!bin[s] || lab[s] >= 0) continue;
    const id = areas.length; let a = 0, tb = false; stack.push(s); lab[s] = id;
    while (stack.length) {
      const i = stack.pop(); a++; const x = i % w, y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tb = true;
      if (x > 0 && bin[i - 1] && lab[i - 1] < 0) { lab[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && bin[i + 1] && lab[i + 1] < 0) { lab[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && bin[i - w] && lab[i - w] < 0) { lab[i - w] = id; stack.push(i - w); }
      if (y < h - 1 && bin[i + w] && lab[i + w] < 0) { lab[i + w] = id; stack.push(i + w); }
    }
    areas.push(a); touches.push(tb);
  }
  return { lab, areas, touches };
}

// ---------- CIEL ----------
export function autoSky(small) {
  const { data, w, h } = small; const f = blur3(toF(data, w, h), w, h, 1); const g = gradMag(f, w, h);
  const top = []; for (let y = 0; y < Math.max(2, h * 0.12); y++) for (let x = 0; x < w; x++) top.push(g[y * w + x]);
  const gth = Math.min(0.09, Math.max(0.022, percentile(top, 0.6) * 2.6));
  const sky = new Uint8Array(w * h), q = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < 3; y++) { const i = y * w + x; if (g[i] < gth && !sky[i]) { sky[i] = 1; q.push(i); } }
  let qi = 0;
  while (qi < q.length) {
    const i = q[qi++]; const x = i % w, y = (i / w) | 0;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of nb) { if (j < 0 || sky[j] || g[j] >= gth) continue; if (cdist(f, i, j) > 0.04) continue; sky[j] = 1; q.push(j); }
  }
  // trous entourés (nuages) : on les ajoute s'ils ressemblent au ciel
  const inv = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) inv[i] = sky[i] ? 0 : 1;
  const cc = components(inv, w, h); let mr = 0, mg = 0, mb = 0, n = 0;
  for (let i = 0; i < w * h; i++) if (sky[i]) { mr += f[i * 3]; mg += f[i * 3 + 1]; mb += f[i * 3 + 2]; n++; }
  if (n < w * h * 0.01) return new Float32Array(w * h);
  mr /= n; mg /= n; mb /= n;
  const sums = cc.areas.map(() => [0, 0, 0]);
  for (let i = 0; i < w * h; i++) { const l = cc.lab[i]; if (l >= 0) { sums[l][0] += f[i * 3]; sums[l][1] += f[i * 3 + 1]; sums[l][2] += f[i * 3 + 2]; } }
  const fill = cc.areas.map((a, l) => !cc.touches[l] && a < w * h * 0.012 && Math.hypot(sums[l][0] / a - mr, sums[l][1] / a - mg, sums[l][2] / a - mb) < 0.3);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = sky[i] || (cc.lab[i] >= 0 && fill[cc.lab[i]]) ? 1 : 0;
  // petite dilatation (pixels de bord) + adoucissement
  return boxBlur(boxBlur(out, w, h, 1, 1).map(v => v > 0.2 ? 1 : 0), w, h, 1, 1);
}

// ---------- SUJET (mini « grab-cut » par histogrammes de couleurs) ----------
export function autoSubject(small, sky) {
  const { data, w, h } = small; const N = w * h;
  const bin = new Uint16Array(N);
  for (let i = 0; i < N; i++) bin[i] = ((data[i * 4] >> 5) << 6) | ((data[i * 4 + 1] >> 5) << 3) | (data[i * 4 + 2] >> 5);
  const p = new Float32Array(N), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.hypot((x - cx) / (w * 0.32), (y - cy) / (h * 0.32)); p[y * w + x] = d < 1 ? 0.9 : 0.1; }
  const border = (x, y) => x < w * 0.07 || x > w * 0.93 || y < h * 0.07 || y > h * 0.93;
  let cur = p;
  for (let it = 0; it < 4; it++) {
    const Hf = new Float32Array(512).fill(0.5), Hb = new Float32Array(512).fill(0.5); let nf = 256, nb = 256;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, b = bin[i]; const inBox = Math.abs(x - cx) < w * 0.38 && Math.abs(y - cy) < h * 0.38;
      let wf = inBox ? cur[i] : 0, wb = (1 - cur[i]) * (inBox ? 0.6 : 1);
      if (border(x, y)) { wb += 1; wf = 0; }
      if (sky && sky[i] > 0.5) { wb += 1; wf *= 0.2; }
      Hf[b] += wf; Hb[b] += wb; nf += wf; nb += wb;
    }
    const q = new Float32Array(N);
    for (let i = 0; i < N; i++) { const a = Hf[bin[i]] / nf, b = Hb[bin[i]] / nb; q[i] = a / (a + b); }
    cur = boxBlur(boxBlur(q, w, h, 2, 1), w, h, 2, 1);
  }
  // seuil, composante connexe au centre, trous
  const t = new Uint8Array(N); for (let i = 0; i < N; i++) t[i] = cur[i] > 0.52 && !(sky && sky[i] > 0.6) ? 1 : 0;
  const cc = components(t, w, h);
  let best = -1, bestScore = 0;
  for (let l = 0; l < cc.areas.length; l++) { if (cc.areas[l] < N * 0.003) continue; const sc = cc.areas[l] * (cc.touches[l] ? 0.5 : 1); if (sc > bestScore) { bestScore = sc; best = l; } }
  if (best < 0) return null;
  const m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = cc.lab[i] === best ? 1 : 0;
  // fermeture des trous internes
  const inv = new Uint8Array(N); for (let i = 0; i < N; i++) inv[i] = m[i] ? 0 : 1;
  const hc = components(inv, w, h); for (let i = 0; i < N; i++) if (hc.lab[i] >= 0 && !hc.touches[hc.lab[i]] && hc.areas[hc.lab[i]] < N * 0.02) m[i] = 1;
  const area = m.reduce((a, b) => a + b, 0) / N;
  if (area < 0.004 || area > 0.7) return null;
  return boxBlur(Float32Array.from(m), w, h, 1, 2);
}

export function autoGround(small, sky, subject) {
  const { w, h } = small; const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { const t = Math.min(1, Math.max(0, (y / h - 0.32) / 0.28)); const vp = t * t * (3 - 2 * t); for (let x = 0; x < w; x++) { const i = y * w + x; o[i] = vp * (1 - (sky ? sky[i] : 0)) * (1 - (subject ? subject[i] : 0)); } }
  return boxBlur(o, w, h, 2, 1);
}

// baguette magique : région de couleur voisine autour des points touchés
export function wand(small, seeds, tol = 0.09) {
  const { data, w, h } = small; const f = blur3(toF(data, w, h), w, h, 1); const g = gradMag(f, w, h);
  const out = new Uint8Array(w * h);
  for (const s of seeds) {
    const sx = Math.min(w - 1, Math.max(0, Math.round(s.x * w))), sy = Math.min(h - 1, Math.max(0, Math.round(s.y * h)));
    const si = sy * w + sx; if (out[si]) continue;
    const ref = [0, 0, 0]; let rn = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = (Math.min(h - 1, Math.max(0, sy + dy))) * w + Math.min(w - 1, Math.max(0, sx + dx)); ref[0] += f[j * 3]; ref[1] += f[j * 3 + 1]; ref[2] += f[j * 3 + 2]; rn++; }
    ref[0] /= rn; ref[1] /= rn; ref[2] /= rn;
    const q = [si]; out[si] = 1; let qi = 0; const gstop = 0.16;
    while (qi < q.length) {
      const i = q[qi++]; const x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0 || out[j]) continue;
        const d = Math.hypot(f[j * 3] - ref[0], f[j * 3 + 1] - ref[1], f[j * 3 + 2] - ref[2]);
        if (d < tol && g[j] < gstop) { out[j] = 1; q.push(j); }
      }
    }
  }
  const o = Float32Array.from(out);
  return boxBlur(o, w, h, 1, 2);
}

// ---------- dégradés ----------
export function linearGrad(w, h, g) {
  const o = new Float32Array(w * h); const dx = g.x1 - g.x0, dy = g.y1 - g.y0; const L2 = dx * dx + dy * dy || 1e-6;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const t = (((x + .5) / w - g.x0) * dx + ((y + .5) / h - g.y0) * dy) / L2; const v = 1 - Math.min(1, Math.max(0, t)); o[y * w + x] = v * v * (3 - 2 * v); }
  return o;
}
export function radialGrad(w, h, r, aspect) {
  const o = new Float32Array(w * h); const cs = Math.cos(r.rot || 0), sn = Math.sin(r.rot || 0); const fe = Math.min(0.95, Math.max(0.02, r.feather == null ? 0.5 : r.feather));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = ((x + .5) / w - r.cx) * aspect, py = ((y + .5) / h - r.cy); const u = (px * cs + py * sn) / (r.rx * aspect), v = (-px * sn + py * cs) / r.ry; const d = Math.hypot(u, v);
    const t = Math.min(1, Math.max(0, (d - (1 - fe)) / fe)); o[y * w + x] = 1 - t * t * (3 - 2 * t);
  }
  return o;
}

// ---------- affinage sur les contours de la photo (bilatéral croisé) ----------
export function refine(mask, guide, w, h, iters = 2) {
  const L = new Float32Array(w * h * 3); for (let i = 0; i < w * h; i++) { L[i * 3] = guide[i * 4] / 255; L[i * 3 + 1] = guide[i * 4 + 1] / 255; L[i * 3 + 2] = guide[i * 4 + 2] / 255; }
  let src = mask;
  for (let it = 0; it < iters; it++) {
    const dst = new Float32Array(w * h);
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x; let acc = 0, ws = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const j = i + dy * w + dx; const d = Math.abs(L[i * 3] - L[j * 3]) + Math.abs(L[i * 3 + 1] - L[j * 3 + 1]) + Math.abs(L[i * 3 + 2] - L[j * 3 + 2]);
        const wt = Math.exp(-d * d / 0.012); acc += wt * src[j]; ws += wt;
      }
      dst[i] = acc / ws;
    }
    for (let x = 0; x < w; x++) { dst[x] = src[x]; dst[(h - 1) * w + x] = src[(h - 1) * w + x]; dst[(h - 2) * w + x] = src[(h - 2) * w + x]; dst[w + x] = src[w + x]; }
    for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) dst[y * w + x] = src[y * w + x];
    src = dst;
  }
  return src;
}

function upscaleF(f, w, h, W, H) {
  const c = mkCanvas(w, h), x = c.getContext('2d'); const id = x.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = Math.round(Math.min(1, Math.max(0, f[i])) * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  x.putImageData(id, 0, 0);
  const c2 = mkCanvas(W, H), x2 = c2.getContext('2d', { willReadFrequently: true }); x2.imageSmoothingQuality = 'high'; x2.drawImage(c, 0, 0, W, H);
  const d = x2.getImageData(0, 0, W, H).data; const o = new Float32Array(W * H); for (let i = 0; i < W * H; i++) o[i] = d[i * 4] / 255; return o;
}

// ---------- gestionnaire ----------
export class MaskManager {
  constructor() { this.cache = new Map(); this.src = null; }
  setSource(bitmap) {
    this.sw = bitmap.width; this.sh = bitmap.height;
    [this.mw, this.mh] = maskDims(bitmap.width, bitmap.height);
    this.small = smallFrom(bitmap, 384);
    const g = smallFrom(bitmap, MASK_LONG); // guide à la résolution du masque
    this.guide = (g.w === this.mw && g.h === this.mh) ? g.data : smallFrom(bitmap, MASK_LONG).data;
    this.cache.clear(); this.rc = new Map(); this._sky = this._subj = null;
  }
  sky() { if (!this._sky) this._sky = autoSky(this.small); return this._sky; }
  subject() { if (this._subj === undefined || this._subj === null) this._subj = autoSubject(this.small, this.sky()) || false; return this._subj || null; }
  up(f) { return upscaleF(f, this.small.w, this.small.h, this.mw, this.mh); }
  base(m) {
    const { mw, mh } = this; const key = JSON.stringify([m.kind, m.seeds, m.tol, m.grad, m.rad]);
    if (this.cache.has(key)) return this.cache.get(key);
    let o;
    switch (m.kind) {
      case 'sky': o = refine(this.up(this.sky()), this.guide, mw, mh, 2); break;
      case 'subject': { const s = this.subject(); o = s ? refine(this.up(s), this.guide, mw, mh, 2) : new Float32Array(mw * mh); break; }
      case 'ground': o = this.up(autoGround(this.small, this.sky(), this.subject())); break;
      case 'wand': o = refine(this.up(wand(this.small, m.seeds || [], m.tol || 0.09)), this.guide, mw, mh, 2); break;
      case 'linear': o = linearGrad(mw, mh, m.grad || { x0: 0.5, y0: 0, x1: 0.5, y1: 0.5 }); break;
      case 'radial': o = radialGrad(mw, mh, m.rad || { cx: .5, cy: .5, rx: .3, ry: .25, rot: 0, feather: .5 }, this.sw / this.sh); break;
      case 'all': o = new Float32Array(mw * mh).fill(1); break;
      default: o = new Float32Array(mw * mh); // pinceau
    }
    if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, o); return o;
  }
  subjectBox() {
    const s = this.subject(); if (!s) return null; const { w, h } = this.small; let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (s[y * w + x] > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 > x0 ? { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h } : null;
  }
  // rendu final du masque d'une couche (Float32 0..1)
  render(layer) {
    const { mw, mh } = this; const m = layer.mask; const base = this.base(m);
    let v = base;
    if (m.strokes && m.strokes.length) {
      const c = mkCanvas(mw, mh), x = c.getContext('2d', { willReadFrequently: true });
      const id = x.createImageData(mw, mh); for (let i = 0; i < mw * mh; i++) { const b = Math.round(base[i] * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = b; id.data[i * 4 + 3] = 255; }
      x.putImageData(id, 0, 0);
      for (const s of m.strokes) this.stroke(x, s);
      const d = x.getImageData(0, 0, mw, mh).data; v = new Float32Array(mw * mh); for (let i = 0; i < mw * mh; i++) v[i] = d[i * 4] / 255;
    }
    if (m.invert) { const t = new Float32Array(v.length); for (let i = 0; i < t.length; i++) t[i] = 1 - v[i]; v = t; }
    if (m.edge) {
      const bl = boxBlur(v, mw, mh, Math.max(1, mw * 0.004), 2); const t = 0.5 - m.edge / 230; const out = new Float32Array(v.length);
      for (let i = 0; i < out.length; i++) { const u = Math.min(1, Math.max(0, (bl[i] - (t - 0.2)) / 0.4)); out[i] = u * u * (3 - 2 * u); }
      v = out;
    }
    if (m.feather > 0) v = boxBlur(v, mw, mh, Math.max(1, (m.feather / 100) * mw * 0.03), 3);
    return v;
  }
  stroke(x, s) {
    const R = Math.max(1, s.r * Math.max(this.mw, this.mh)); const col = s.erase ? 0 : 255; const hard = s.hard == null ? 0.5 : s.hard;
    const st = this.stamp(R, hard, col);
    const pts = s.pts; const step = Math.max(1, R * 0.22);
    const put = (px, py) => x.drawImage(st, px * this.mw - st.width / 2, py * this.mh - st.height / 2);
    if (pts.length === 1) put(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; const d = Math.hypot((bx - ax) * this.mw, (by - ay) * this.mh); const n = Math.max(1, Math.ceil(d / step));
      for (let k = 1; k <= n; k++) put(ax + (bx - ax) * k / n, ay + (by - ay) * k / n);
    }
  }
  stamp(R, hard, col) {
    const k = `${Math.round(R)}|${hard}|${col}`; this._st = this._st || new Map(); if (this._st.has(k)) return this._st.get(k);
    const d = Math.ceil(R * 2) + 2, c = mkCanvas(d, d), x = c.getContext('2d'); const g = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, R);
    g.addColorStop(0, `rgba(${col},${col},${col},1)`); g.addColorStop(Math.min(0.98, hard), `rgba(${col},${col},${col},${hard > 0.9 ? 1 : 0.9})`); g.addColorStop(1, `rgba(${col},${col},${col},0)`);
    x.fillStyle = g; x.fillRect(0, 0, d, d); if (this._st.size > 40) this._st.clear(); this._st.set(k, c); return c;
  }
  // ajoute un segment de pinceau à une couche (rendu incrémental côté appelant)
  pack(layers) {
    const { mw, mh } = this; const out = new Uint8Array(mw * mh * 4); this.rc = this.rc || new Map();
    layers.slice(0, 4).forEach((l, ch) => { const key = JSON.stringify(l.mask); let c = this.rc.get(l.id); if (!c || c.key !== key) { c = { key, v: this.render(l) }; c.ref = this.refLuma(c.v); this.rc.set(l.id, c); } Object.defineProperty(l, '_ref', { value: c.ref, writable: true, configurable: true, enumerable: false }); const v = c.v; for (let i = 0; i < mw * mh; i++) out[i * 4 + ch] = Math.round(Math.min(1, Math.max(0, v[i])) * 255); });
    return out;
  }
  // luminance moyenne (encodage écran, 0..1) sous le cœur du masque : sert à écarter les pixels de bord contaminés par le fond
  refLuma(v) { const g = this.guide; let a = 0, n = 0; for (let i = 0; i < v.length; i++) if (v[i] > 0.9) { a += 0.2126 * g[i * 4] + 0.7152 * g[i * 4 + 1] + 0.0722 * g[i * 4 + 2]; n++; } return n > 20 ? a / n / 255 : null; }
  stats(layer) { const v = this.render(layer); let a = 0; for (let i = 0; i < v.length; i++) a += v[i]; return a / v.length; }
}
