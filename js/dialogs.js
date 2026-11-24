// Accueil, export, lot, tri, empilement, journal
import { A, openPhoto, openDecoded, decodeFile, busy, newState, newLayer, redraw, syncAll, commit, toDataURL } from './app.js';
import { Engine, geomInfo } from './engine.js';
import { MaskManager, smallFrom } from './masks.js';
import { analyzeBitmap, cropRGBA, noiseSigma, sharpness, toneStats, score } from './analyze.js';
import { META, buildLUT, curvesIdentity } from './params.js';
import * as X from './export.js';
import * as DB from './store.js';
import { isRaw, embeddedJpeg } from './raw.js';
import { presetFromState, applyPreset, BUILTIN, renderPanel } from './panels.js';
import { h, $, icon, toast, dialog, clamp, fileSize, sleep } from './ui.js';

const baseName = n => (n || 'photo').replace(/\.[^.]+$/, '');
const pick = (multiple = true) => new Promise(res => { const i = $('#file'); i.multiple = multiple; i.value = ''; i.onchange = () => res([...i.files]); i.click(); });
const btn = (t, f, c = '') => h('button', { class: 'btn ' + c, onclick: f }, t);
const seg = (items, cur, f) => h('div', { class: 'seg' }, items.map(([id, l]) => h('button', { class: cur === id ? 'on' : '', onclick: e => { f(id); [...e.target.parentNode.children].forEach(b => b.classList.remove('on')); e.target.classList.add('on'); } }, l)));
const field = (l, c) => h('div', { class: 'field' }, h('label', null, l), c);
const progress = () => { const i = h('i'); return { el: h('div', { class: 'bar' }, i), set: v => { i.style.width = Math.round(v * 100) + '%'; } }; };

// =================== rendu final (export) ===================
export async function renderToBlob(eng, st, o, onProg = () => { }) {
  const sw = eng.srcW, sh = eng.srcH, fmt = X.FORMATS.find(f => f.id === o.fmt) || X.FORMATS[0];
  st = JSON.parse(JSON.stringify(st)); const g = st.geom;
  if (fmt.ratio) {
    const c = g.crop, T = fmt.ratio; const cw = c.w * sw, ch = c.h * sh; let nw = cw, nh = ch; if (cw / ch > T) nw = ch * T; else nh = cw / T;
    let cx = c.x * sw + cw / 2, cy = c.y * sh + ch / 2;
    if (o.box) { cx = clamp((o.box.x0 + o.box.x1) / 2 * sw, c.x * sw + nw / 2, c.x * sw + cw - nw / 2); cy = clamp((o.box.y0 + o.box.y1) / 2 * sh, c.y * sh + nh / 2, c.y * sh + ch - nh / 2); }
    g.crop = { x: (cx - nw / 2) / sw, y: (cy - nh / 2) / sh, w: nw / sw, h: nh / sh };
  }
  const gi = geomInfo(g, sw, sh, false); let tw = fmt.w ? fmt.w : Math.round(gi.cw * (o.upscale || 1)); let th = Math.round(gi.ch * tw / gi.cw);
  if (tw * th > 64e6) { const k = Math.sqrt(64e6 / (tw * th)); tw = Math.floor(tw * k); th = Math.floor(th * k); toast('Taille limitée à 64 mégapixels pour cet appareil.', 4500); }
  const s = tw / gi.cw; let res;
  if (s <= 1.0005) res = await eng.exportImage(st, { width: s < 0.9995 ? tw : null, outSharp: s < 0.9995 ? (o.sharp != null ? o.sharp : fmt.sharp) : 0, quality: o.quality || 'high', onProgress: p => onProg(p * 0.8) });
  else { const nat = await eng.exportImage(st, { width: null, quality: o.quality || 'high', onProgress: p => onProg(p * 0.6) }); res = await eng.upscale(nat.data, nat.w, nat.h, s, 0.5, p => onProg(0.6 + p * 0.2)); }
  if (o.wmText) X.watermark(res.data, res.w, res.h, { text: o.wmText, pos: o.wmPos || 'br', opacity: o.wmOp != null ? o.wmOp : 0.6 });
  onProg(0.85);
  const ff = o.file || 'jpeg'; const blob = await X.encode(res.data, res.w, res.h, ff, ff === 'jpeg' ? (o.jq || 1) : 1);
  onProg(1); return { blob, w: res.w, h: res.h, ext: X.EXT[ff] };
}

// =================== export ===================
export function openExport(presetId) {
  if (!A.photo) return; const sw = A.eng.srcW, sh = A.eng.srcH; const O = { fmt: presetId || 'orig', file: 'jpeg', jq: 1, sharp: null, wm: '', wmPos: 'br', wmOp: 0.6, onSubject: false };
  const info = h('div', { class: 'mut sm' }); const pr = progress(); const nameIn = h('input', { type: 'text', value: baseName(A.photo.name) + '-retouche' });
  const upd = () => {
    const fmt = X.FORMATS.find(f => f.id === O.fmt), gi = geomInfo(A.st.geom, sw, sh, false); let w, hh;
    if (fmt.w) { w = fmt.w; hh = fmt.h; } else { w = Math.round(gi.cw * (A.upscale || 1)); hh = Math.round(gi.ch * (A.upscale || 1)); }
    info.textContent = `${w} × ${hh} px · ${(w * hh / 1e6).toFixed(1)} Mpx` + (!fmt.w && (A.upscale || 1) > 1 ? ` (agrandi ×${A.upscale})` : '') + (fmt.w && fmt.w > gi.cw ? ' · agrandi (Lanczos)' : '') + (!fmt.w ? ' · résolution d\'origine conservée' : '');
  };
  const body = h('div', null,
    field('Format de sortie', h('select', { onchange: e => { O.fmt = e.target.value; upd(); } }, X.FORMATS.map(f => h('option', { value: f.id, selected: f.id === O.fmt }, f.label)))),
    info,
    field('Type de fichier', seg([['jpeg', 'JPEG qualité max'], ['png', 'PNG sans perte'], ['tiff', 'TIFF sans perte'], ['webp', 'WebP']], 'jpeg', v => { O.file = v; })),
    field('Netteté de sortie (réduction de taille)', seg([[null, 'Auto'], [0, 'Aucune'], [0.2, 'Légère'], [0.35, 'Moyenne'], [0.5, 'Forte']], null, v => { O.sharp = v; })),
    field('Cadrage sur le sujet (formats réseaux)', seg([[false, 'Centré'], [true, 'Sur le sujet']], false, v => { O.onSubject = v; })),
    field('Filigrane (optionnel)', h('div', null, h('input', { type: 'text', placeholder: 'Ex. © Ouinon', oninput: e => { O.wm = e.target.value; } }), seg([['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']], 'br', v => { O.wmPos = v; }))),
    field('Nom du fichier', nameIn), pr.el,
    h('div', { class: 'btns' }, btn('Enregistrer', () => run(false), 'pri'), btn('Partager', () => run(true))),
    h('p', { class: 'mut sm' }, 'L\'original est retouché en pleine résolution, sans IA générative ni recompression intermédiaire. PNG et TIFF sont sans perte ; JPEG est écrit à la qualité maximale.'));
  const d = dialog('Exporter', body); upd();
  async function run(share) {
    try {
      pr.set(0.02); const box = O.onSubject && A.analysis ? A.analysis.m.box : null;
      const r = await renderToBlob(A.eng, A.st, { fmt: O.fmt, file: O.file, jq: O.jq, sharp: O.sharp, upscale: A.upscale || 1, wmText: O.wm, wmPos: O.wmPos, box }, pr.set);
      const fname = (nameIn.value || 'photo') + (O.fmt !== 'orig' ? '-' + O.fmt : '') + '.' + r.ext;
      if (share) { const ok = await X.share(r.blob, fname).catch(() => false); if (!ok) { X.download(r.blob, fname); } } else X.download(r.blob, fname);
      toast(`Exporté : ${r.w}×${r.h} · ${fileSize(r.blob.size)}`, 4000);
      journalEntry(); d.close();
    } catch (e) { console.error(e); toast('Export impossible : ' + (e.message || e), 7000); pr.set(0); }
  }
}
async function journalEntry() {
  try {
    const live = A.live; await DB.put('journal', { id: DB.uid(), photoId: A.photo.id, name: A.photo.name, date: Date.now(), before: A.photo.thumb, after: A.photo.thumbAfter || A.photo.thumb, steps: A.hist.stack.slice(1, A.hist.idx + 1).map(s => s.label), scoreBefore: live ? live.before : (A.analysis ? A.analysis.score : null), scoreAfter: live ? live.after : null });
  } catch (e) { console.warn(e); }
}

// =================== accueil ===================
let deferred = null; window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; renderHome(); });
export async function renderHome() {
  const b = $('#homeBody'); if (!b) return; $('#home').classList.remove('hide'); const g = h('div', { class: 'grid' });
  const chooser = files => { files = files.filter(f => f.type.startsWith('image/') || isRaw(f)); if (!files.length) return; if (files.length === 1) return openPhoto(files[0]); const d = dialog(files.length + ' photos', h('div', null, h('p', { class: 'mut' }, 'Que veux-tu faire avec cette série ?'),
    h('div', { class: 'btns', style: { flexDirection: 'column' } }, btn('Trier : garder les meilleures', () => { d.close(); openCull(files); }, 'pri'), btn('Retouche par lot', () => { d.close(); openBatch(files); }), btn('Empiler pour réduire le bruit', () => { d.close(); openStack(files); }), btn('Ouvrir la première', () => { d.close(); openPhoto(files[0]); })))); };
  b.replaceChildren(
    h('h1', null, 'Retouche'), h('p', { class: 'sub' }, 'Retouche non destructive, pleine résolution. Les originaux ne sont jamais modifiés.'),
    h('button', { class: 'big pri', onclick: async () => chooser(await pick(true)) }, icon('plus', 22), h('div', null, h('b', null, 'Ouvrir des photos'), h('span', { class: 'd' }, 'JPEG, PNG, RAW (Canon CR2, DNG…). Plusieurs photos : tri, lot, empilement.'))),
    h('button', { class: 'big', onclick: () => openJournal() }, icon('book', 22), h('div', null, h('b', null, 'Journal des retouches'), h('span', { class: 'd' }, 'Avant / après et progrès dans le temps.'))),
    deferred ? h('button', { class: 'big', onclick: async () => { deferred.prompt(); await deferred.userChoice; deferred = null; renderHome(); } }, icon('home', 22), h('div', null, h('b', null, 'Installer sur l\'écran d\'accueil'), h('span', { class: 'd' }, 'Fonctionne ensuite hors ligne.'))) : (/iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone ? h('p', { class: 'mut sm' }, 'Pour installer : bouton Partager de Safari, puis « Sur l\'écran d\'accueil ».') : null),
    h('div', { class: 'line' }, h('div', null, h('b', null, 'RAW en demi-résolution'), h('div', { class: 'mut sm' }, 'Moins de mémoire (à activer si un RAW plante). Désactivé = résolution complète.')), h('div', { class: 'sw2' + (A.rawHalf ? ' on' : ''), style: { cursor: 'pointer' }, onclick: e => { A.rawHalf = !A.rawHalf; localStorage.setItem('rawHalf', A.rawHalf ? '1' : '0'); e.currentTarget.classList.toggle('on', A.rawHalf); } })),
    h('h4', null, 'Reprendre'), g);
  try {
    const list = (await DB.all('photos')).sort((a, b) => b.updated - a.updated);
    if (!list.length) g.replaceWith(h('p', { class: 'mut sm' }, 'Tes retouches en cours apparaîtront ici.'));
    list.forEach(r => g.append(h('div', { class: 'thumb', onclick: () => openPhoto(r.blob, r) }, h('img', { src: r.thumbAfter || r.thumb, alt: r.name }), h('span', { class: 'tag' }, r.name.slice(0, 18)), h('button', { class: 'star', style: { left: 'auto', right: '4px', top: '4px' }, onclick: async e => { e.stopPropagation(); if (confirm('Supprimer cette retouche de l\'appareil ?')) { await DB.del('photos', r.id); renderHome(); } }, 'aria-label': 'Supprimer' }, icon('trash', 18)))));
  } catch (e) { console.warn(e); }
}

// =================== tri rapide ===================
export async function openCull(files) {
  const grid = h('div', { class: 'grid' }), pr = progress(), status = h('div', { class: 'mut sm' }, 'Analyse des photos…'); const items = [];
  const d = dialog('Tri rapide', h('div', null, status, pr.el, h('div', { class: 'btns', id: 'cullBtns' }), grid), { wide: true });
  const quick = async f => {
    let bmp;
    if (isRaw(f)) { const u8 = new Uint8Array(await f.arrayBuffer()); const j = embeddedJpeg(u8); bmp = j ? await createImageBitmap(new Blob([j], { type: 'image/jpeg' }), { imageOrientation: 'from-image' }) : null; }
    else bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    if (!bmp) return null; const sm = smallFrom(bmp, 320); const th = toDataURL(sm.data, sm.w, sm.h, 0.7); const s384 = smallFrom(bmp, 384);
    const crop = cropRGBA(bmp, 0.5, 0.5, 640); const sig = noiseSigma(crop.data, crop.w, crop.h), sh = sharpness(crop.data, crop.w, crop.h, sig); const T = toneStats(s384, null, null);
    const sc = score({ T, sigma: sig, sharp: sh, night: T.p50 < 0.1, cast: null, tilt: null }); const total = Math.round(sc * 0.45 + clamp(sh / 40, 0, 1) * 100 * 0.55);
    bmp.close(); return { file: f, th, sh, total, sig, keep: false };
  };
  for (let i = 0; i < files.length; i++) { try { const r = await quick(files[i]); if (r) items.push(r); } catch (e) { console.warn(e); } pr.set((i + 1) / files.length); status.textContent = `Analyse ${i + 1} / ${files.length}`; await sleep(0); }
  items.sort((a, b) => b.total - a.total);
  const draw = () => { grid.replaceChildren(...items.map((it, i) => h('div', { class: 'thumb' + (it.keep ? ' sel' : ''), onclick: () => { it.keep = !it.keep; draw(); } }, h('img', { src: it.th }), h('span', { class: 'sc' }, String(it.total)), h('span', { class: 'tag' }, (it.sh < 14 ? 'Douce' : it.sh < 28 ? 'Correcte' : 'Nette') + (i === 0 ? ' · meilleure' : '')), h('span', { class: 'star' + (it.keep ? ' on' : '') }, icon('star', 20))))); const n = items.filter(x => x.keep).length; status.textContent = `${items.length} photos, classées de la meilleure à la moins bonne. ${n} gardée${n > 1 ? 's' : ''}.`; };
  const nIn = h('input', { type: 'text', value: '3', style: { width: '56px', textAlign: 'center' }, inputmode: 'numeric' });
  const sel = () => { const k = items.filter(x => x.keep); return (k.length ? k : items).map(x => x.file); };
  $('#cullBtns').replaceChildren(h('span', { class: 'mut sm' }, 'Garder les'), nIn, btn('meilleures', () => { const n = +nIn.value || 1; items.forEach((it, i) => it.keep = i < n); draw(); }, 'sm'), btn('Ouvrir', () => { d.close(); openPhoto(sel()[0]); }, 'sm pri'), btn('Lot', () => { d.close(); openBatch(sel()); }, 'sm'), btn('Empiler', () => { d.close(); openStack(sel()); }, 'sm'));
  draw();
}

// =================== retouche par lot ===================
export async function openBatch(files) {
  if (!files) { files = await pick(true); if (!files.length) return; }
  const O = { mode: A.photo ? 'copy' : 'auto', preset: 0, fmt: 'orig', file: 'jpeg' }; const pr = progress(), log = h('div', { class: 'mut sm' });
  const mine = await DB.all('presets').catch(() => []);
  const presets = [...BUILTIN.map(b => ({ name: b.name, data: { p: b.p } })), ...mine.map(m => ({ name: m.name, data: m.data }))];
  const body = h('div', null, h('p', { class: 'mut' }, files.length + ' photo' + (files.length > 1 ? 's' : '') + ' à traiter.'),
    field('Réglages appliqués', h('div', null, seg([...(A.photo ? [['copy', 'Réglages de la photo ouverte']] : []), ['auto', 'Correction auto de chaque photo'], ['preset', 'Un préréglage']], O.mode, v => { O.mode = v; sel.style.display = v === 'preset' ? '' : 'none'; }))),
    (() => { var sel = h('select', { style: { display: O.mode === 'preset' ? '' : 'none' }, onchange: e => O.preset = +e.target.value }, presets.map((p, i) => h('option', { value: i }, p.name))); window.__sel = sel; return sel; })(),
    field('Taille', h('select', { onchange: e => O.fmt = e.target.value }, X.FORMATS.map(f => h('option', { value: f.id }, f.label)))),
    field('Fichier', seg([['jpeg', 'JPEG max'], ['png', 'PNG'], ['tiff', 'TIFF']], 'jpeg', v => O.file = v)), pr.el, log,
    h('div', { class: 'btns' }, btn('Lancer', go, 'pri')), h('p', { class: 'mut sm' }, 'Les photos sont traitées une par une, puis réunies dans un fichier ZIP (ou téléchargées seules s\'il n\'y en a qu\'une). RAW traité en 8 bits dans le lot.'));
  const sel = window.__sel; const d = dialog('Retouche par lot', body);
  async function go() {
    const cv = document.createElement('canvas'); let eng; try { eng = new Engine(cv); } catch (e) { toast('GPU indisponible pour le lot'); return; }
    const out = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; log.textContent = `(${i + 1}/${files.length}) ${f.name}`;
      try {
        const dec = await decodeFile(f, () => { }); eng.loadSource(dec.bitmap); const mm = new MaskManager(); mm.setSource(dec.bitmap);
        const st = newState();
        if (O.mode === 'copy') applyTo(st, presetFromState());
        else if (O.mode === 'preset') applyTo(st, presets[O.preset].data);
        else { const an = await analyzeBitmap(dec.bitmap, mm); for (const it of an.items.filter(x => !x.info && x.sev >= 0.3 && x.id !== 'crop' && x.id !== 'tilt')) { if (it.set) Object.assign(st.params, it.set); if (it.layer) { const l = newLayer(it.layer.kind, it.layer.params, it.layer.name); if (st.layers.length < 4) st.layers.push(l); } } }
        eng.curveOn = !curvesIdentity(st.curves); eng.setLUT(eng.curveOn ? buildLUT(st.curves) : null);
        const vis = st.layers.filter(l => l.visible).slice(0, 4); eng.setLayers(vis); eng.setMask(mm.pack(vis), mm.mw, mm.mh);
        const box = mm.subjectBox();
        const r = await renderToBlob(eng, st, { fmt: O.fmt, file: O.file, box }, p => pr.set((i + p) / files.length));
        out.push({ name: baseName(f.name) + '-retouche.' + r.ext, blob: r.blob }); dec.bitmap.close && dec.bitmap.close(); eng.invalidate(); eng.purge();
      } catch (e) { console.error(e); log.textContent = 'Erreur sur ' + f.name + ' : ' + e.message; await sleep(1200); }
    }
    pr.set(1);
    if (out.length === 1) X.download(out[0].blob, out[0].name); else if (out.length) X.download(await X.makeZip(out), 'retouche-lot.zip');
    toast(out.length + ' photo(s) exportée(s)', 4000); d.close();
  }
}
function applyTo(st, p) { applyPreset0(st, p); }
function applyPreset0(st, p) {
  const P = p.params || p.p || {}; Object.assign(st.params, JSON.parse(JSON.stringify(P))); if (p.curves) st.curves = JSON.parse(JSON.stringify(p.curves));
  if (p.layers) st.layers = p.layers.slice(0, 4).map(l => { const n = newLayer(l.kind || l.mask.kind, l.params, l.name); Object.assign(n.mask, JSON.parse(JSON.stringify(l.mask)), { seeds: [], strokes: [] }); return n; });
}

// =================== empilement ===================
export async function openStack(files) {
  if (!files) { files = await pick(true); if (!files || files.length < 2) { if (files && files.length) toast('Choisis au moins 2 photos de la même scène.'); return; } }
  const O = { reject: true }; const pr = progress(), log = h('div', { class: 'mut sm' });
  const d = dialog('Empiler pour réduire le bruit', h('div', null, h('p', { class: 'mut' }, files.length + ' photos : elles sont alignées puis moyennées. Le bruit baisse d\'environ ×' + Math.sqrt(files.length).toFixed(1) + ', sans perdre en netteté.'),
    field('Objets en mouvement', seg([[true, 'Ignorer (sujet qui bouge)'], [false, 'Moyenne simple']], true, v => O.reject = v)), pr.el, log,
    h('div', { class: 'btns' }, btn('Empiler', go, 'pri')), h('p', { class: 'mut sm' }, 'Pour de meilleurs résultats : même cadrage (trépied) et même exposition. Un sujet qui se déplace entre les images est conservé tel que sur la première photo.')));
  async function go() {
    try {
      busy(true, 'Empilement…', 0.05); const eng = A.eng; let ref = null;
      const load = async i => createImageBitmap(files[i], { imageOrientation: 'from-image' });
      const luma = (bmp, size) => { const c = cropRGBA(bmp, 0.5, 0.5, size); const L = new Float32Array(c.w * c.h); for (let i = 0; i < c.w * c.h; i++) L[i] = 0.299 * c.data[i * 4] + 0.587 * c.data[i * 4 + 1] + 0.114 * c.data[i * 4 + 2]; return { L, w: c.w, h: c.h }; };
      const align = async (bmp, i) => {
        const cur = luma(bmp, 1024), w = Math.min(ref.w, cur.w), h = Math.min(ref.h, cur.h);
        const sad = (dx, dy, step, m) => { let s = 0, n = 0; for (let y = m; y < h - m; y += step) for (let x = m; x < w - m; x += step) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; s += Math.abs(ref.L[y * ref.w + x] - cur.L[yy * cur.w + xx]); n++; } return n ? s / n + 0.002 * Math.hypot(dx, dy) : 1e9; };
        let best = [0, 0], bs = 1e9; for (let dy = -24; dy <= 24; dy += 4) for (let dx = -24; dx <= 24; dx += 4) { const s = sad(dx, dy, 4, 40); if (s < bs) { bs = s; best = [dx, dy]; } }
        const c0 = best; bs = 1e9; for (let dy = c0[1] - 4; dy <= c0[1] + 4; dy++) for (let dx = c0[0] - 4; dx <= c0[0] + 4; dx++) { const s = sad(dx, dy, 2, 40); if (s < bs) { bs = s; best = [dx, dy]; } }
        const off = [best[0], best[1]]; log.textContent = `Image ${i + 1} : décalage ${off[0]}, ${off[1]} px`; return off;
      };
      const r = await eng.stack(files.length, async i => { const b = await load(i); if (i === 0) ref = luma(b, 1024); return b; }, align, { reject: O.reject, onProgress: p => { pr.set(p); busy(true, 'Empilement…', p); } });
      busy(true, 'Finalisation…', 0.95);
      const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(r.data.buffer), r.w, r.h)); const blob = await X.encodePNG(r.data, r.w, r.h);
      const file = new File([blob], 'Empilement-' + r.used + '-photos.png', { type: 'image/png' });
      d.close(); await openDecoded({ bitmap, half16: null, source: 'stack' }, file); toast(`Empilement de ${r.used} photos terminé. Réduis maintenant le bruit restant.`, 5000);
    } catch (e) { console.error(e); busy(false); toast('Empilement impossible : ' + e.message, 6000); }
  }
}

// =================== journal ===================
export async function openJournal() {
  const list = (await DB.all('journal').catch(() => [])).sort((a, b) => b.date - a.date); const body = h('div');
  if (!list.length) body.append(h('p', { class: 'mut' }, 'Rien pour l\'instant. Chaque export ajoute une entrée : photo avant / après, étapes et score.'));
  else {
    const last = list.slice(0, 12).reverse().filter(e => e.scoreAfter != null);
    if (last.length) { body.append(h('h4', null, 'Progrès (score après retouche)'), h('div', { class: 'sp' }, last.map(e => h('i', { style: { height: Math.max(6, e.scoreAfter * 0.7) + 'px' } }, h('span', null, String(e.scoreAfter)))))); const first = last[0].scoreAfter, lst = last[last.length - 1].scoreAfter; body.append(h('p', { class: 'mut sm' }, last.length > 1 ? `Du score ${first} au score ${lst} sur les ${last.length} dernières photos exportées.` : '')); }
    body.append(h('h4', null, 'Retouches'));
    list.forEach(e => body.append(h('div', { class: 'layer', style: { alignItems: 'flex-start' } }, h('img', { src: e.after, style: { width: '84px', height: '56px', objectFit: 'cover', borderRadius: '8px' }, onclick: () => openCompare(e) }),
      h('div', { class: 'nm', onclick: () => openCompare(e) }, h('div', null, e.name), h('div', { class: 'mut sm' }, new Date(e.date).toLocaleDateString('fr-FR') + ' · ' + (e.scoreBefore != null && e.scoreAfter != null ? `score ${e.scoreBefore} → ${e.scoreAfter}` : (e.steps || []).length + ' étapes')), h('div', { class: 'mut sm' }, (e.steps || []).slice(0, 4).join(' · ') + ((e.steps || []).length > 4 ? '…' : ''))), h('button', { class: 'ibtn', style: { width: '36px', height: '36px' }, onclick: async () => { await DB.del('journal', e.id); openJournalReload(); } }, icon('trash')))));
  }
  const dd = dialog('Journal des retouches', body); function openJournalReload() { dd.close(); openJournal(); }
}
function openCompare(e) {
  const box = h('div', { class: 'ba' }, h('img', { src: e.before, alt: 'Avant' }), h('div', { class: 'cut' }, h('img', { src: e.after, alt: 'Après' })), h('div', { class: 'ln' })); const cut = box.querySelector('.cut'), ln = box.querySelector('.ln');
  const set = x => { const p = clamp(x, 0, 1) * 100; cut.style.clipPath = `inset(0 0 0 ${p}%)`; ln.style.left = p + '%'; }; set(0.5);
  const mv = ev => { const r = box.getBoundingClientRect(); set((ev.clientX - r.left) / r.width); }; box.addEventListener('pointerdown', ev => { box.setPointerCapture(ev.pointerId); mv(ev); box.onpointermove = mv; }); box.addEventListener('pointerup', () => box.onpointermove = null);
  dialog(e.name, h('div', null, box, h('div', { class: 'line' }, h('span', { class: 'mut sm' }, 'Avant'), h('span', { class: 'mut sm' }, 'Après')), h('div', { class: 'mut sm' }, (e.steps || []).map((s, i) => (i + 1) + '. ' + s).join('  ·  '))));
}
