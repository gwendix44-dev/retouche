// Démarrage de l'appli
import { A, initApp, undo, redo, redraw, toggleZoom, fit, autosave, openPhoto, updateButtons } from './app.js';
import { renderTabs, renderPanel, setupHooks } from './panels.js';
import { renderHome, openExport, openCull, openBatch, openStack } from './dialogs.js';
import { $, icon, dialog, h, toast } from './ui.js';
import { isRaw } from './raw.js';

function boot() {
  try { initApp(); } catch (e) { document.body.prepend(h('div', { style: { padding: '24px', color: '#fff' } }, 'Cette appli a besoin de WebGL2 : ' + e.message)); return; }
  setupHooks();
  $('#bHome').append(icon('home')); $('#bUndo').append(icon('undo')); $('#bRedo').append(icon('redo')); $('#bCmp').append(icon('compare')); $('#bCol').append(icon('collapse'));
  $('#bExp').append(icon('export'), h('span', null, 'Exporter'));
  $('#bUndo').onclick = undo; $('#bRedo').onclick = redo; $('#bExp').onclick = () => openExport();
  $('#bHome').onclick = async () => { autosave(); $('#app').classList.remove('on'); await renderHome(); };
  // Avant / après : appui court = comparaison glissante, appui long = voir l'original
  const b = $('#bCmp'); let t = 0, held = false;
  b.addEventListener('pointerdown', () => { held = false; t = setTimeout(() => { held = true; A.view.showBefore = true; redraw(1); }, 350); });
  const up = () => { clearTimeout(t); if (held) { A.view.showBefore = false; redraw(1); } };
  b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
  b.addEventListener('click', () => { if (held) return; A.view.split = A.view.split == null ? 0.5 : null; b.classList.toggle('on', A.view.split != null); redraw(1); });
  $('#cZoom').onclick = () => { if (A.zoomFit) toggleZoom(); else { A.zoomFit = true; fit(); redraw(0); } };
  $('#cClip').onclick = e => { A.view.clip = !A.view.clip; e.currentTarget.classList.toggle('on', A.view.clip); redraw(0); };
  $('#bCol').onclick = () => { const s = $('#sheet'); s.classList.toggle('collapsed'); setTimeout(() => window.dispatchEvent(new Event('resize')), 260); };
  renderTabs(); renderPanel(); updateButtons(); renderHome();
  window.addEventListener('pagehide', autosave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });
  // glisser-déposer (ordinateur)
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => { e.preventDefault(); const f = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/') || isRaw(f)); if (f.length === 1) openPhoto(f[0]); else if (f.length) openCull(f); });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
}
boot();
