// Petits utilitaires d'interface (sans framework)
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k === 'style' && typeof v === 'object') { for (const [a, b] of Object.entries(v)) a.startsWith('--') ? e.style.setProperty(a, b) : (e.style[a] = b); }
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'dataset') Object.assign(e.dataset, v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(9)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(c)); }
  return e;
}
const P = { undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3', compare: 'M12 3v18M4 7h5v10H4zM15 7h5v10h-5z', export: 'M12 3v12m0-12L7 8m5-5 5 5M5 14v5h14v-5', menu: 'M4 7h16M4 12h16M4 17h16', close: 'M6 6l12 12M18 6 6 18', check: 'm5 12 5 5 9-10', plus: 'M12 5v14M5 12h14', brush: 'M14 4l6 6-9 9-4 1 1-4zM4 20l3-3', wand: 'M4 20 16 8m2-5v4m-2-2h4M5 6v2m-1-1h2M18 14v2m-1-1h2', invert: 'M12 3a9 9 0 1 0 0 18zM12 3v18', trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13', info: 'M12 10v7m0-11v.5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', zoom: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM21 21l-6-6M10 7v6M7 10h6', collapse: 'm6 9 6 6 6-6', share: 'M12 3v12M8 7l4-4 4 4M5 12v8h14v-8', home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4z', star: 'm12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z', book: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10', layers: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5' };
export const icon = (n, s = 22) => h('span', { class: 'ic', html: `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${P[n] || ''}"/></svg>` });

let toastT;
export function toast(msg, ms = 2600) {
  let t = $('#toast'); if (!t) { t = h('div', { id: 'toast' }); document.body.append(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
export function dialog(title, body, { wide = false, onClose } = {}) {
  const back = h('div', { class: 'dlg-back' });
  const close = () => { back.remove(); onClose && onClose(); };
  const d = h('div', { class: 'dlg' + (wide ? ' wide' : '') }, h('div', { class: 'dlg-head' }, h('b', null, title), h('button', { class: 'ibtn', onclick: close, 'aria-label': 'Fermer' }, icon('close'))), h('div', { class: 'dlg-body' }, body));
  back.append(d); back.addEventListener('pointerdown', e => { if (e.target === back) close(); }); document.body.append(back);
  return { close, el: d, back };
}
export const fmt = (v, step) => step < 0.1 ? v.toFixed(2) : step < 1 ? v.toFixed(1) : String(Math.round(v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const fileSize = n => n > 1e6 ? (n / 1e6).toFixed(1) + ' Mo' : Math.round(n / 1e3) + ' Ko';
