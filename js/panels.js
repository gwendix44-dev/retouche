// Panneaux de réglages (onglets)
import { A, zoomAt, redraw, commit, syncAll, syncLayers, syncCurves, setTool, applyItem, applyAuto, addLayer, removeLayer, selLayer, maskDirty, visibleLayers, setCropAspect, shrinkCrop, runAnalysis, undo, restore, resetAll, fit, scheduleDetail, newState } from './app.js';
import { META, LEARN, explainChange, HSL_NAMES, HSL_COLORS, curveValues, DEFAULTS, CURVES } from './params.js';
import { customItems, score, toneStats, colorCast, noiseSigma, sharpness } from './analyze.js';
import { h, $, icon, toast, fmt, clamp, dialog } from './ui.js';
import * as DB from './store.js';
import { openExport, openBatch, openStack } from './dialogs.js';

export const TABS = [['auto', 'Auto'], ['light', 'Lumière'], ['color', 'Couleur'], ['curve', 'Courbe'], ['detail', 'Détail'], ['zones', 'Zones'], ['geom', 'Rogner'], ['rescue', 'Sauvetage'], ['styles', 'Styles'], ['learn', 'Apprendre']];
export function renderTabs() {
  const t = $('#tabs'); t.replaceChildren(...TABS.map(([id, l]) => h('button', { class: A.tab === id ? 'on' : '', onclick: () => { if (A.tool && id !== 'zones' && id !== 'geom') setTool(A.tool); A.tab = id; renderTabs(); renderPanel(); } }, l)));
  const on = t.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
}
let learnBox = null;
export function renderPanel() {
  const p = $('#panel'); const top = p.scrollTop; $('#sheet').classList.toggle('learn', A.learn);
  const fn = { auto: pAuto, light: pLight, color: pColor, curve: pCurve, detail: pDetail, zones: pZones, geom: pGeom, rescue: pRescue, styles: pStyles, learn: pLearn }[A.tab] || pAuto;
  learnBox = h('div'); p.replaceChildren(learnBox, fn()); p.scrollTop = top;
}
export function setLearn(info) {
  if (!A.learn || !learnBox || !info) return;
  learnBox.replaceChildren(h('div', { class: 'learncard' }, h('b', null, info.title), info.text, info.tip ? h('div', { style: { marginTop: '4px', opacity: .85 } }, 'Astuce : ' + info.tip) : null));
}

// ---------- curseur ----------
const DEFS = { sharpRadius: 1.0, sharpMask: 25, nrKeep: 50 };
function slider(key, o = {}) {
  const m = o.meta || META[key]; const [label, min, max, step, unit] = m; const get = o.get || (() => A.st.params[key]); const set = o.set || (v => { A.st.params[key] = v; });
  const def = o.def != null ? o.def : (DEFS[key] != null ? DEFS[key] : 0); let last = get();
  const val = h('span', { class: 'v' }), inp = h('input', { type: 'range', min, max, step, value: last, 'aria-label': label });
  const L = LEARN[o.learn || key]; const ex = h('div', { class: 'expl' }, L ? [L.d, h('br'), 'Plus : ' + L.up, h('br'), L.down ? 'Moins : ' + L.down : null, L.tip ? h('br') : null, L.tip ? 'Astuce : ' + L.tip : null] : '');
  const show = () => { const v = +inp.value; val.textContent = (unit === '' && v > 0 && min < 0 ? '+' : '') + fmt(v, step) + unit.replace(' px', '').replace(' IL', ''); val.classList.toggle('z', Math.abs(v - def) < 1e-6); inp.style.setProperty('--p', ((v - min) / (max - min) * 100) + '%'); inp.style.setProperty('--d', ((def - min) / (max - min) * 100) + '%'); };
  const upd = () => { set(+inp.value); show(); (o.onInput || (() => redraw(1)))(); };
  inp.addEventListener('input', upd);
  inp.addEventListener('change', () => { const nv = +inp.value; commit((o.label || label) + ' ' + (nv > 0 && min < 0 ? '+' : '') + fmt(nv, step)); if (A.learn && L) setLearn(explainChange(o.learn || key, last, nv) || { title: label, text: L.d, tip: L.tip }); last = nv; });
  const reset = () => { inp.value = def; upd(); inp.dispatchEvent(new Event('change')); };
  const info = L ? h('button', { class: 'info', onclick: () => ex.classList.toggle('on'), 'aria-label': 'Explication' }, 'i') : null;
  show();
  const row = h('div', { class: 'row' }, h('div', { class: 'lab' }, h('span', { class: 'n', ondblclick: reset }, label, info), val), inp, ex);
  row._set = v => { inp.value = v; show(); }; return row;
}
const layerSlider = (l, key, o = {}) => slider(key, Object.assign({ get: () => l.params[key] || 0, set: v => { l.params[key] = v; }, onInput: () => redraw(1), label: (l.name + ' · ') }, o, { label: l.name + ' · ' + META[key][0] }));
const btn = (t, f, c = '') => h('button', { class: 'btn ' + c, onclick: f }, t);
const seg = (items, cur, f) => h('div', { class: 'seg' }, items.map(([id, l]) => h('button', { class: cur === id ? 'on' : '', onclick: () => f(id) }, l)));
const sect = t => h('h4', null, t);

// ---------- AUTO ----------
function pAuto() {
  const an = A.analysis, root = h('div'); const refresh = () => renderPanel();
  if (!an) return h('div', { class: 'card' }, h('p', null, 'Analyse de la photo en cours…'));
  const before = an.score, now = A.live ? A.live.after : before; const col = now >= 80 ? 'var(--ok)' : now >= 60 ? 'var(--acc)' : 'var(--warn)';
  root.append(h('div', { class: 'score' }, h('div', { class: 'ring', style: { '--s': now, '--c': col } }, h('b', null, String(now))), h('div', null, h('div', { style: { fontWeight: 600 } }, now >= 85 ? 'Photo prête' : now >= 65 ? 'Presque prête' : 'À retoucher'), h('div', { class: 'mut' }, 'Score avant retouche : ' + (A.live ? A.live.before : before) + ' / 100'), h('div', { class: 'mut sm' }, an.m.night ? 'Scène de nuit détectée' : 'Scène de jour détectée'))));
  root.append(h('div', { class: 'btns' }, btn('Corriger en un geste', () => { const n = applyAuto(); if (n) toast(n + ' corrections appliquées. Tout reste réglable.'); }, 'pri'), btn('Réanalyser', () => { A.analysis = null; A.doneItems.clear(); A.skipItems.clear(); renderPanel(); runAnalysis(); })));
  const items = [...(A.custom || []), ...an.items].filter(i => !A.skipItems.has(i.id));
  root.append(sect('Ce qu\'il y a à améliorer, par priorité'));
  if (!items.length) root.append(h('div', { class: 'card' }, h('p', null, 'Rien d\'important. La photo est bien exposée, nette et propre.')));
  items.forEach((it, i) => {
    const done = A.doneItems.has(it.id);
    root.append(h('div', { class: 'card' + (done ? ' done' : '') }, h('h5', null, h('span', { class: 'badge' + (it.custom ? ' g' : '') }, it.custom ? '+' : String(it.prio || i + 1)), it.title),
      h('ul', null, (it.why || []).map(w => h('li', null, w))), h('div', { class: 'eff' }, '→ ' + it.effect),
      h('div', { class: 'btns' }, it.info ? null : (done ? h('span', { class: 'mut' }, '✓ Appliqué') : btn('Appliquer', () => { applyItem(it); refresh(); }, 'sm pri')), it.info ? null : btn('Ajuster', () => { if (!done) applyItem(it); A.tab = it.tab || 'light'; renderTabs(); renderPanel(); }, 'sm'), btn('Ignorer', () => { A.skipItems.add(it.id); if (A.custom) A.custom = A.custom.filter(c => c.id !== it.id); refresh(); }, 'sm'))));
  });
  root.append(sect('Tes demandes'), h('p', { class: 'mut sm' }, 'Écris ce que tu veux : « ciel plus dramatique », « sujet plus lumineux », « ambiance nuit plus froide »…'));
  const ta = h('input', { type: 'text', placeholder: 'Ex. ciel plus dramatique', enterkeyhint: 'send' });
  const go = () => { const r = customItems(ta.value); if (!ta.value.trim()) return; if (!r.length) { toast('Je n\'ai pas compris. Essaie « ciel plus dramatique » ou « sujet plus lumineux ».', 4500); return; } A.custom = [...r, ...(A.custom || [])]; refresh(); };
  ta.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  root.append(h('div', { style: { display: 'flex', gap: '8px' } }, ta, btn('Ajouter', go, 'pri')));
  if (A.learn) root.append(sect('Pourquoi ces constats ?'), diagnosisCard());
  return root;
}
function diagnosisCard() {
  const m = A.analysis.m, T = m.T, pc = v => Math.round(v * 100) + ' %'; const L = [];
  L.push(`Médiane de la luminosité : ${pc(T.p50)}. ${T.p50 < 0.25 ? 'La photo est sombre.' : T.p50 > 0.65 ? 'La photo est claire.' : 'Niveau correct.'}`);
  L.push(`Écart entre clairs et sombres : ${pc(T.p95 - T.p5)}. ${T.p95 - T.p5 < 0.55 ? 'Peu de contraste : image plate.' : 'Contraste correct.'}`);
  L.push(`Pixels brûlés : ${(T.hiClip * 100).toFixed(1)} %. Pixels noirs : ${(T.loClip * 100).toFixed(1)} %.`);
  L.push(`Bruit estimé : ${m.sigma.toFixed(1)} sur 255. ${m.sigma > 4.5 ? 'Il se voit.' : m.sigma > 2.2 ? 'Léger à modéré.' : 'Très propre.'}`);
  L.push(`Netteté mesurée : ${m.sharp.toFixed(0)}. ${m.sharp < 12 ? 'Plutôt douce.' : m.sharp < 24 ? 'Moyenne.' : 'Bonne.'}`);
  return h('div', { class: 'card' }, h('ul', null, L.map(x => h('li', null, x))));
}

// ---------- LUMIÈRE ----------
function pLight() {
  const r = h('div'); r.append(sect('Exposition'), slider('exposure'), slider('contrast'), sect('Tons'), slider('highlights'), slider('shadows'), slider('whites'), slider('blacks'), sect('Lumières fortes'), slider('burn'), sect('Atmosphère'), slider('vignette'));
  r.append(h('div', { class: 'btns' }, btn(A.view.clip ? 'Masquer l\'écrêtage' : 'Voir l\'écrêtage', () => { A.view.clip = !A.view.clip; $('#cClip').classList.toggle('on', A.view.clip); redraw(0); renderPanel(); }, 'sm')));
  r.append(h('p', { class: 'mut sm' }, 'Rouge : zones brûlées. Bleu : zones bouchées.'));
  return r;
}
// ---------- COULEUR ----------
function pColor() {
  const r = h('div'); r.append(sect('Balance des blancs'), slider('temp'), slider('tint'), sect('Intensité'), slider('vibrance'), slider('saturation'), sect('Mixage par couleur'));
  const band = A.band || 0; const P = A.st.params;
  r.append(h('div', { class: 'sw-row' }, HSL_NAMES.map((n, i) => h('button', { class: 'dot' + (i === band ? ' on' : ''), style: { background: HSL_COLORS[i] }, title: n, onclick: () => { A.band = i; renderPanel(); } }))), h('div', { class: 'mut sm' }, HSL_NAMES[band] + (band === 5 ? ' — le ciel' : band === 1 ? ' — feux et balisage' : '')));
  const hs = (k, l) => slider('saturation', { meta: [l, -100, 100, 1, ''], get: () => P.hsl[k][band], set: v => { P.hsl[k][band] = v; }, learn: 'hsl', label: HSL_NAMES[band] + ' · ' + l });
  r.append(hs('h', 'Teinte'), hs('s', 'Saturation'), hs('l', 'Luminance'));
  if (A.analysis && A.analysis.m.cast && Math.abs(A.analysis.m.cast.rb) > 0.15) r.append(h('p', { class: 'mut sm' }, 'Astuce : cherche un gris ou un blanc neutre et ajuste la température jusqu\'à ce qu\'il le soit.'));
  return r;
}
// ---------- COURBE ----------
let curveCh = 'm';
function pCurve() {
  const r = h('div'); const cv = h('canvas', { width: 600, height: 600, style: { width: '100%', maxWidth: '340px', aspectRatio: '1', background: '#0f1215', borderRadius: '12px', touchAction: 'none', display: 'block', margin: '8px auto' } });
  const col = { m: '#e7e9ec', r: '#ff6b6b', g: '#58d68d', b: '#6aa8ff' };
  const draw = () => {
    const g = cv.getContext('2d'), W = 600; g.clearRect(0, 0, W, W); g.strokeStyle = '#242a31'; g.lineWidth = 1; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * W / 4, 0); g.lineTo(i * W / 4, W); g.moveTo(0, i * W / 4); g.lineTo(W, i * W / 4); g.stroke(); }
    const H = A.histData; if (H) { const arr = curveCh === 'm' ? H.l : H[curveCh]; const mx = Math.max(1, ...Array.from(arr.slice(2, 254))); g.fillStyle = 'rgba(160,170,185,.22)'; g.beginPath(); g.moveTo(0, W); for (let i = 0; i < 256; i++) g.lineTo(i / 255 * W, W - Math.min(1, arr[i] / mx) * W * 0.9); g.lineTo(W, W); g.fill(); }
    g.strokeStyle = '#2f353d'; g.beginPath(); g.moveTo(0, W); g.lineTo(W, 0); g.stroke();
    const pts = A.st.curves[curveCh], v = curveValues(pts); g.strokeStyle = col[curveCh]; g.lineWidth = 3; g.beginPath(); for (let i = 0; i < 256; i++) { const x = i / 255 * W, y = W - v[i] * W; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    pts.forEach(p => { g.beginPath(); g.arc(p[0] * W, W - p[1] * W, 12, 0, 7); g.fillStyle = '#0f1215'; g.fill(); g.lineWidth = 3; g.strokeStyle = col[curveCh]; g.stroke(); });
  };
  A.hooks.onHisto = () => { if (A.tab === 'curve' && cv.isConnected) draw(); };
  let drag = -1;
  const pos = e => { const b = cv.getBoundingClientRect(); return [clamp((e.clientX - b.left) / b.width, 0, 1), clamp(1 - (e.clientY - b.top) / b.height, 0, 1)]; };
  const upd = () => { syncCurves(); redraw(1); draw(); };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); const [x, y] = pos(e), pts = A.st.curves[curveCh]; let bi = -1, bd = 0.07; pts.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; bi = i; } });
    if (bi < 0) { pts.push([x, y]); pts.sort((a, b) => a[0] - b[0]); bi = pts.findIndex(p => p[0] === x && p[1] === y); }
    drag = bi; upd(); });
  cv.addEventListener('pointermove', e => { if (drag < 0) return; const pts = A.st.curves[curveCh]; let [x, y] = pos(e); if (drag === 0) x = 0; else if (drag === pts.length - 1) x = 1; else x = clamp(x, pts[drag - 1][0] + 0.015, pts[drag + 1][0] - 0.015); pts[drag] = [x, y]; upd(); });
  cv.addEventListener('pointerup', () => { if (drag >= 0) { drag = -1; commit('Courbe ' + ({ m: 'RVB', r: 'rouge', g: 'verte', b: 'bleue' })[curveCh]); setLearn(LEARN.curve && { title: 'Courbe', text: LEARN.curve.d, tip: LEARN.curve.tip }); } });
  cv.addEventListener('dblclick', e => { const [x, y] = pos(e), pts = A.st.curves[curveCh]; const i = pts.findIndex((p, k) => k > 0 && k < pts.length - 1 && Math.hypot(p[0] - x, p[1] - y) < 0.07); if (i > 0) { pts.splice(i, 1); upd(); commit('Point de courbe retiré'); } });
  r.append(sect('Courbe des tons'), seg([['m', 'RVB'], ['r', 'Rouge'], ['g', 'Vert'], ['b', 'Bleu']], curveCh, id => { curveCh = id; renderPanel(); }), cv);
  const S = [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]];
  r.append(h('div', { class: 'btns' }, btn('Contraste doux', () => { A.st.curves.m = [[0, 0], [0.25, 0.21], [0.75, 0.79], [1, 1]]; upd(); commit('Courbe en S douce'); }, 'sm'), btn('Contraste fort', () => { A.st.curves.m = [[0, 0], [0.25, 0.16], [0.75, 0.84], [1, 1]]; upd(); commit('Courbe en S forte'); }, 'sm'), btn('Ombres relevées', () => { A.st.curves.m = [[0, 0], [0.2, 0.3], [0.6, 0.65], [1, 1]]; upd(); commit('Courbe ombres relevées'); }, 'sm'), btn('Remettre à plat', () => { A.st.curves[curveCh] = [[0, 0], [1, 1]]; upd(); commit('Courbe remise à plat'); }, 'sm')));
  r.append(h('p', { class: 'mut sm' }, 'Touche pour ajouter un point, glisse pour le déplacer, double-tape pour le retirer.'));
  draw(); return r;
}
// ---------- DÉTAIL ----------
function pDetail() {
  const r = h('div'); r.append(sect('Netteté'), slider('sharpness'), slider('sharpRadius'), slider('sharpMask'), sect('Détails locaux'), slider('texture'), slider('clarity'), slider('dehaze'), sect('Réduction du bruit'), slider('nrLum'), slider('nrCol'), slider('nrKeep'));
  r.append(h('div', { class: 'btns' }, btn('Voir à 100 %', () => { const v = A.view; const one = 1 / v.dpr; zoomAt(A.stageW / 2, A.stageH / 2, one); }, 'sm'), btn('Avant / après', () => $('#bCmp').click(), 'sm')));
  r.append(h('p', { class: 'mut sm' }, 'Juge toujours le bruit et la netteté à 100 %. Un détail absent de la photo ne peut pas être inventé.'));
  r.append(sect('Agrandissement (super-résolution)'));
  r.append(seg([[1, 'Original'], [1.5, '×1,5'], [2, '×2'], [3, '×3']], A.upscale || 1, f => { A.upscale = f; renderPanel(); }), h('p', { class: 'mut sm' }, 'Agrandit à l\'export avec un filtre Lanczos et une accentuation sans halo. Aucune image n\'est inventée : la finesse existante est conservée, sans pixellisation.'));
  return r;
}
// ---------- ZONES ----------
function pZones() {
  const r = h('div'); const L = A.st.layers;
  r.append(sect('Ajouter une zone'), h('div', { class: 'btns' }, btn('Ciel', () => addLayer('sky'), 'sm'), btn('Sujet', () => addLayer('subject'), 'sm'), btn('Sol', () => addLayer('ground'), 'sm'), btn('Dégradé', () => { addLayer('linear'); setTool('grad'); }, 'sm'), btn('Radial', () => { addLayer('radial'); setTool('grad'); }, 'sm'), btn('Pinceau', () => { addLayer('brush'); setTool('brush'); }, 'sm')));
  if (!L.length) r.append(h('div', { class: 'card' }, h('p', null, 'Une zone règle une partie de l\'image : éclaircir le sujet sans toucher au ciel, ou baisser un fond trop lumineux. Choisis Ciel ou Sujet : la sélection se fait en un geste.')));
  L.forEach(l => r.append(h('div', { class: 'layer' + (l.id === A.sel ? ' sel' : '') }, h('div', { class: 'sw', style: { background: ['#ff6b6b', '#58d68d', '#6aa8ff', '#ffd24a'][L.indexOf(l)] } }), h('button', { class: 'nm', style: { textAlign: 'left' }, onclick: () => { A.sel = l.id; if (A.tool === 'grad' && !['linear', 'radial'].includes(l.mask.kind)) setTool('grad'); renderPanel(); } }, l.name), h('button', { class: 'ibtn', style: { width: '36px', height: '36px' }, onclick: () => { l.visible = !l.visible; syncLayers(true); redraw(1); commit(l.name + (l.visible ? ' affichée' : ' masquée')); renderPanel(); }, title: 'Afficher / masquer', 'aria-label': 'Afficher ou masquer' }, h('span', { style: { opacity: l.visible ? 1 : .35 } }, icon('eye'))), h('button', { class: 'ibtn', style: { width: '36px', height: '36px' }, onclick: () => removeLayer(l.id), 'aria-label': 'Supprimer' }, icon('trash')))));
  const l = selLayer(); if (!l) return r; const m = l.mask;
  r.append(sect('Sélection · ' + l.name));
  const tools = [[A.tool === 'brush' && !A.brush.erase, 'Ajouter', () => { A.brush.erase = false; if (A.tool !== 'brush') setTool('brush'); else renderPanel(); }], [A.tool === 'brush' && A.brush.erase, 'Effacer', () => { A.brush.erase = true; if (A.tool !== 'brush') setTool('brush'); else renderPanel(); }], [A.tool === 'wand', '✦ Baguette', () => setTool('wand')]];
  if (['linear', 'radial'].includes(m.kind)) tools.push([A.tool === 'grad', 'Poignées', () => setTool('grad')]);
  r.append(h('div', { class: 'seg' }, tools.map(([on, t, f]) => h('button', { class: on ? 'on' : '', onclick: f }, t)), h('button', { class: m.invert ? 'on' : '', onclick: () => { m.invert = !m.invert; maskDirty(); commit('Masque inversé'); renderPanel(); } }, 'Inverser'), h('button', { class: A.showMask ? 'on' : '', onclick: () => { A.showMask = !A.showMask; redraw(0); renderPanel(); } }, 'Voir le masque')));
  if (A.tool === 'brush') r.append(slider('x', { meta: ['Taille du pinceau', 0.5, 12, 0.5, ' %'], get: () => A.brush.size * 100, set: v => { A.brush.size = v / 100; }, onInput: () => redraw(0), def: 3.5, label: 'Taille' }), slider('x', { meta: ['Dureté', 0, 100, 1, ''], get: () => A.brush.hard * 100, set: v => { A.brush.hard = v / 100; }, onInput: () => { }, def: 50, label: 'Dureté' }));
  if (A.tool === 'wand') r.append(slider('x', { meta: ['Tolérance', 2, 30, 1, ''], get: () => (m.tol || 0.09) * 100, set: v => { m.tol = v / 100; }, onInput: () => { if (m.kind === 'wand') maskDirty(); }, def: 9, label: 'Tolérance' }));
  if (m.kind === 'radial') r.append(slider('x', { meta: ['Progressivité', 5, 95, 1, ''], get: () => (m.rad.feather) * 100, set: v => { m.rad.feather = v / 100; }, onInput: maskDirty, def: 55, label: 'Progressivité' }));
  r.append(slider('x', { meta: ['Adoucir le contour', 0, 100, 1, ''], get: () => m.feather || 0, set: v => { m.feather = v; }, onInput: maskDirty, def: 0, label: 'Contour doux' }), slider('x', { meta: ['Agrandir / réduire la zone', -100, 100, 1, ''], get: () => m.edge || 0, set: v => { m.edge = v; }, onInput: maskDirty, def: 0, label: 'Ajuster le contour' }));
  r.append(sect('Réglages de la zone'), ...['exposure', 'contrast', 'highlights', 'shadows', 'dehaze'].map(k => layerSlider(l, k)), ...['temp', 'saturation', 'vibrance'].map(k => layerSlider(l, k)), ...['clarity', 'texture', 'sharpness'].map(k => layerSlider(l, k)));
  r.append(h('div', { class: 'btns' }, btn('Réinitialiser cette zone', () => { l.params = {}; m.strokes = []; maskDirty(); commit('Zone réinitialisée'); renderPanel(); }, 'sm dng')));
  return r;
}
// ---------- GÉOMÉTRIE ----------
function pGeom() {
  const r = h('div'), g = A.st.geom;
  r.append(sect('Recadrage'), h('div', { class: 'btns' }, btn(A.tool === 'crop' ? '✓ Terminer le recadrage' : '⛶ Recadrer', () => setTool('crop'), A.tool === 'crop' ? 'pri' : '')));
  r.append(seg([[0, 'Libre'], [-1, 'Original'], [1, '1:1'], [4 / 5, '4:5'], [3 / 2, '3:2'], [16 / 9, '16:9'], [9 / 16, '9:16']], A.crop.aspect === 0 ? 0 : (Math.abs(A.crop.aspect - A.eng.srcW / A.eng.srcH) < 1e-6 ? -1 : A.crop.aspect), a => { setCropAspect(a === -1 ? A.eng.srcW / A.eng.srcH : a); if (A.tool !== 'crop') setTool('crop'); else renderPanel(); }));
  r.append(sect('Redressement'), slider('angle', { meta: ['Angle', -15, 15, 0.1, '°'], get: () => g.angle, set: v => { g.angle = v; shrinkCrop(); }, def: 0, learn: 'angle', onInput: () => redraw(1) }));
  r.append(h('div', { class: 'btns' }, btn('Redresser automatiquement', () => { const t = A.analysis && A.analysis.m.tilt; if (!t || Math.abs(t.angle) < 0.3) { toast('Aucune ligne d\'horizon nette détectée.'); return; } g.angle = Math.round(-t.angle * 10) / 10; shrinkCrop(); syncAll(); commit('Redressement auto'); }, 'sm')));
  r.append(sect('Perspective'), slider('vp', { meta: ['Verticale', -100, 100, 1, ''], get: () => g.vp, set: v => { g.vp = v; }, def: 0, learn: 'vp' }), slider('hp', { meta: ['Horizontale', -100, 100, 1, ''], get: () => g.hp, set: v => { g.hp = v; }, def: 0, learn: 'hp' }));
  r.append(h('div', { class: 'btns' }, btn('Réinitialiser la géométrie', () => { Object.assign(g, { angle: 0, vp: 0, hp: 0, crop: { x: 0, y: 0, w: 1, h: 1 } }); syncAll(); commit('Géométrie réinitialisée'); }, 'sm dng')));
  return r;
}
// ---------- SAUVETAGE ----------
const RECIPES = (m) => {
  const T = m ? m.T : { p50: .4 }; const ev = m ? Math.max(-2, Math.min(2.5, Math.log2(Math.pow(m.night ? .15 : .44, 2.2) / Math.pow(Math.max(.02, T.p50), 2.2)))) : 0.8;
  const nl = m ? clamp(Math.round(m.sigma * 7.5), 30, 85) : 55, nc = m ? clamp(Math.round(m.sigma * 9), 35, 90) : 60;
  const r1 = x => Math.round(x * 20) / 20;
  return [
    { id: 'under', t: 'Photo sous-exposée', d: 'Éclaircit, relève les ombres, calme le bruit qui monte.', p: { exposure: r1(clamp(ev, 0.5, 2.2)), shadows: 40, blacks: 6, highlights: -20, nrLum: nl, nrCol: nc, nrKeep: 55, sharpMask: 45 } },
    { id: 'over', t: 'Photo surexposée', d: 'Assombrit, récupère les hautes lumières, redonne de la matière.', p: { exposure: r1(clamp(m ? ev : -0.8, -1.8, -0.3)), highlights: -70, whites: -25, burn: 45, dehaze: 8, contrast: 8 } },
    { id: 'noisy', t: 'Photo bruitée', d: 'Supprime le grain, garde la netteté des contours.', p: { nrLum: nl, nrCol: nc, nrKeep: 55, sharpness: 40, sharpMask: 50 } },
    { id: 'rain', t: 'Sujet sous la pluie', d: 'Enlève la grisaille, redonne du contraste et de la clarté.', p: { dehaze: 28, contrast: 14, clarity: 12, highlights: -15, vibrance: 14, temp: -4, nrLum: 25, nrCol: 30 } },
    { id: 'night', t: 'Nuit en pose longue (prêt Instagram)', d: 'Réduit le grain, relève les ombres sans bruit, calme les lumières de piste, couleurs naturelles.', p: { exposure: r1(clamp(m ? ev : 0.3, -0.3, 0.8)), shadows: 38, blacks: 6, highlights: -25, burn: 60, contrast: 10, vibrance: 12, nrLum: Math.max(55, nl), nrCol: Math.max(60, nc), nrKeep: 55, sharpness: 45, sharpMask: 50, clarity: 8 }, subject: true, ig: true },
  ];
};
function pRescue() {
  const r = h('div'), an = A.analysis;
  r.append(h('div', { class: 'btns' }, btn('Corriger en un geste', () => { const n = applyAuto(); if (n) toast(n + ' corrections appliquées'); renderPanel(); }, 'pri')), h('p', { class: 'mut sm' }, 'Chaque recette est un point de départ : tout reste réglable à la main ensuite.'));
  RECIPES(an && an.m).forEach(rc => r.append(h('div', { class: 'card' }, h('h5', null, rc.t), h('p', null, rc.d), h('div', { class: 'btns' }, btn('Appliquer', () => {
    Object.assign(A.st.params, rc.p);
    if (rc.subject && an && an.m.box) { const l = A.st.layers.find(x => x.kind === 'subject'); const pr = { exposure: 0.25, clarity: 15, sharpness: 40, shadows: 15 }; if (l) Object.assign(l.params, pr); else if (A.st.layers.length < 4) { const nl = addLayerQuiet('subject', pr); } }
    syncAll(); commit(rc.t); toast(rc.t + ' appliqué'); if (rc.ig) openExport('ig45');
  }, 'sm pri'), rc.id === 'night' ? btn('Empiler plusieurs photos', () => openStack(), 'sm') : null))));
  r.append(h('div', { class: 'card' }, h('p', null, 'Limite : un détail absent de la photo ne peut pas être inventé, et une photo très floue reste limitée. L\'appli ne régénère jamais l\'image : elle retouche les vrais pixels.')));
  return r;
}
function addLayerQuiet(kind, params) { const l = addLayer(kind, params); A.showMask = false; return l; }
// ---------- STYLES ----------
export const BUILTIN = [
  { name: 'Nuit — pose longue propre', p: { shadows: 35, blacks: 6, highlights: -25, burn: 60, nrLum: 60, nrCol: 65, nrKeep: 55, sharpness: 45, sharpMask: 50, clarity: 10, vibrance: 12, contrast: 10 } },
  { name: 'Contre-jour récupéré', p: { shadows: 50, highlights: -55, exposure: 0.2, contrast: 8, dehaze: 10, clarity: 12 } },
  { name: 'Ciel dramatique', p: { contrast: 25, highlights: -30, clarity: 25, vibrance: 15, dehaze: 20, vignette: 20 } },
  { name: 'Pluie / grisaille', p: { dehaze: 25, contrast: 12, clarity: 10, vibrance: 12, nrLum: 25, temp: -4 } },
  { name: 'Éclat naturel', p: { contrast: 12, vibrance: 18, clarity: 10, sharpness: 35, texture: 12 } },
  { name: 'Ambiance froide', p: { temp: -18, tint: 2, saturation: -4, contrast: 8 } },
  { name: 'Heure dorée', p: { temp: 16, vibrance: 14, highlights: -15, contrast: 8 } },
];
export function presetFromState() {
  const layers = A.st.layers.filter(l => ['sky', 'subject', 'ground', 'linear', 'radial'].includes(l.mask.kind)).map(l => ({ name: l.name, kind: l.kind, params: l.params, mask: { kind: l.mask.kind, invert: l.mask.invert, feather: l.mask.feather, edge: l.mask.edge, grad: l.mask.grad, rad: l.mask.rad, tol: l.mask.tol, seeds: [], strokes: [] } }));
  return { params: JSON.parse(JSON.stringify(A.st.params)), curves: JSON.parse(JSON.stringify(A.st.curves)), layers };
}
export function applyPreset(p, { layers = true } = {}) {
  const st = A.st; Object.assign(st.params, JSON.parse(JSON.stringify(p.params || p.p || {}))); if (p.curves) st.curves = JSON.parse(JSON.stringify(p.curves));
  if (layers && p.layers && p.layers.length) { st.layers = p.layers.slice(0, 4).map(l => Object.assign({ id: DB.uid(), visible: true }, JSON.parse(JSON.stringify(l)), { mask: Object.assign({ seeds: [], strokes: [], tol: .09 }, JSON.parse(JSON.stringify(l.mask))) })); }
}
function pStyles() { const box = h('div'); const r = h('div'); box.append(r);
  r.append(sect('Mes préréglages'), h('div', { class: 'btns' }, btn('Enregistrer les réglages actuels', () => { const inp = h('input', { type: 'text', placeholder: 'Nom du préréglage' }); const d = dialog('Nouveau préréglage', h('div', null, inp, h('div', { class: 'btns' }, btn('Enregistrer', async () => { if (!inp.value.trim()) return; await DB.put('presets', { id: DB.uid(), name: inp.value.trim(), data: presetFromState(), t: Date.now() }); d.close(); toast('Préréglage enregistré'); renderPanel(); }, 'pri')))); inp.focus(); }, 'pri sm'), btn('Retouche par lot…', () => openBatch(), 'sm')));
  const mine = h('div'); r.append(mine);
  r.append(sect('Préréglages de départ'));
  BUILTIN.forEach(b => r.append(h('div', { class: 'layer' }, h('div', { class: 'nm' }, b.name), btn('Appliquer', () => { applyPreset({ p: b.p }, { layers: false }); syncAll(); commit('Style : ' + b.name); }, 'sm'))));
  DB.all('presets').then(list => { mine.replaceChildren(...(list || []).sort((a, b) => b.t - a.t).map(p => h('div', { class: 'layer' }, h('div', { class: 'nm' }, p.name), btn('Appliquer', () => { applyPreset(p.data); syncAll(); commit('Style : ' + p.name); }, 'sm'), h('button', { class: 'ibtn', style: { width: '36px', height: '36px' }, onclick: async () => { await DB.del('presets', p.id); renderPanel(); } }, icon('trash'))))); if (!(list || []).length) mine.append(h('p', { class: 'mut sm' }, 'Aucun pour l\'instant.')); });
  return box;
}
// ---------- APPRENDRE ----------
function pLearn() {
  const r = h('div'); const sw = h('div', { class: 'sw2' + (A.learn ? ' on' : '') });
  r.append(h('div', { class: 'line', onclick: () => { A.learn = !A.learn; localStorage.setItem('learn', A.learn ? '1' : '0'); renderPanel(); }, style: { cursor: 'pointer' } }, h('div', null, h('b', null, 'Mode apprendre'), h('div', { class: 'mut sm' }, 'Explique chaque réglage en phrases courtes (bouton « i » sur chaque curseur).')), sw));
  if (A.analysis) r.append(sect('Pourquoi cette photo a besoin de retouches'), diagnosisCard());
  r.append(sect('Historique de cette photo'));
  const H = A.hist; const list = h('div'); H.stack.forEach((s, i) => list.append(h('div', { class: 'layer' + (i === H.idx ? ' sel' : '') }, h('div', { class: 'nm', onclick: () => restore(i) }, (i + 1) + '. ' + s.label), i === H.idx ? h('span', { class: 'mut sm' }, 'actuel') : null))); r.append(list);
  r.append(h('div', { class: 'btns' }, btn('Tout réinitialiser', () => resetAll(), 'sm dng'), btn('Journal des retouches', () => import('./dialogs.js').then(m => m.openJournal()), 'sm pri')));
  return r;
}

// ---------- score en direct ----------
let liveT = 0;
export function scheduleLive() { clearTimeout(liveT); liveT = setTimeout(computeLive, 900); }
export function computeLive() {
  if (!A.photo || !A.analysis || !A.eng.prev) return;
  try {
    const e = A.eng, rg = e.regionRGBA(A.st, 512), pv = e.prev; const sa = e.readSmall(pv, 384), sb = e.readSmall({ out: pv.before, W: pv.W, H: pv.H }, 384);
    const mk = (small, reg) => { const s = { data: small.data, w: small.w, h: small.h }; const sig = noiseSigma(reg.data, reg.w, reg.h); return { T: toneStats(s, null, null), sigma: sig, sharp: sharpness(reg.data, reg.w, reg.h, sig), night: A.analysis.m.night, cast: colorCast(s, null), tilt: null }; };
    const a = score(mk(sa, rg.after)), b = score(mk(sb, rg.before)); const changed = !A.live || A.live.after !== a; A.live = { before: Math.min(b, A.analysis.score + 8), after: a, sigmaAfter: noiseSigma(rg.after.data, rg.after.w, rg.after.h) };
    if (A.tab === 'auto' && changed) renderPanel();
  } catch (err) { console.warn(err); }
}
export function setupHooks() { A.hooks.refresh = () => { renderTabs(); renderPanel(); }; A.hooks.onCommit = () => scheduleLive(); }
