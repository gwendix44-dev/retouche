// Cœur de l'appli : état, rendu, historique, gestes, couches de masque, ouverture des photos
import { Engine, geomInfo, GEOM_DEFAULT, outToSrc, srcToOut } from './engine.js';
import { MaskManager, smallFrom } from './masks.js';
import { DEFAULTS, CURVES, buildLUT, curvesIdentity, META } from './params.js';
import { analyzeBitmap } from './analyze.js';
import * as DB from './store.js';
import { isRaw, decodeRaw } from './raw.js';
import { $, h, toast, clamp, icon } from './ui.js';

export const A = {
  eng: null, mm: null, photo: null, st: null, hist: { stack: [], idx: -1 }, analysis: null, doneItems: new Set(), skipItems: new Set(),
  view: { scale: 1, tx: 0, ty: 0, split: null, showBefore: false, clip: false, maskCh: null, dpr: 1 },
  tool: null, tab: 'auto', learn: localStorage.getItem('learn') === '1', sel: null, showMask: false,
  brush: { size: 0.035, hard: 0.5, erase: false }, crop: { aspect: 0 }, hooks: {}, rawHalf: localStorage.getItem('rawHalf') === '1', zoomFit: true, stageW: 300, stageH: 300,
};
let gl, ov, ctx, stage, raf = 0, dirty = 0, lastCW = 0, lastCH = 0, detailT = 0, histoT = 0, saveT = 0;
const PREV = () => Math.min(A.eng ? A.eng.maxTex : 2048, (innerWidth > 900 ? 2200 : 1600));

export const newState = () => ({ params: DEFAULTS(), geom: GEOM_DEFAULT(), curves: CURVES(), layers: [] });
export const visibleLayers = () => A.st.layers.filter(l => l.visible).slice(0, 4);

// ---------- initialisation ----------
export function initApp() {
  gl = $('#gl'); ov = $('#ov'); stage = $('#stage'); ctx = ov.getContext('2d');
  A.eng = new Engine(gl);
  gl.addEventListener('webglcontextlost', e => { e.preventDefault(); toast('Le GPU a été réinitialisé. Rouvre la photo si l\'image disparaît.', 5000); });
  gl.addEventListener('webglcontextrestored', async () => { A.eng.init(); if (A.photo) { loadSourceIntoEngine(); syncAll(); } });
  A.st = newState();
  const ro = new ResizeObserver(resize); ro.observe(stage); resize();
  bindPointer();
  window.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); } if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); redo(); } });
}
function resize() {
  const r = stage.getBoundingClientRect(); A.stageW = r.width; A.stageH = r.height; const dpr = Math.min(3, window.devicePixelRatio || 1); A.view.dpr = dpr;
  gl.width = Math.round(r.width * dpr); gl.height = Math.round(r.height * dpr); ov.width = gl.width; ov.height = gl.height;
  if (A.photo && A.zoomFit) fit(); redraw(0);
}

// ---------- rendu ----------
export function redraw(pipeline = 1) { dirty |= pipeline ? 3 : 2; if (!raf) raf = requestAnimationFrame(frame); }
function frame() {
  raf = 0; const d = dirty; dirty = 0; if (!A.photo) return;
  try {
    if (d & 1) {
      A.eng.renderPreview(A.st, { long: PREV(), forEdit: A.tool === 'crop' });
      A.eng.clearDetail();
      const p = A.eng.prev; if (p.cw !== lastCW || p.ch !== lastCH) { lastCW = p.cw; lastCH = p.ch; if (A.zoomFit) fit(); }
      clearTimeout(histoT); histoT = setTimeout(drawHisto, 140);
    }
    A.eng.display(viewState()); drawOverlay();
    if (d & 1) scheduleDetail(); else if (d & 2 && A.eng.det === null) scheduleDetail();
  } catch (e) { console.error(e); toast('Erreur de rendu : ' + e.message.slice(0, 120), 6000); }
}
const viewState = () => Object.assign({}, A.view, { maskCh: A.showMask && A.sel ? maskChannel(A.sel) : null });
function maskChannel(id) { const i = visibleLayers().findIndex(l => l.id === id); return i < 0 ? null : i; }
export function scheduleDetail(delay = 220) { clearTimeout(detailT); detailT = setTimeout(renderDetailNow, delay); }
function renderDetailNow() {
  if (!A.photo || !A.eng.prev) return; const v = A.view, dpr = v.dpr, zf = v.scale * dpr, p = A.eng.prev;
  if (zf <= p.s * 1.12) { if (A.eng.det) { A.eng.clearDetail(); redraw(0); } return; }
  let x0 = -v.tx / v.scale, y0 = -v.ty / v.scale, x1 = (A.stageW - v.tx) / v.scale, y1 = (A.stageH - v.ty) / v.scale;
  const s = Math.min(1, zf), maxFull = 1600 / s, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (x1 - x0 > maxFull) { x0 = cx - maxFull / 2; x1 = cx + maxFull / 2; } if (y1 - y0 > maxFull) { y0 = cy - maxFull / 2; y1 = cy + maxFull / 2; }
  try { A.eng.renderDetail(A.st, { x0, y0, x1, y1, forEdit: A.tool === 'crop' }, zf); A.eng.display(viewState()); drawOverlay(); } catch (e) { console.warn(e); }
}
function drawHisto() {
  const c = $('#histo'); if (!c || !A.photo || !A.eng.prev) return; const H = A.eng.histogram(); if (!H) return; A.histData = H; const g = c.getContext('2d'); const w = c.width, hh = c.height;
  g.clearRect(0, 0, w, hh); const mx = Math.max(1, ...Array.from(H.l.slice(2, 254)).map(v => v)) * 1.05;
  const draw = (arr, col, fill) => { g.beginPath(); g.moveTo(0, hh); for (let i = 0; i < 256; i++) { const v = Math.min(1, arr[i] / mx); g.lineTo(i / 255 * w, hh - v * (hh - 4)); } g.lineTo(w, hh); g.closePath(); if (fill) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = col; g.lineWidth = 1.5; g.stroke(); } };
  draw(H.l, 'rgba(230,235,240,.35)', true); draw(H.r, 'rgba(255,90,90,.8)'); draw(H.g, 'rgba(90,220,120,.8)'); draw(H.b, 'rgba(90,150,255,.85)');
  if (A.hooks.onHisto) A.hooks.onHisto(H);
}

// ---------- vue ----------
export function fit(pad = 0.97) {
  const p = A.eng.prev; if (!p) return; const cw = p.cw, ch = p.ch; const s = Math.min(A.stageW / cw, A.stageH / ch) * pad;
  A.view.scale = s; A.view.tx = (A.stageW - cw * s) / 2; A.view.ty = (A.stageH - ch * s) / 2; A.zoomFit = true; A.fitScale = s; syncZoomChip();
}
export function zoomAt(x, y, ns) {
  const v = A.view; const fs = A.fitScale || 1; ns = clamp(ns, fs * 0.6, 10); const fx = (x - v.tx) / v.scale, fy = (y - v.ty) / v.scale; v.scale = ns; v.tx = x - fx * ns; v.ty = y - fy * ns; A.zoomFit = Math.abs(ns - fs) < fs * 0.02; syncZoomChip(); redraw(0); scheduleDetail();
}
export function toggleZoom(x = A.stageW / 2, y = A.stageH / 2) {
  const v = A.view; const one = 1 / v.dpr; if (A.zoomFit || Math.abs(v.scale - A.fitScale) < A.fitScale * 0.05) { zoomAt(x, y, Math.max(one, A.fitScale * 1.5)); } else { fit(); redraw(0); scheduleDetail(); }
}
function syncZoomChip() { const c = $('#cZoom'); if (c) { const pct = Math.round(A.view.scale * A.view.dpr * 100); c.textContent = A.zoomFit ? 'Ajuster' : pct + ' %'; } }
export const screenToFull = (x, y) => [(x - A.view.tx) / A.view.scale, (y - A.view.ty) / A.view.scale];
export const fullToScreen = (x, y) => [x * A.view.scale + A.view.tx, y * A.view.scale + A.view.ty];
const forEdit = () => A.tool === 'crop';
export function fullToSrcN(fx, fy) { const [sx, sy] = outToSrc(A.st.geom, A.eng.srcW, A.eng.srcH, forEdit(), fx, fy); return [sx / A.eng.srcW, sy / A.eng.srcH]; }
export function srcNToFull(nx, ny) { return srcToOut(A.st.geom, A.eng.srcW, A.eng.srcH, forEdit(), nx * A.eng.srcW, ny * A.eng.srcH); }

// ---------- état -> moteur ----------
export function syncCurves() { A.eng.curveOn = !curvesIdentity(A.st.curves); A.eng.setLUT(A.eng.curveOn ? buildLUT(A.st.curves) : null); }
export function syncLayers(masks = true) {
  const vis = visibleLayers(); A.eng.setLayers(vis);
  if (masks && A.mm) { A.eng.setMask(A.mm.pack(vis), A.mm.mw, A.mm.mh); }
}
export function syncAll() { syncCurves(); syncLayers(true); redraw(1); if (A.hooks.refresh) A.hooks.refresh(); updateButtons(); }
export function changed() { redraw(1); }

// ---------- historique ----------
const snap = () => JSON.stringify({ params: A.st.params, geom: A.st.geom, curves: A.st.curves, layers: A.st.layers });
export function commit(label) {
  const s = snap(); const H = A.hist; if (H.idx >= 0 && H.stack[H.idx].s === s) return;
  H.stack.splice(H.idx + 1); H.stack.push({ label, s, t: Date.now() }); H.idx = H.stack.length - 1; updateButtons(); autosave(); if (A.hooks.onCommit) A.hooks.onCommit(label);
}
export function restore(i) { const H = A.hist; if (i < 0 || i >= H.stack.length) return; H.idx = i; Object.assign(A.st, JSON.parse(H.stack[i].s)); if (!A.st.layers.find(l => l.id === A.sel)) A.sel = null; syncAll(); autosave(); }
export const undo = () => restore(A.hist.idx - 1);
export const redo = () => restore(A.hist.idx + 1);
export function updateButtons() { const u = $('#bUndo'), r = $('#bRedo'); if (u) { u.disabled = A.hist.idx <= 0; r.disabled = A.hist.idx >= A.hist.stack.length - 1; } }
export function resetAll() { A.st = newState(); A.sel = null; A.tool = null; commit('Tout réinitialiser'); syncAll(); }

// ---------- sauvegarde locale ----------
export function autosave() {
  clearTimeout(saveT); saveT = setTimeout(async () => {
    if (!A.photo) return; try {
      let thumbAfter = A.photo.thumbAfter; if (A.eng.prev) { const r = A.eng.readSmall(A.eng.prev, 320); thumbAfter = toDataURL(r.data, r.w, r.h); A.photo.thumbAfter = thumbAfter; }
      await DB.put('photos', { id: A.photo.id, name: A.photo.name, blob: A.photo.blob, state: snap(), w: A.photo.w, h: A.photo.h, updated: Date.now(), thumb: A.photo.thumb, thumbAfter, steps: A.hist.stack.slice(1, A.hist.idx + 1).map(s => s.label), rawHalf: A.photo.rawHalf, scoreBefore: A.photo.scoreBefore });
    } catch (e) { console.warn('sauvegarde impossible', e); }
  }, 1200);
}
export function toDataURL(data, w, h, q = 0.8) { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w, h), 0, 0); return c.toDataURL('image/jpeg', q); }

// ---------- ouverture d'une photo ----------
export function busy(on, text, p) { const b = $('#busy'); b.classList.toggle('on', !!on); if (text) $('#busyT').textContent = text; $('#busyB').style.width = p == null ? '8%' : Math.round(p * 100) + '%'; }
function loadSourceIntoEngine() { const P = A.photo; if (P.half16) A.eng.loadSourceHalf(P.half16, P.bitmap); else A.eng.loadSource(P.bitmap); }

export async function decodeFile(file, onStatus) {
  let bitmap, half16 = null, source = 'jpeg';
  if (isRaw(file)) {
    const r = await decodeRaw(file, { half: A.rawHalf, canHalfFloat: A.eng.fmt.half, onStatus }); bitmap = r.bitmap; half16 = r.half16; source = r.source;
    if (A.eng.maxTex < Math.max(bitmap.width, bitmap.height)) half16 = null;
  } else {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
    const mx = A.eng.maxTex, long = Math.max(bitmap.width, bitmap.height);
    if (long > mx) { const k = mx / long; bitmap.close(); bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: Math.floor(bitmap.width * k) || undefined, resizeQuality: 'high' }); toast(`Photo réduite à ${bitmap.width}×${bitmap.height} (limite de cet appareil).`, 5000); }
  }
  return { bitmap, half16, source };
}

export async function openPhoto(file, record = null) {
  busy(true, 'Ouverture…', 0.1);
  try { const d = await decodeFile(file, t => busy(true, t, 0.3)); await openDecoded(d, file, record); }
  catch (e) { console.error(e); busy(false); toast('Impossible d\'ouvrir : ' + (e.message || e), 6000); }
}
// Certains téléphones affichent noir (texture trop grande / flottants 16 bits). On vérifie le rendu et on se replie par étapes.
function rendersBlack() {
  try { const e = A.eng; e.renderPreview(A.st, { long: PREV(), forEdit: false }); const r = e.prev ? e.readSmall(e.prev, 96) : null; if (!r) return false; const d = r.data; for (let i = 0; i < d.length; i += 4) if (d[i] > 2 || d[i + 1] > 2 || d[i + 2] > 2) return false; return true; } catch (e) { return true; }
}
async function ensureVisible(P, d) {
  await new Promise(r => setTimeout(r, 60));
  if (!A.eng.srcTex) return;
  let steps = 0;
  const bm = d.bitmap; if (!rendersBlackOnLightPhoto(P)) return;
  // 1) pipeline 8 bits
  if (A.eng.fmt.half) { A.eng.fmt = { ifmt: A.eng.gl.RGBA8, type: A.eng.gl.UNSIGNED_BYTE, half: false }; A.eng.purge(); A.eng.invalidate(); if (!rendersBlackOnLightPhoto(P)) { redraw(1); toast('Mode compatible activé (8 bits).', 3500); return; } }
  // 2) source réduite par paliers
  let cur = P.bitmap; const long0 = Math.max(cur.width, cur.height);
  for (const lim of [3600, 3000, 2400, 1800]) {
    if (long0 <= lim) continue; steps++;
    const k = lim / long0; const nb = await createImageBitmap(P.bitmap, { resizeWidth: Math.round(P.bitmap.width * k), resizeHeight: Math.round(P.bitmap.height * k), resizeQuality: 'high' });
    A.eng.purge(); A.eng.loadSource(nb); P.w = nb.width; P.h = nb.height; A.eng.srcBitmap = nb; fit();
    if (!rendersBlackOnLightPhoto(P)) { redraw(1); toast(`Photo affichée à ${nb.width}×${nb.height} : limite de la mémoire graphique de ce téléphone.`, 6000); return; }
  }
}
function rendersBlackOnLightPhoto(P) { return rendersBlack() && !isBlackPhoto(P); }
function isBlackPhoto(P) { try { const t = smallFrom(P.bitmap, 48); const d = t.data; let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i], d[i + 1], d[i + 2]); return m < 6; } catch { return false; } }

export async function openDecoded(d, file, record = null) {
  try {
    busy(true, 'Préparation…', 0.6);
    const P = A.photo = { id: record ? record.id : DB.uid(), name: file.name || (record && record.name) || 'photo', blob: file, w: d.bitmap.width, h: d.bitmap.height, bitmap: d.bitmap, half16: d.half16, source: d.source, rawHalf: A.rawHalf };
    A.eng.purge(); loadSourceIntoEngine(); A.half16 = null;
    if (!record) { const t = smallFrom(d.bitmap, 320); P.thumb = toDataURL(t.data, t.w, t.h); } else { P.thumb = record.thumb; P.thumbAfter = record.thumbAfter; P.scoreBefore = record.scoreBefore; }
    A.mm = new MaskManager(); A.mm.setSource(d.bitmap);
    A.st = newState(); if (record && record.state) { try { Object.assign(A.st, JSON.parse(record.state)); } catch { } }
    A.sel = null; A.tool = null; A.showMask = false; A.doneItems = new Set(); A.skipItems = new Set(); A.analysis = null; A.view.split = null; A.view.showBefore = false;
    A.hist = { stack: [], idx: -1 }; A.hist.stack.push({ label: record ? 'Reprise de la retouche' : 'Photo ouverte', s: snap(), t: Date.now() }); A.hist.idx = 0;
    A.tab = 'auto'; A.zoomFit = true; lastCW = lastCH = 0;
    $('#ttl').textContent = P.name + (d.source === 'preview' ? ' — aperçu RAW' : ''); $('#home').classList.add('hide'); $('#app').classList.add('on');
    syncAll(); fit(); await ensureVisible(P, d); busy(false);
    if (d.source === 'preview') toast('Décodage RAW indisponible : aperçu JPEG intégré utilisé (moins de marge de récupération).', 6000);
    else if (d.source === 'raw') toast(d.half16 ? 'RAW 16 bits chargé : marge de récupération maximale.' : 'RAW chargé (8 bits sur cet appareil).', 4000);
    runAnalysis(); DB.persist(); autosave();
  } catch (e) { console.error(e); busy(false); toast('Impossible d\'ouvrir : ' + (e.message || e), 6000); }
}

export async function runAnalysis() {
  const P = A.photo; if (!P) return; await new Promise(r => setTimeout(r, 30));
  try { const r = await analyzeBitmap(P.bitmap, A.mm); if (A.photo !== P) return; A.analysis = r; if (P.scoreBefore == null) P.scoreBefore = r.score; if (A.hooks.refresh) A.hooks.refresh(); } catch (e) { console.warn('analyse', e); }
}

// ---------- couches (zones) ----------
const LNAMES = { sky: 'Ciel', subject: 'Sujet', ground: 'Sol', linear: 'Dégradé', radial: 'Radial', brush: 'Pinceau', wand: 'Sélection', all: 'Tout' };
export function newLayer(kind, params = {}, name) {
  const feather = { sky: 6, subject: 3, ground: 10, brush: 5, wand: 3 }[kind] || 0;
  const mask = { kind, seeds: [], tol: 0.09, strokes: [], invert: false, feather, edge: kind === 'subject' ? -30 : 0 };
  if (kind === 'linear') mask.grad = { x0: 0.5, y0: 0, x1: 0.5, y1: 0.45 };
  if (kind === 'radial') mask.rad = { cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.22, rot: 0, feather: 0.55 };
  return { id: DB.uid(), name: name || LNAMES[kind], kind, visible: true, params: Object.assign({}, params), mask };
}
export function addLayer(kind, params = {}, label) {
  if (A.st.layers.length >= 4) { toast('4 zones au maximum. Supprime-en une.'); return null; }
  const l = newLayer(kind, params); A.st.layers.push(l); A.sel = l.id; A.showMask = true; syncLayers(true); redraw(1); commit(label || ('Zone ' + l.name.toLowerCase()));
  setTimeout(() => { A.showMask = false; redraw(0); }, 1400);
  if (['sky', 'subject'].includes(kind) && A.mm.stats(l) < 0.002) toast(kind === 'subject' ? 'Sujet non détecté automatiquement : touche-le avec la baguette.' : 'Ciel non détecté : utilise le pinceau.', 5000);
  if (A.hooks.refresh) A.hooks.refresh(); return l;
}
export function removeLayer(id) { A.st.layers = A.st.layers.filter(l => l.id !== id); if (A.sel === id) A.sel = null; syncLayers(true); redraw(1); commit('Zone supprimée'); if (A.hooks.refresh) A.hooks.refresh(); }
export const selLayer = () => A.st.layers.find(l => l.id === A.sel) || null;
export function maskDirty() { syncLayers(true); redraw(1); }

// ---------- suggestions ----------
export function applyItem(it, quiet = false) {
  const P = A.st.params;
  if (it.set) for (const [k, v] of Object.entries(it.set)) { const m = META[k]; P[k] = m ? clamp(v, m[1], m[2]) : v; }
  if (it.layer) {
    let l = A.st.layers.find(x => x.kind === it.layer.kind);
    if (l) { Object.assign(l.params, it.layer.params); l.visible = true; } else { l = newLayer(it.layer.kind, it.layer.params, it.layer.name); if (A.st.layers.length < 4) { A.st.layers.push(l); } else { toast('4 zones au maximum.'); return; } }
    A.sel = l.id;
  }
  if (it.geom) { A.st.geom.angle = it.geom.angle; shrinkCrop(); }
  if (it.crop) A.st.geom.crop = Object.assign({}, it.crop);
  A.doneItems.add(it.id); syncAll(); if (!quiet) commit(it.title);
}
export function applyAuto() {
  const items = (A.analysis ? A.analysis.items : []).filter(i => !i.info && !A.doneItems.has(i.id) && !A.skipItems.has(i.id) && i.sev >= 0.3 && i.id !== 'crop' && !i.layer);
  if (!items.length) { toast('Rien d\'important à corriger globalement. Regarde les zones (ciel, sujet) dans la liste.'); return 0; }
  items.forEach(i => applyItem(i, true)); commit('Correction en un geste'); return items.length;
}

// ---------- recadrage ----------
export function cornersInside(c, angle) {
  const { srcW: sw, srcH: sh } = A.eng; const t = angle * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
  return [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]].every(([x, y]) => { const fx = x * sw - sw / 2, fy = y * sh - sh / 2; const sx = cs * fx - sn * fy + sw / 2, sy = sn * fx + cs * fy + sh / 2; return sx >= -0.5 && sx <= sw + 0.5 && sy >= -0.5 && sy <= sh + 0.5; });
}
export function shrinkCrop() {
  const g = A.st.geom; if (!g.angle) return; let c = Object.assign({}, g.crop); let n = 0;
  while (!cornersInside(c, g.angle) && n++ < 600) { const cx = c.x + c.w / 2, cy = c.y + c.h / 2; c.w *= 0.996; c.h *= 0.996; c.x = cx - c.w / 2; c.y = cy - c.h / 2; if (n > 300) { c.x = (1 - c.w) / 2; c.y = (1 - c.h) / 2; } }
  g.crop = c;
}

// ---------- gestes ----------
const Ptr = new Map(); let G = null, lastTap = 0, lastTapPos = [0, 0], hover = null;
function local(e) { const r = ov.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function bindPointer() {
  ov.addEventListener('pointerdown', onDown); ov.addEventListener('pointermove', onMove); ov.addEventListener('pointerup', onUp); ov.addEventListener('pointercancel', onUp);
  ov.addEventListener('wheel', e => { e.preventDefault(); if (!A.photo) return; const [x, y] = local(e); zoomAt(x, y, A.view.scale * Math.exp(-e.deltaY * 0.0016)); }, { passive: false });
  ov.addEventListener('pointerleave', () => { hover = null; if (A.tool === 'brush') drawOverlay(); });
}
function onDown(e) {
  if (!A.photo) return; ov.setPointerCapture(e.pointerId); const [x, y] = local(e); Ptr.set(e.pointerId, { x, y, x0: x, y0: y, t: performance.now() });
  if (Ptr.size === 2) { endStroke(true); const [a, b] = [...Ptr.values()]; const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; G = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), s0: A.view.scale, anchor: screenToFull(mx, my) }; return; }
  if (Ptr.size > 2) return;
  const v = A.view;
  if (v.split != null && Math.abs(x - v.split) < 30) { G = { type: 'split' }; return; }
  if (A.tool === 'crop') { const hd = hitCrop(x, y); G = { type: 'crop', hd, start: [x, y], c0: Object.assign({}, A.st.geom.crop) }; if (!hd) G = { type: 'pan', tx0: v.tx, ty0: v.ty, x0: x, y0: y }; return; }
  if (A.tool === 'grad') { const hd = hitGrad(x, y); if (hd) { G = { type: 'grad', hd }; return; } }
  if (A.tool === 'brush' && selLayer()) { G = { type: 'paint' }; startStroke(x, y); return; }
  G = { type: 'pan', tx0: v.tx, ty0: v.ty, x0: x, y0: y };
}
function onMove(e) {
  const [x, y] = local(e); hover = [x, y]; const p = Ptr.get(e.pointerId);
  if (!p) { if (A.tool === 'brush') drawOverlay(); return; } p.x = x; p.y = y; const v = A.view;
  if (!G) return;
  if (G.type === 'pinch' && Ptr.size >= 2) {
    const [a, b] = [...Ptr.values()]; const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y);
    const ns = clamp(G.s0 * d / Math.max(1, G.d0), (A.fitScale || 1) * 0.6, 10); v.scale = ns; v.tx = mx - G.anchor[0] * ns; v.ty = my - G.anchor[1] * ns; A.zoomFit = Math.abs(ns - A.fitScale) < A.fitScale * 0.02; syncZoomChip(); redraw(0); scheduleDetail(350);
  } else if (G.type === 'pan') { v.tx = G.tx0 + (x - G.x0); v.ty = G.ty0 + (y - G.y0); if (Math.hypot(x - G.x0, y - G.y0) > 3) A.zoomFit = false; redraw(0); scheduleDetail(350); }
  else if (G.type === 'split') { v.split = clamp(x, 20, A.stageW - 20); redraw(0); }
  else if (G.type === 'paint') { addStrokePoint(x, y); }
  else if (G.type === 'crop') dragCrop(x, y);
  else if (G.type === 'grad') dragGrad(x, y);
}
function onUp(e) {
  const p = Ptr.get(e.pointerId); Ptr.delete(e.pointerId); if (!p) return; const moved = Math.hypot(p.x - p.x0, p.y - p.y0), dt = performance.now() - p.t;
  if (G && G.type === 'paint') endStroke(false);
  if (G && G.type === 'crop') { A.st.geom.crop = clampCrop(A.st.geom.crop); commit('Recadrage'); redraw(0); if (A.hooks.refresh) A.hooks.refresh(); }
  if (G && G.type === 'grad') { maskDirty(); commit('Dégradé'); }
  if (G && G.type === 'split') { /* rien */ }
  else if (G && G.type === 'pan' && moved < 6 && dt < 350) {
    if (A.tool === 'wand') addSeed(p.x, p.y);
    else { const now = performance.now(); if (now - lastTap < 320 && Math.hypot(p.x - lastTapPos[0], p.y - lastTapPos[1]) < 30) { toggleZoom(p.x, p.y); lastTap = 0; } else { lastTap = now; lastTapPos = [p.x, p.y]; } }
  }
  if (Ptr.size === 1 && G && G.type === 'pinch') { const [q] = [...Ptr.values()]; G = { type: 'pan', tx0: A.view.tx, ty0: A.view.ty, x0: q.x, y0: q.y }; q.x0 = q.x; q.y0 = q.y; return; }
  if (Ptr.size === 0) G = null;
}

// -- pinceau --
let stroke = null, strokeRaf = 0;
function startStroke(x, y) {
  const l = selLayer(); if (!l) return; stroke = { r: A.brush.size, hard: A.brush.hard, erase: A.brush.erase, pts: [] }; l.mask.strokes.push(stroke); addStrokePoint(x, y);
}
function addStrokePoint(x, y) {
  if (!stroke) return; const [fx, fy] = screenToFull(x, y); const [nx, ny] = fullToSrcN(fx, fy); const last = stroke.pts[stroke.pts.length - 1];
  if (last && Math.hypot((nx - last[0]) * A.eng.srcW, (ny - last[1]) * A.eng.srcH) < A.eng.srcW * 0.0015) return;
  stroke.pts.push([nx, ny]); A.showMask = true; if (!strokeRaf) strokeRaf = requestAnimationFrame(() => { strokeRaf = 0; syncLayers(true); redraw(1); });
}
function endStroke(cancel) { if (!stroke) return; const s = stroke; stroke = null; if (s.pts.length === 0) { const l = selLayer(); l && l.mask.strokes.pop(); return; } syncLayers(true); redraw(1); commit(s.erase ? 'Gomme' : 'Pinceau'); setTimeout(() => { if (!stroke) { A.showMask = false; redraw(0); } }, 1200); }
function addSeed(x, y) {
  const l = selLayer(); if (!l) return; const [fx, fy] = screenToFull(x, y); const [nx, ny] = fullToSrcN(fx, fy); if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
  if (l.mask.kind !== 'wand') { if (l.mask.kind === 'subject' || l.mask.kind === 'sky' || l.mask.kind === 'ground') { /* on convertit en sélection baguette */ } l.mask.kind = 'wand'; l.mask.seeds = []; l.name = l.name === 'Avion' ? l.name : l.name; }
  l.mask.seeds.push({ x: nx, y: ny }); A.showMask = true; maskDirty(); commit('Baguette'); setTimeout(() => { A.showMask = false; redraw(0); }, 1500);
}

// -- recadrage interactif --
function cropRectScreen() { const c = A.st.geom.crop, { srcW: sw, srcH: sh } = A.eng; const [x0, y0] = fullToScreen(c.x * sw, c.y * sh), [x1, y1] = fullToScreen((c.x + c.w) * sw, (c.y + c.h) * sh); return [x0, y0, x1, y1]; }
function hitCrop(x, y) {
  const [x0, y0, x1, y1] = cropRectScreen(), T = 26; const nx = Math.abs(x - x0) < T, fx = Math.abs(x - x1) < T, ny = Math.abs(y - y0) < T, fy = Math.abs(y - y1) < T;
  const inX = x > x0 - T && x < x1 + T, inY = y > y0 - T && y < y1 + T;
  if (nx && ny) return 'nw'; if (fx && ny) return 'ne'; if (nx && fy) return 'sw'; if (fx && fy) return 'se';
  if (ny && inX) return 'n'; if (fy && inX) return 's'; if (nx && inY) return 'w'; if (fx && inY) return 'e';
  if (x > x0 && x < x1 && y > y0 && y < y1) return 'move'; return null;
}
function clampCrop(c) { c.w = clamp(c.w, 0.04, 1); c.h = clamp(c.h, 0.04, 1); c.x = clamp(c.x, 0, 1 - c.w); c.y = clamp(c.y, 0, 1 - c.h); if (A.st.geom.angle && !cornersInside(c, A.st.geom.angle)) { const g = A.st.geom; const keep = g.crop; g.crop = c; shrinkCrop(); c = g.crop; g.crop = keep; } return c; }
function dragCrop(x, y) {
  const { srcW: sw, srcH: sh } = A.eng, s = A.view.scale, c0 = G.c0; const dx = (x - G.start[0]) / s / sw, dy = (y - G.start[1]) / s / sh; let c = Object.assign({}, c0); const hd = G.hd; const asp = A.crop.aspect ? A.crop.aspect * sh / sw : 0; // rapport w/h normalisé
  if (hd === 'move') { c.x = clamp(c0.x + dx, 0, 1 - c.w); c.y = clamp(c0.y + dy, 0, 1 - c.h); }
  else {
    let x0 = c0.x, y0 = c0.y, x1 = c0.x + c0.w, y1 = c0.y + c0.h;
    if (hd.includes('w')) x0 = clamp(c0.x + dx, 0, x1 - 0.04); if (hd.includes('e')) x1 = clamp(c0.x + c0.w + dx, x0 + 0.04, 1);
    if (hd.includes('n')) y0 = clamp(c0.y + dy, 0, y1 - 0.04); if (hd.includes('s')) y1 = clamp(c0.y + c0.h + dy, y0 + 0.04, 1);
    if (asp) { let w = x1 - x0, hh = y1 - y0; if (hd === 'n' || hd === 's') { w = hh * asp; const cx = (c0.x + c0.w / 2); x0 = cx - w / 2; x1 = cx + w / 2; } else { hh = w / asp; if (hd.includes('n')) y0 = y1 - hh; else if (hd.includes('s')) y1 = y0 + hh; else { const cy = c0.y + c0.h / 2; y0 = cy - hh / 2; y1 = cy + hh / 2; } } if (hd.includes('w') && hd.length === 2) { /* ancre à l'opposé */ } if (y0 < 0 || y1 > 1 || x0 < 0 || x1 > 1) { return; } }
    c = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if (A.st.geom.angle && !cornersInside(c, A.st.geom.angle)) return;
  A.st.geom.crop = c; redraw(0);
}
export function setCropAspect(a) {
  A.crop.aspect = a; if (!a) return; const g = A.st.geom, { srcW: sw, srcH: sh } = A.eng; let c = g.crop; const cx = c.x + c.w / 2, cy = c.y + c.h / 2; let w = c.w * sw, hh = w / a; if (hh > c.h * sh) { hh = c.h * sh; w = hh * a; }
  c = { x: cx - w / sw / 2, y: cy - hh / sh / 2, w: w / sw, h: hh / sh }; g.crop = clampCrop(c); commit('Format de recadrage'); redraw(0);
}

// -- dégradés interactifs --
function gradHandles() {
  const l = selLayer(); if (!l) return null; const m = l.mask;
  if (m.kind === 'linear') { const g = m.grad; return [{ id: 'p0', n: [g.x0, g.y0] }, { id: 'p1', n: [g.x1, g.y1] }]; }
  if (m.kind === 'radial') { const r = m.rad; return [{ id: 'c', n: [r.cx, r.cy] }, { id: 'rx', n: [r.cx + r.rx, r.cy] }, { id: 'ry', n: [r.cx, r.cy + r.ry] }]; }
  return null;
}
function hitGrad(x, y) { const H = gradHandles(); if (!H) return null; for (const hd of H) { const [fx, fy] = srcNToFull(...hd.n); const [sx, sy] = fullToScreen(fx, fy); if (Math.hypot(sx - x, sy - y) < 30) return hd.id; } return null; }
function dragGrad(x, y) {
  const l = selLayer(); if (!l) return; const [fx, fy] = screenToFull(x, y); const [nx, ny] = fullToSrcN(fx, fy); const m = l.mask;
  if (m.kind === 'linear') { if (G.hd === 'p0') { m.grad.x0 = nx; m.grad.y0 = ny; } else { m.grad.x1 = nx; m.grad.y1 = ny; } }
  else { const r = m.rad; if (G.hd === 'c') { r.cx = clamp(nx, 0, 1); r.cy = clamp(ny, 0, 1); } else if (G.hd === 'rx') r.rx = clamp(Math.abs(nx - r.cx), 0.03, 1); else r.ry = clamp(Math.abs(ny - r.cy), 0.03, 1); }
  if (!A.showMask) A.showMask = true; maskDirty();
}

// ---------- surcouche ----------
export function drawOverlay() {
  if (!ctx) return; const dpr = A.view.dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, A.stageW, A.stageH); if (!A.photo || !A.eng.prev) return;
  const { srcW: sw, srcH: sh } = A.eng; const v = A.view;
  if (A.tool === 'crop') {
    const [x0, y0, x1, y1] = cropRectScreen(); const p = A.eng.prev; const [ix0, iy0] = fullToScreen(0, 0), [ix1, iy1] = fullToScreen(p.cw, p.ch);
    ctx.fillStyle = 'rgba(6,8,10,.62)'; ctx.beginPath(); ctx.rect(ix0, iy0, ix1 - ix0, iy1 - iy0); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.fill('evenodd');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 1; i < 3; i++) { ctx.moveTo(x0 + (x1 - x0) * i / 3, y0); ctx.lineTo(x0 + (x1 - x0) * i / 3, y1); ctx.moveTo(x0, y0 + (y1 - y0) * i / 3); ctx.lineTo(x1, y0 + (y1 - y0) * i / 3); } ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; const L = 18; ctx.beginPath(); for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) { ctx.moveTo(cx + dx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * L); } ctx.stroke();
    for (const [cx, cy] of [[(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]]) { ctx.fillStyle = '#fff'; ctx.fillRect(cx - 9, cy - 2, 18, 4); }
    const c = A.st.geom.crop; ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.font = '12px system-ui'; const t = `${Math.round(c.w * sw)} × ${Math.round(c.h * sh)}`; const tw = ctx.measureText(t).width + 12; ctx.fillRect(x0 + 6, y0 + 6, tw, 20); ctx.fillStyle = '#fff'; ctx.fillText(t, x0 + 12, y0 + 20);
  }
  if (A.tool === 'grad') {
    const H = gradHandles(), l = selLayer(); if (H && l) {
      const pts = H.map(hd => fullToScreen(...srcNToFull(...hd.n))); ctx.lineWidth = 2; ctx.strokeStyle = '#ffd24a'; ctx.fillStyle = '#ffd24a';
      if (l.mask.kind === 'linear') { ctx.beginPath(); ctx.moveTo(...pts[0]); ctx.lineTo(...pts[1]); ctx.stroke(); } else { const [cx, cy] = pts[0], rx = Math.abs(pts[1][0] - cx), ry = Math.abs(pts[2][1] - cy); ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); }
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p[0], p[1], 11, 0, 7); ctx.fillStyle = 'rgba(255,210,74,.25)'; ctx.fill(); ctx.strokeStyle = '#ffd24a'; ctx.stroke(); ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 7); ctx.fillStyle = '#ffd24a'; ctx.fill(); });
    }
  }
  if (A.tool === 'brush' && (hover || stroke)) { const r = A.brush.size * Math.max(sw, sh) * v.scale; const [x, y] = hover || [A.stageW / 2, A.stageH / 2]; ctx.strokeStyle = A.brush.erase ? '#ff7a7a' : '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, Math.max(3, r), 0, 7); ctx.stroke(); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(x, y, Math.max(3, r) + 1.5, 0, 7); ctx.stroke(); }
  if (A.tool === 'wand') { const l = selLayer(); if (l && l.mask.seeds) for (const s of l.mask.seeds) { const [fx, fy] = srcNToFull(s.x, s.y); const [x, y] = fullToScreen(fx, fy); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.stroke(); ctx.fillStyle = '#4da3ff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); } }
  if (v.split != null) { const x = v.split, y = A.stageH / 2; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 16, 0, 7); ctx.fill(); ctx.fillStyle = '#16191e'; ctx.font = '600 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('◂▸', x, y + 4); ctx.textAlign = 'start'; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(10, A.stageH - 30, 52, 22); ctx.fillRect(A.stageW - 62, A.stageH - 30, 52, 22); ctx.fillStyle = '#fff'; ctx.font = '12px system-ui'; ctx.fillText('Avant', 18, A.stageH - 15); ctx.fillText('Après', A.stageW - 54, A.stageH - 15); }
}
export function setTool(t) {
  A.tool = A.tool === t ? null : t; const wasCrop = !A.tool; A.showMask = A.tool === 'grad'; if (A.tool !== 'crop') { A.st.geom.crop = clampCrop(A.st.geom.crop); }
  A.zoomFit = true; lastCW = 0; redraw(1); const hint = $('#hint');
  const msg = { crop: 'Glisse les coins pour recadrer. Le curseur d\'angle redresse.', brush: 'Peins sur la zone à ajouter (ou à effacer).', wand: 'Touche le sujet (ou une partie) pour le sélectionner.', grad: 'Déplace les poignées jaunes pour régler le dégradé.' }[A.tool];
  hint.textContent = msg || ''; hint.classList.toggle('on', !!msg); if (msg) setTimeout(() => hint.classList.remove('on'), 4500);
  if (A.hooks.refresh) A.hooks.refresh();
}
