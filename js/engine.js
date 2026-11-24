// Moteur de retouche WebGL2 — pipeline non destructif, rendu par tuiles pour l'export pleine résolution
import * as S from './shaders.js';

const LW = [0.2126, 0.7152, 0.0722];

// ---------- géométrie ----------
const mul3 = (a, b) => { const r = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]; return r; };
const inv3 = m => { const [a, b, c, d, e, f, g, h, i] = m; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g; const det = a * A + b * B + c * C; return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]; };
export const GEOM_DEFAULT = () => ({ angle: 0, vp: 0, hp: 0, crop: { x: 0, y: 0, w: 1, h: 1 } });

// matrice sortie(px plein, après recadrage) -> source(px). Retourne aussi la taille de sortie.
export function geomInfo(geom, sw, sh, forEdit) {
  const g = geom || GEOM_DEFAULT();
  const crop = forEdit ? { x: 0, y: 0, w: 1, h: 1 } : g.crop;
  const cw = Math.max(1, Math.round(crop.w * sw)), ch = Math.max(1, Math.round(crop.h * sh));
  const th = (g.angle || 0) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
  const Tcrop = [1, 0, crop.x * sw - sw / 2, 0, 1, crop.y * sh - sh / 2, 0, 0, 1];
  const Sm = [sw / 2, 0, 0, 0, sh / 2, 0, 0, 0, 1], Si = [2 / sw, 0, 0, 0, 2 / sh, 0, 0, 0, 1];
  const P = [1, 0, 0, 0, 1, 0, (g.hp || 0) / 100 * 0.35, (g.vp || 0) / 100 * 0.35, 1];
  const R = [cs, -sn, 0, sn, cs, 0, 0, 0, 1];
  const Tc = [1, 0, sw / 2, 0, 1, sh / 2, 0, 0, 1];
  let M = mul3(Tcrop, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  M = mul3(Si, M); M = mul3(P, M); M = mul3(Sm, M); M = mul3(R, M); M = mul3(Tc, M);
  return { M, cw, ch };
}
const colMajor = m => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
// px source (continu) -> px sortie plein (via inverse)
export function srcToOut(geom, sw, sh, forEdit, x, y) {
  const { M } = geomInfo(geom, sw, sh, forEdit); const I = inv3(M);
  const w = I[6] * x + I[7] * y + I[8]; return [(I[0] * x + I[1] * y + I[2]) / w, (I[3] * x + I[4] * y + I[5]) / w];
}
export function outToSrc(geom, sw, sh, forEdit, x, y) {
  const { M } = geomInfo(geom, sw, sh, forEdit);
  const w = M[6] * x + M[7] * y + M[8]; return [(M[0] * x + M[1] * y + M[2]) / w, (M[3] * x + M[4] * y + M[5]) / w];
}

export class Engine {
  constructor(canvas) { this.canvas = canvas; this.slots = {}; this.pool = []; this.progs = {}; this.init(); }

  init() {
    const gl = this.gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 indisponible sur cet appareil');
    const e1 = gl.getExtension('EXT_color_buffer_float'), e2 = gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.fmt = (e1 || e2) ? { ifmt: gl.RGBA16F, type: gl.HALF_FLOAT, half: true } : { ifmt: gl.RGBA8, type: gl.UNSIGNED_BYTE, half: false };
    this.fmt8 = { ifmt: gl.RGBA8, type: gl.UNSIGNED_BYTE };
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.vao = gl.createVertexArray();
    this.progs = {};
    this.pool = []; this.slots = {};
    for (const [k, fs] of Object.entries({ geom: S.FS_GEOM, denoise: S.FS_DENOISE, blur: S.FS_BLUR2, grade: S.FS_GRADE, final: S.FS_FINAL, display: S.FS_DISPLAY, upscale: S.FS_UPSCALE, stack: S.FS_STACK, copy: S.FS_COPY })) this.progs[k] = this.mkProg(fs);
    // LUT + masque
    this.lutTex = this.mkSimpleTex(256, 1, null);
    this.setLUT(null);
    this.maskTex = this.mkSimpleTex(1, 1, new Uint8Array(4));
    this.maskSize = [1, 1];
    this.srcTex = null;
    this.prev = null; this.det = null;
    this.stats = { hist: null };
  }

  mkProg(fsSrc) {
    const gl = this.gl;
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n')); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, S.VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    const locs = {};
    return { p, loc: n => (n in locs) ? locs[n] : (locs[n] = gl.getUniformLocation(p, n)) };
  }

  mkSimpleTex(w, h, data) {
    const gl = this.gl; const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // ---- pool de textures/FBO ----
  tex(w, h, { mip = false, e8 = false } = {}) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const key = `${w}x${h}x${mip ? 1 : 0}x${e8 ? 8 : 16}`;
    const i = this.pool.findIndex(o => o.key === key);
    if (i >= 0) return this.pool.splice(i, 1)[0];
    const gl = this.gl; const f = e8 ? this.fmt8 : this.fmt;
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    const levels = mip ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, f.ifmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplet ' + key);
    return { key, t, fb, w, h, mip };
  }
  free(o) { if (!o) return; this.pool.push(o); while (this.pool.length > 24) { const x = this.pool.shift(); this.gl.deleteTexture(x.t); this.gl.deleteFramebuffer(x.fb); } }
  purge() { for (const o of this.pool) { this.gl.deleteTexture(o.t); this.gl.deleteFramebuffer(o.fb); } this.pool = []; }

  bind(unit, tex, prog, name) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex.t || tex); gl.uniform1i(prog.loc(name), unit); }
  draw3(target, w, h, prog) {
    const gl = this.gl; gl.useProgram(prog.p); gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
  }
  go() { this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); }

  // ---- source ----
  loadSource(bitmap) {
    const gl = this.gl;
    this.invalidate();
    if (this.srcTex) gl.deleteTexture(this.srcTex);
    const w = bitmap.width, h = bitmap.height;
    this.srcW = w; this.srcH = h; this.srcId = (this.srcId || 0) + 1;
    this.srcBitmap = bitmap; this.srcIs16 = false;
    const t = this.srcTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, w, h);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  // source RAW 16 bits (demi-flottants RGBA) : conserve toute la marge de récupération du RAW
  loadSourceHalf(half, bitmap8) {
    const gl = this.gl; this.invalidate(); if (this.srcTex) gl.deleteTexture(this.srcTex);
    const { data, w, h } = half; this.srcW = w; this.srcH = h; this.srcId = (this.srcId || 0) + 1; this.srcBitmap = bitmap8; this.srcIs16 = true;
    const t = this.srcTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA16F, w, h);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.HALF_FLOAT, data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  invalidate() { for (const k in this.slots) { const s = this.slots[k]; for (const n of ['geom', 'nr', 'bs', 'bm', 'bl', 'out']) { this.free(s[n]); } } this.slots = {}; this.prev = null; this.det = null; }

  setLUT(u8) {
    const gl = this.gl;
    if (!u8) { u8 = new Uint8Array(256 * 4); for (let i = 0; i < 256; i++) { u8[i * 4] = u8[i * 4 + 1] = u8[i * 4 + 2] = i; u8[i * 4 + 3] = 255; } }
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, u8);
  }
  setMask(u8, w, h) {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.maskTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (w !== this.maskSize[0] || h !== this.maskSize[1]) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, u8); this.maskSize = [w, h]; }
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, u8);
  }

  // ---- utilitaires de passes ----
  passGeom(state, job, dst) {
    const gl = this.gl, P = this.progs.geom, g = geomInfo(state.geom, this.srcW, this.srcH, job.forEdit);
    this.draw3(dst, dst.w, dst.h, P);
    this.bind(0, this.srcTex, P, 'uSrc');
    gl.uniform2f(P.loc('uSrcSize'), this.srcW, this.srcH);
    gl.uniformMatrix3fv(P.loc('uH'), false, colMajor(g.M));
    gl.uniform2f(P.loc('uOrigin'), job.ox - job.m, job.oy - job.m);
    gl.uniform1f(P.loc('uScale'), job.s);
    gl.uniform1f(P.loc('uLod'), job.s < 0.999 ? Math.log2(1 / job.s) : 0);
    this.go();
  }
  passDenoise(src, dst, p, job) {
    const gl = this.gl, P = this.progs.denoise;
    this.draw3(dst, dst.w, dst.h, P);
    this.bind(0, src, P, 'uTex');
    gl.uniform2f(P.loc('uSize'), dst.w, dst.h);
    gl.uniform1f(P.loc('uL'), (p.nrLum || 0) / 100); gl.uniform1f(P.loc('uC'), (p.nrCol || 0) / 100);
    gl.uniform1f(P.loc('uKeep'), (p.nrKeep == null ? 50 : p.nrKeep) / 100);
    gl.uniform1i(P.loc('uRad'), job.rad); gl.uniform1f(P.loc('uPx'), Math.max(0.3, Math.min(1, job.s)));
    this.go();
  }
  blur(base, sigma, W, H) {
    const gl = this.gl, P = this.progs.blur;
    let d = 1; while (sigma / d > 2.6) d *= 2;
    const lod = Math.log2(d), w2 = Math.max(1, Math.ceil(W / d)), h2 = Math.max(1, Math.ceil(H / d)), sg = sigma / d;
    const tmp = this.tex(w2, h2), out = this.tex(w2, h2);
    const lw = Math.max(1, Math.floor(W / d)), lh = Math.max(1, Math.floor(H / d));
    this.draw3(tmp, w2, h2, P); this.bind(0, base, P, 'uTex');
    gl.uniform2f(P.loc('uOutSize'), w2, h2); gl.uniform2f(P.loc('uStep'), 1 / lw, 0); gl.uniform1f(P.loc('uSigma'), sg); gl.uniform1f(P.loc('uLod'), lod); this.go();
    this.draw3(out, w2, h2, P); this.bind(0, tmp, P, 'uTex');
    gl.uniform2f(P.loc('uOutSize'), w2, h2); gl.uniform2f(P.loc('uStep'), 0, 1 / h2); gl.uniform1f(P.loc('uSigma'), sg); gl.uniform1f(P.loc('uLod'), 0); this.go();
    this.free(tmp);
    return out;
  }
  mip(t) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, t.t); gl.generateMipmap(gl.TEXTURE_2D); }

  // ---- uniformes des réglages ----
  setLayers(layers) { this.layers = layers || []; } // couches visibles, dans l'ordre des canaux du masque
  gradeUniforms(state, job, P) {
    const gl = this.gl, p = state.params;
    const n = k => (p[k] || 0) / 100;
    gl.uniform4f(P.loc('uA'), p.exposure || 0, n('contrast'), n('highlights'), n('shadows'));
    gl.uniform4f(P.loc('uB'), n('whites'), n('blacks'), n('temp'), n('tint'));
    gl.uniform4f(P.loc('uC'), n('vibrance'), n('saturation'), n('texture'), n('clarity'));
    gl.uniform4f(P.loc('uD'), n('sharpness'), n('dehaze'), n('vignette'), n('burn'));
    gl.uniform4f(P.loc('uE'), ((p.sharpMask == null ? 25 : p.sharpMask) / 100) * 0.04, job.outSharp || 0, 0, 0);
    const hsl = p.hsl || {}; const arr = new Float32Array(24); let on = 0;
    ['h', 's', 'l'].forEach((k, a) => { for (let i = 0; i < 8; i++) { const v = ((hsl[k] || [])[i] || 0) / 100; arr[a * 8 + i] = v; if (v) on = 1; } });
    gl.uniform1fv(P.loc('uHSL[0]'), arr); gl.uniform1i(P.loc('uHslOn'), on);
    gl.uniform1i(P.loc('uCurveOn'), this.curveOn ? 1 : 0);
    const L = this.layers || []; const la = new Float32Array(16), lb = new Float32Array(16), lc = new Float32Array(16);
    L.slice(0, 4).forEach((l, i) => {
      const q = l.params || {}; const v = k => (q[k] || 0) / 100;
      la.set([q.exposure || 0, v('contrast'), v('highlights'), v('shadows')], i * 4);
      lb.set([v('temp'), v('tint'), v('saturation'), v('clarity')], i * 4);
      lc.set([v('sharpness'), v('dehaze'), v('texture'), v('vibrance')], i * 4);
    });
    gl.uniform4fv(P.loc('uLA[0]'), la); gl.uniform4fv(P.loc('uLB[0]'), lb); gl.uniform4fv(P.loc('uLC[0]'), lc);
    gl.uniform1i(P.loc('uLN'), Math.min(4, L.length)); gl.uniform1f(P.loc('uMaskOn'), L.length ? 1 : 0);
  }

  // ---- pipeline complet pour une région ----
  // job : { s, ox, oy, w, h, m, forEdit, rad, outSharp }
  run(state, job, slotName) {
    const gl = this.gl, p = state.params;
    const W = job.w + 2 * job.m, H = job.h + 2 * job.m;
    const slot = (slotName && typeof slotName === 'object') ? slotName : slotName ? (this.slots[slotName] = this.slots[slotName] || {}) : {};
    const gi = geomInfo(state.geom, this.srcW, this.srcH, job.forEdit);
    const gKey = [this.srcId, job.forEdit ? 1 : 0, JSON.stringify(job.forEdit ? { a: state.geom.angle, v: state.geom.vp, h: state.geom.hp } : state.geom), job.s.toFixed(5), job.ox, job.oy, W, H].join('|');
    if (!slot.geom || slot.gKey !== gKey) {
      this.free(slot.geom); this.free(slot.nr); this.free(slot.bs); this.free(slot.bm); this.free(slot.bl);
      slot.nr = slot.bs = slot.bm = slot.bl = null; slot.nrKey = slot.bKey = null;
      slot.geom = this.tex(W, H, { mip: true }); slot.gKey = gKey;
      this.passGeom(state, job, slot.geom); this.mip(slot.geom);
    }
    let base = slot.geom;
    const nrOn = (p.nrLum || 0) > 0 || (p.nrCol || 0) > 0;
    let baseKey = gKey;
    if (nrOn) {
      const nrKey = gKey + '|' + [p.nrLum, p.nrCol, p.nrKeep, job.rad].join(',');
      if (slot.nrKey !== nrKey) {
        this.free(slot.nr); this.free(slot.bs); this.free(slot.bm); this.free(slot.bl); slot.bs = slot.bm = slot.bl = null; slot.bKey = null;
        slot.nr = this.tex(W, H, { mip: true }); slot.nrKey = nrKey;
        this.passDenoise(slot.geom, slot.nr, p, job); this.mip(slot.nr);
      }
      base = slot.nr; baseKey = slot.nrKey;
    }
    // flous (netteté / texture / clarté)
    const long = Math.max(gi.cw, gi.ch);
    const sg = [Math.max(0.6, (p.sharpRadius || 1.0) * job.s), Math.max(1.6, 3.0 * job.s), Math.min(21, Math.max(3, 0.004 * long * job.s))];
    const bKey = baseKey + '|' + sg.map(v => v.toFixed(3)).join(',');
    if (slot.bKey !== bKey) {
      this.free(slot.bs); this.free(slot.bm); this.free(slot.bl);
      slot.bs = this.blur(base, sg[0], W, H); slot.bm = this.blur(base, sg[1], W, H); slot.bl = this.blur(base, sg[2], W, H); slot.bKey = bKey;
    }
    // grade
    if (!slot.out || slot.out.w !== W || slot.out.h !== H) { this.free(slot.out); slot.out = this.tex(W, H); }
    const P = this.progs.grade;
    this.draw3(slot.out, W, H, P);
    this.bind(0, base, P, 'uT1'); this.bind(1, slot.bs, P, 'uBS'); this.bind(2, slot.bm, P, 'uBM'); this.bind(3, slot.bl, P, 'uBL');
    this.bind(4, this.lutTex, P, 'uLUT'); this.bind(5, this.maskTex, P, 'uMask');
    gl.uniform2f(P.loc('uSize'), W, H); gl.uniform2f(P.loc('uOrigin'), job.ox - job.m, job.oy - job.m); gl.uniform1f(P.loc('uScale'), job.s);
    gl.uniformMatrix3fv(P.loc('uH'), false, colMajor(gi.M)); gl.uniform2f(P.loc('uSrcSize'), this.srcW, this.srcH); gl.uniform2f(P.loc('uCropSize'), gi.cw, gi.ch);
    this.gradeUniforms(state, job, P);
    this.go();
    return { out: slot.out, before: slot.geom, W, H, m: job.m, s: job.s, ox: job.ox, oy: job.oy, cw: gi.cw, ch: gi.ch, M: gi.M };
  }

  // ---- aperçu (image entière à résolution réduite) ----
  renderPreview(state, { long = 1600, forEdit = false } = {}) {
    const gi = geomInfo(state.geom, this.srcW, this.srcH, forEdit);
    const s = Math.min(1, long / Math.max(gi.cw, gi.ch));
    const job = { s, ox: 0, oy: 0, w: Math.round(gi.cw * s), h: Math.round(gi.ch * s), m: 0, forEdit, rad: 2 };
    this.prev = this.run(state, job, 'prev'); this.prev.forEdit = forEdit; this.prev.gi = gi;
    return this.prev;
  }
  // ---- détail 100 % (région visible à l'échelle utile) ----
  renderDetail(state, { x0, y0, x1, y1, forEdit = false }, zoomFull) {
    const gi = geomInfo(state.geom, this.srcW, this.srcH, forEdit);
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(gi.cw, Math.ceil(x1)); y1 = Math.min(gi.ch, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) { this.det = null; return null; }
    const s = Math.min(1, Math.max(0.2, zoomFull));
    const MAXT = 1792;
    let sx0 = Math.floor(x0 * s / 64) * 64, sy0 = Math.floor(y0 * s / 64) * 64;
    let w = Math.min(MAXT, Math.ceil(x1 * s) - sx0), h = Math.min(MAXT, Math.ceil(y1 * s) - sy0);
    w = Math.min(w, Math.ceil(gi.cw * s) - sx0); h = Math.min(h, Math.ceil(gi.ch * s) - sy0);
    if (w < 8 || h < 8) { this.det = null; return null; }
    const job = { s, ox: sx0, oy: sy0, w, h, m: 64, forEdit, rad: 3 };
    this.det = this.run(state, job, 'det'); this.det.rect = [sx0 / s, sy0 / s, w / s, h / s]; this.det.forEdit = forEdit;
    return this.det;
  }
  clearDetail() { const s = this.slots.det; if (s) { for (const n of ['geom', 'nr', 'bs', 'bm', 'bl', 'out']) this.free(s[n]); delete this.slots.det; } this.det = null; }

  // ---- affichage ----
  display(view) {
    const gl = this.gl, P = this.progs.display, pr = this.prev; if (!pr) return;
    const dpr = view.dpr || 1, cw = this.canvas.width, ch = this.canvas.height;
    this.draw3(null, cw, ch, P);
    this.bind(0, pr.out, P, 'uA'); this.bind(1, pr.before, P, 'uB');
    const d = this.det && view.detail !== false && this.det.forEdit === pr.forEdit ? this.det : null;
    this.bind(2, d ? d.out : pr.out, P, 'uDA'); this.bind(3, d ? d.before : pr.before, P, 'uDB'); this.bind(4, this.maskTex, P, 'uMask');
    gl.uniform2f(P.loc('uView'), cw, ch);
    gl.uniform2f(P.loc('uTexSize'), pr.W, pr.H); gl.uniform1f(P.loc('uSp'), pr.s);
    gl.uniform3f(P.loc('uXf'), view.scale * dpr, view.tx * dpr, view.ty * dpr);
    gl.uniform2f(P.loc('uCrop'), pr.cw, pr.ch);
    gl.uniform1f(P.loc('uSplit'), view.split == null ? -1 : view.split * dpr);
    gl.uniform1i(P.loc('uShowB'), view.showBefore ? 1 : 0);
    if (d) { gl.uniform4f(P.loc('uDRect'), ...d.rect); gl.uniform1f(P.loc('uDOn'), 1); gl.uniform1f(P.loc('uDMargin'), d.m); gl.uniform1f(P.loc('uDScale'), d.s); gl.uniform2f(P.loc('uDSize'), d.W, d.H); }
    else { gl.uniform4f(P.loc('uDRect'), 0, 0, 0, 0); gl.uniform1f(P.loc('uDOn'), 0); gl.uniform1f(P.loc('uDMargin'), 0); gl.uniform1f(P.loc('uDScale'), 1); gl.uniform2f(P.loc('uDSize'), 1, 1); }
    gl.uniformMatrix3fv(P.loc('uH'), false, colMajor(pr.M)); gl.uniform2f(P.loc('uSrcSize'), this.srcW, this.srcH);
    gl.uniform1i(P.loc('uMaskCh'), view.maskCh == null ? -1 : view.maskCh);
    gl.uniform1f(P.loc('uClip'), view.clip ? 1 : 0);
    const bg = view.bg || [0.07, 0.075, 0.085]; gl.uniform3f(P.loc('uBg'), ...bg);
    this.go();
  }

  // ---- lecture 8 bits d'une sortie (petite) pour histogramme / analyse ----
  readSmall(res, longEdge = 256) {
    const gl = this.gl, P = this.progs.final; const k = Math.min(1, longEdge / Math.max(res.W, res.H));
    const w = Math.max(1, Math.round(res.W * k)), h = Math.max(1, Math.round(res.H * k));
    const t = this.tex(w, h, { e8: true });
    this.draw3(t, w, h, P); this.bind(0, res.out, P, 'uTex'); gl.uniform2f(P.loc('uSize'), w, h); gl.uniform2f(P.loc('uInSize'), w, h); this.go();
    const buf = new Uint8Array(w * h * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    this.free(t); return { data: buf, w, h };
  }
  histogram() {
    if (!this.prev) return null;
    const { data, w, h } = this.readSmall(this.prev, 256);
    const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
    for (let i = 0; i < w * h; i++) { const R = data[i * 4], G = data[i * 4 + 1], B = data[i * 4 + 2]; r[R]++; g[G]++; b[B]++; l[Math.round(R * LW[0] + G * LW[1] + B * LW[2])]++; }
    return { r, g, b, l, n: w * h };
  }

  // région native (échelle 1) au centre de l'image : après / avant, 8 bits — pour mesurer bruit et netteté
  regionRGBA(state, size = 512) {
    const gl = this.gl, gi = geomInfo(state.geom, this.srcW, this.srcH, false);
    const w = Math.min(size, gi.cw), h = Math.min(size, gi.ch);
    const ox = Math.max(0, Math.floor((gi.cw - w) / 2 / 64) * 64), oy = Math.max(0, Math.floor((gi.ch - h) / 2 / 64) * 64);
    this._scoreSlot = this._scoreSlot || {};
    const res = this.run(state, { s: 1, ox, oy, w: Math.min(w, gi.cw - ox), h: Math.min(h, gi.ch - oy), m: 64, forEdit: false, rad: 3 }, this._scoreSlot);
    const ww = Math.min(w, gi.cw - ox), hh = Math.min(h, gi.ch - oy), PW = ww + 128, PH = hh + 128, F = this.progs.final;
    const rd = tex => { const t8 = this.tex(PW, PH, { e8: true }); this.draw3(t8, PW, PH, F); this.bind(0, tex, F, 'uTex'); gl.uniform2f(F.loc('uSize'), PW, PH); gl.uniform2f(F.loc('uInSize'), PW, PH); this.go(); const buf = new Uint8Array(ww * hh * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, t8.fb); gl.readPixels(64, 64, ww, hh, gl.RGBA, gl.UNSIGNED_BYTE, buf); this.free(t8); return { data: buf, w: ww, h: hh }; };
    return { after: rd(res.out), before: rd(res.before) };
  }

  // ---- export par tuiles (pleine résolution ou taille cible) ----
  async exportImage(state, { width = null, outSharp = 0, quality = 'high', onProgress, sizeOverride } = {}) {
    const gi = geomInfo(state.geom, this.srcW, this.srcH, false);
    const s = width ? width / gi.cw : 1;
    const W = Math.round(gi.cw * s), H = Math.round(gi.ch * s);
    if (s > 1.001) throw new Error('Utiliser upscale() pour agrandir');
    const out = new Uint8Array(W * H * 4);
    const T = 1024, m = 64, gl = this.gl;
    const nx = Math.ceil(W / T), ny = Math.ceil(H / T); let done = 0;
    const slot = {};
    const rad = quality === 'high' ? 3 : 2;
    for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
      const ox = tx * T, oy = ty * T, w = Math.min(T, W - ox), h = Math.min(T, H - oy);
      const res = this.run(state, { s, ox, oy, w, h, m, forEdit: false, rad, outSharp }, slot);
      const F = this.progs.final, PW = w + 2 * m, PH = h + 2 * m; const t8 = this.tex(PW, PH, { e8: true });
      this.draw3(t8, PW, PH, F); this.bind(0, res.out, F, 'uTex'); gl.uniform2f(F.loc('uSize'), PW, PH); gl.uniform2f(F.loc('uInSize'), PW, PH); this.go();
      const buf = new Uint8Array(w * h * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, t8.fb); gl.readPixels(m, m, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      for (let y = 0; y < h; y++) out.set(buf.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * W + ox) * 4);
      this.free(t8);
      done++; if (onProgress) onProgress(done / (nx * ny));
      await new Promise(r => setTimeout(r, 0));
    }
    this.freeSlot(slot);
    return { w: W, h: H, data: out };
  }
  freeSlot(slot) { for (const n of ['geom', 'nr', 'bs', 'bm', 'bl', 'out']) { this.free(slot[n]); slot[n] = null; } slot.gKey = slot.nrKey = slot.bKey = null; }

  // agrandissement Lanczos pleine image (par tuiles) d'un tampon RGBA 8 bits
  async upscale(buf, w, h, f, sharp = 0.5, onProgress) {
    const gl = this.gl, P = this.progs.upscale;
    const inT = this.tex(w, h, { e8: true }); gl.bindTexture(gl.TEXTURE_2D, inT.t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const W = Math.round(w * f), H = Math.round(h * f), out = new Uint8Array(W * H * 4), T = 1024;
    const nx = Math.ceil(W / T), ny = Math.ceil(H / T); let done = 0;
    const tt = this.tex(T, T, { e8: true });
    for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
      const ox = tx * T, oy = ty * T, cw = Math.min(T, W - ox), chh = Math.min(T, H - oy);
      this.draw3(tt, T, T, P); this.bind(0, inT, P, 'uTex');
      gl.uniform2f(P.loc('uInSize'), w, h); gl.uniform2f(P.loc('uOrigin'), ox, oy); gl.uniform1f(P.loc('uF'), f); gl.uniform1f(P.loc('uSharp'), sharp); this.go();
      const tb = new Uint8Array(cw * chh * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, tt.fb); gl.readPixels(0, 0, cw, chh, gl.RGBA, gl.UNSIGNED_BYTE, tb);
      for (let y = 0; y < chh; y++) out.set(tb.subarray(y * cw * 4, (y + 1) * cw * 4), ((oy + y) * W + ox) * 4);
      done++; if (onProgress) onProgress(done / (nx * ny)); await new Promise(r => setTimeout(r, 0));
    }
    this.free(inT); this.free(tt);
    return { w: W, h: H, data: out };
  }

  // empilement : moyenne de plusieurs images de même taille (alignement par décalage entier)
  async stack(n, getBitmap, alignFn, { reject = true, onProgress } = {}) {
    const gl = this.gl, P = this.progs.stack; let w = 0, h = 0, A, B;
    const ft = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, ft);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    let used = 0;
    for (let i = 0; i < n; i++) {
      const bmp = await getBitmap(i); if (!bmp) continue;
      if (!w) { w = bmp.width; h = bmp.height; A = this.tex(w, h); B = this.tex(w, h); } else if (bmp.width !== w || bmp.height !== h) { bmp.close && bmp.close(); continue; }
      const off = used === 0 ? [0, 0] : await alignFn(bmp, i);
      gl.bindTexture(gl.TEXTURE_2D, ft); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp); bmp.close && bmp.close();
      used++;
      this.draw3(B, w, h, P); this.bind(0, A, P, 'uAcc'); this.bind(1, ft, P, 'uFrame');
      gl.uniform2f(P.loc('uOffset'), off[0], off[1]); gl.uniform2f(P.loc('uSize'), w, h); gl.uniform1f(P.loc('uN'), used); gl.uniform1f(P.loc('uThr'), reject ? 0.16 : 0);
      this.go(); [A, B] = [B, A];
      if (onProgress) onProgress((i + 1) / n); await new Promise(r => setTimeout(r, 0));
    }
    gl.deleteTexture(ft);
    const T = 1024, out = new Uint8Array(w * h * 4), t8 = this.tex(T, T, { e8: true }), C = this.progs.copy;
    for (let oy = 0; oy < h; oy += T) for (let ox = 0; ox < w; ox += T) {
      const cw = Math.min(T, w - ox), chh = Math.min(T, h - oy);
      this.draw3(t8, T, T, C); this.bind(0, A, C, 'uTex'); gl.uniform2f(C.loc('uInSize'), w, h); gl.uniform2f(C.loc('uOff'), ox, oy); this.go();
      const tb = new Uint8Array(cw * chh * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, t8.fb); gl.readPixels(0, 0, cw, chh, gl.RGBA, gl.UNSIGNED_BYTE, tb);
      for (let y = 0; y < chh; y++) out.set(tb.subarray(y * cw * 4, (y + 1) * cw * 4), ((oy + y) * w + ox) * 4);
    }
    this.free(A); this.free(B); this.free(t8);
    return { w, h, data: out, used };
  }
}
