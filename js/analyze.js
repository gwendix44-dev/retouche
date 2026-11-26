// Analyse automatique « comme un photographe » : diagnostic, priorités, corrections proposées
import { smallFrom, MaskManager } from './masks.js';

const mkCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
const lin = v => Math.pow(Math.max(v, 1e-4), 2.2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pct = (arr, p) => { const a = Float32Array.from(arr).sort(); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0; };

export function cropRGBA(bitmap, cx, cy, size) {
  const w = Math.min(size, bitmap.width), h = Math.min(size, bitmap.height);
  const x = clamp(Math.round(cx * bitmap.width - w / 2), 0, bitmap.width - w), y = clamp(Math.round(cy * bitmap.height - h / 2), 0, bitmap.height - h);
  const c = mkCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  return { data: g.getImageData(0, 0, w, h).data, w, h };
}
const lumaOf = (d, w, h) => { const L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return L; };

// bruit (écart-type en niveaux 0..255) : Immerkaer par blocs, on garde les zones les plus calmes
export function noiseSigma(rgba, w, h) {
  const L = lumaOf(rgba, w, h), B = 24, est = [];
  for (let by = 0; by + B <= h; by += B) for (let bx = 0; bx + B <= w; bx += B) {
    let s = 0, n = 0, mean = 0;
    for (let y = by + 1; y < by + B - 1; y++) for (let x = bx + 1; x < bx + B - 1; x++) {
      const i = y * w + x;
      const v = L[i - w - 1] - 2 * L[i - w] + L[i - w + 1] - 2 * L[i - 1] + 4 * L[i] - 2 * L[i + 1] + L[i + w - 1] - 2 * L[i + w] + L[i + w + 1];
      s += Math.abs(v); n++; mean += L[i];
    }
    est.push(Math.sqrt(Math.PI / 2) * s / (6 * n));
  }
  return est.length ? pct(est, 0.2) : 0;
}
// netteté : 98e centile du gradient (luminance légèrement lissée), moins la part due au bruit
export function sharpness(rgba, w, h, sigma = 0) {
  const L = lumaOf(rgba, w, h), S = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; S[i] = (L[i] * 4 + L[i - 1] + L[i + 1] + L[i - w] + L[i + w]) / 8; }
  const g = [];
  for (let y = 2; y < h - 2; y += 1) for (let x = 2; x < w - 2; x += 1) { const i = y * w + x; g.push(Math.hypot(S[i + 1] - S[i - 1], S[i + w] - S[i - w]) / 2); }
  return Math.max(0, pct(g, 0.985) - 1.2 * sigma * 0.5);
}

export function toneStats(small, sky, subj) {
  const { data, w, h } = small, N = w * h; const L = new Float32Array(N); const hist = new Uint32Array(256);
  let satSum = 0, hi = 0, lo = 0;
  for (let i = 0; i < N; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]; const y = (0.299 * r + 0.587 * g + 0.114 * b); L[i] = y / 255; hist[Math.round(y)]++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); satSum += mx ? (mx - mn) / mx : 0; if (mx >= 250) hi++; if (mx <= 6) lo++;
  }
  const P = p => { let a = 0; const t = p * N; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= t) return i / 255; } return 1; };
  const out = { p1: P(.01), p5: P(.05), p25: P(.25), p50: P(.5), p75: P(.75), p95: P(.95), p99: P(.99), hiClip: hi / N, loClip: lo / N, sat: satSum / N, L };
  const region = (m, th) => { if (!m) return null; let s = 0, n = 0; const arr = []; for (let i = 0; i < N; i++) if (m[i] > th) { s += L[i]; n++; arr.push(L[i]); } return n > N * 0.01 ? { frac: n / N, mean: s / n, med: pct(arr, 0.5), p95: pct(arr, 0.95), clip: arr.filter(v => v > 0.975).length / n } : null; };
  out.sky = region(sky, 0.5); out.subj = region(subj, 0.5);
  if (sky) { const arr = []; for (let i = 0; i < N; i++) if (sky[i] < 0.3 && (!subj || subj[i] < 0.5 || true)) arr.push(L[i]); out.nonSky = arr.length > N * 0.06 ? { med: pct(arr, 0.5), p5: pct(arr, 0.05), n: arr.length / N } : null; }
  return out;
}

export function colorCast(small, sky) {
  const { data, w, h } = small; let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < w * h; i++) { if (sky && sky[i] > 0.3) continue; const R = data[i * 4], G = data[i * 4 + 1], B = data[i * 4 + 2]; const y = 0.299 * R + 0.587 * G + 0.114 * B; const mx = Math.max(R, G, B), mn = Math.min(R, G, B); if (y < 45 || y > 215 || (mx - mn) / (mx + 1) > 0.45) continue; r += R; g += G; b += B; n++; }
  if (n < w * h * 0.06) return null; r /= n; g /= n; b /= n;
  return { rb: Math.log2(r / b), gm: Math.log2(g / ((r + b) / 2)), n: n / (w * h) };
}

// inclinaison de l'horizon / lignes dominantes presque horizontales (en degrés, >0 : penche vers le bas à droite)
export function tilt(small) {
  const { data, w, h } = small; const L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const bins = new Float32Array(97); let tot = 0, near = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; const gx = L[i + 1] - L[i - 1], gy = L[i + w] - L[i - w]; const m = Math.hypot(gx, gy); if (m < 22) continue;
    let a = Math.atan2(gx, -gy) * 180 / Math.PI; // angle de la ligne par rapport à l'horizontale
    while (a > 90) a -= 180; while (a < -90) a += 180; tot += m;
    if (Math.abs(a) <= 12) { bins[Math.round((a + 12) * 4)] += m; near += m; }
  }
  if (tot < 1 || near / tot < 0.12) return null;
  let bi = 0, bv = 0; for (let i = 2; i < 95; i++) { const v = bins[i - 2] + bins[i - 1] * 2 + bins[i] * 3 + bins[i + 1] * 2 + bins[i + 2]; if (v > bv) { bv = v; bi = i; } }
  const ang = bi / 4 - 12; const conf = bv / (near * 9 / 97 * 2 + 1e-6);
  return { angle: ang, share: bv / 9 / tot, conf };
}

// ---------- métriques complètes ----------
export function measure(bitmap, mm) {
  const small = mm.small; const sky = mm.sky(), subj = mm.subject();
  const T = toneStats(small, sky, subj); const cast = colorCast(small, sky); const tl = tilt(small);
  const box = mm.subjectBox();
  const c = box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : { x: .5, y: .5 };
  const crop = cropRGBA(bitmap, c.x, c.y, 640);
  const sig = noiseSigma(crop.data, crop.w, crop.h);
  const sh = sharpness(crop.data, crop.w, crop.h, sig);
  const night = T.sky ? T.sky.mean < 0.14 : T.p50 < 0.1;
  return { T, cast, tilt: tl, box, sigma: sig, sharp: sh, night, W: bitmap.width, H: bitmap.height };
}

// score 0..100 : plus c'est haut, plus la photo est « prête »
export function score(m) {
  const T = m.T; let s = 100;
  const ref = m.night ? 0.15 : (T.nonSky ? T.nonSky.med : T.p50);
  const target = m.night ? 0.15 : 0.44;
  s -= Math.min(24, Math.abs(Math.log2(lin(target) / lin(Math.max(ref, 0.01)))) * 9);
  s -= Math.min(14, T.hiClip * 300 + (T.sky ? T.sky.clip * 30 : 0)); s -= Math.min(10, T.loClip * (m.night ? 8 : 60));
  const range = T.p95 - T.p5; s -= m.night ? 0 : clamp((0.62 - range) * 40, 0, 12);
  s -= clamp((m.sigma - 1.2) * 3.2, 0, 22); s -= clamp((22 - m.sharp) * 0.5, 0, 12);
  if (m.cast) s -= clamp((Math.abs(m.cast.rb) - 0.18) * 30, 0, 8);
  if (m.tilt && Math.abs(m.tilt.angle) > 0.5) s -= clamp(Math.abs(m.tilt.angle) * 2, 0, 5);
  return Math.round(clamp(s, 3, 100));
}

const f1 = v => (Math.round(v * 10) / 10);
// ---------- suggestions ----------
export function suggestions(m) {
  const T = m.T, items = []; const add = o => items.push(Object.assign({ sev: 0.5, why: [], effect: '' }, o));
  const evFor = (med, target) => clamp(Math.log2(lin(target) / lin(Math.max(med, 0.015))), -2.5, 2.5);
  const nonSkyMed = T.nonSky ? T.nonSky.med : T.p50;
  // Jour : on juge sur la médiane globale, avec une zone « correcte » où on ne touche à rien
  let ev;
  if (m.night) { ev = evFor(T.p50, 0.15); if (T.p50 > 0.1) ev = clamp(ev, -0.3, 0.6); }
  else { const lo = 0.36, hi = 0.60, p = T.p50; ev = p < lo ? evFor(p, lo) : p > hi ? evFor(p, hi) : 0; ev = clamp(ev, -1, 0.9); }
  if (Math.abs(ev) >= (m.night ? 0.25 : 0.3)) {
    const under = ev > 0;
    const why = under ? ["La photo est sombre : la valeur médiane est basse.", m.night ? "C'est normal de nuit, mais les détails restent peu lisibles." : "Les détails du sujet se perdent dans l'ombre."] : ["La photo est trop claire : les tons moyens montent haut.", "Les nuances des zones claires s'écrasent."];
    add({ id: 'expo', group: 'exposure', tab: 'light', title: under ? 'Éclaircir la photo' : 'Assombrir la photo', sev: clamp(Math.abs(ev) / 2.2, 0.15, 1), why, effect: `Exposition ${ev > 0 ? '+' : ''}${f1(ev)} IL : les tons moyens vont vers un niveau naturel.`, set: { exposure: f1(ev) } });
  }
  // ciel brûlé / fond très lumineux
  if (T.sky && T.sky.frac > 0.12) {
    const skyAfter = lin(T.sky.med) * Math.pow(2, Math.abs(ev) >= 0.25 ? ev : 0);
    const clipped = T.sky.clip > 0.05 || T.sky.med > 0.93;
    if (clipped || skyAfter > 0.8) {
      const need = clamp(Math.log2(0.62 / Math.max(skyAfter, 0.05)), -2.2, -0.2);
      add({ id: 'sky', group: 'sky', tab: 'zones', title: clipped ? 'Ciel brûlé : le récupérer' : 'Ciel trop lumineux', sev: clipped ? 0.85 : 0.55,
        why: ["Le fond est beaucoup plus clair que le reste.", clipped ? "Une partie du ciel est blanche pure : ce qui est brûlé ne revient pas, mais on peut l'adoucir." : "En éclaircissant le sujet, le ciel va brûler."],
        effect: `Zone Ciel : exposition ${f1(need)} IL et hautes lumières réduites. Le sujet n'est pas touché.`,
        layer: { kind: 'sky', name: 'Ciel', params: { exposure: f1(need), highlights: -35, contrast: 6 } } });
    }
  }
  // sujet sombre / contre-jour
  if (T.subj && T.subj.frac > 0.01) {
    const subjAfter = T.subj.med * 1;
    const bright = T.sky ? T.sky.med - T.subj.med : T.p75 - T.subj.med;
    if (!m.night && T.subj.frac < 0.5 && T.subj.med < 0.3 && bright > 0.25) {
      const gain = clamp(Math.log2(lin(0.42) / lin(Math.max(subjAfter, 0.03))) - (Math.abs(ev) >= 0.25 ? ev : 0), 0.15, 1.0);
      add({ id: 'subject', group: 'subject', tab: 'zones', title: bright > 0.4 ? 'Sujet sombre sur fond clair (contre-jour)' : 'Sujet trop sombre', sev: clamp(0.4 + bright, 0.5, 0.95),
        why: ["Le sujet est nettement plus sombre que l'arrière-plan.", "L'appareil a réglé la lumière sur le fond lumineux."],
        effect: `Zone Sujet : exposition +${f1(gain)} IL et ombres relevées. Le ciel reste intact.`,
        layer: { kind: 'subject', name: 'Sujet', params: { exposure: f1(gain), shadows: 25 } } });
    }
  }
  // ombres bouchées (hors nuit)
  if (!m.night && (T.p5 < 0.025 || T.loClip > 0.08) && !(T.subj)) {
    add({ id: 'shadows', group: 'shadows', tab: 'light', title: 'Ombres bouchées', sev: clamp(T.loClip * 5 + 0.3, 0.3, 0.85), why: ["Une partie de l'image est quasi noire.", "Le détail des ombres peut être rattrapé s'il existe."], effect: 'Ombres +40 : le détail sombre réapparaît (le bruit peut monter).', set: { shadows: 40, blacks: 8 } });
  }
  // nuit : lumières brûlées + ombres sans bruit
  if (m.night) {
    if (T.hiClip > 0.0008 || T.p99 > 0.97) add({ id: 'burn', group: 'highlights', tab: 'light', title: 'Lumières de piste qui brûlent', sev: clamp(0.35 + T.hiClip * 60, 0.35, 0.8), why: ["Les points lumineux sont écrêtés : ils virent au blanc.", "On peut calmer leur éclat et leur rendre de la couleur."], effect: 'Lumières brûlées 60 : les feux gardent leur teinte, sans halo blanc.', set: { burn: 60, highlights: -25 } });
    if (T.p50 < 0.16) add({ id: 'nightShadows', group: 'shadows', tab: 'light', title: 'Récupérer les ombres de nuit', sev: 0.5, why: ["Les zones sombres cachent des détails.", "Les remonter fait monter le bruit : on le réduit à côté."], effect: 'Ombres +35, noirs +6. À combiner avec la réduction du bruit.', set: { shadows: 35, blacks: 6 } });
  }
  // contraste plat
  const range = T.p95 - T.p5;
  if (!m.night && range < 0.55) add({ id: 'contrast', group: 'contrast', tab: 'light', title: 'Image plate : manque de contraste', sev: clamp((0.6 - range) * 2.2, 0.25, 0.8), why: ["L'écart entre les clairs et les sombres est faible.", "Les couleurs paraissent délavées."], effect: `Contraste +${range < 0.4 ? 28 : 18}, blancs et noirs étirés.`, set: { contrast: range < 0.4 ? 28 : 18, whites: 10, blacks: -8 } });
  // bruit
  if (m.sigma > 2.2) {
    const nl = clamp(Math.round(m.sigma * 7.5), 15, 85), nc = clamp(Math.round(m.sigma * 9), 20, 90);
    const lvl = m.sigma > 7 ? 'très fort' : m.sigma > 4.5 ? 'fort' : 'modéré';
    add({ id: 'noise', group: 'noise', tab: 'detail', title: `Bruit ${lvl}`, sev: clamp((m.sigma - 1.5) / 7, 0.3, 0.95),
      why: ["Du grain est visible dans les zones lisses.", m.night ? "La pose longue et les hauts ISO créent ce grain." : "Une photo sous-exposée remontée en post-traitement amplifie le grain."],
      effect: `Luminance ${nl}, couleur ${nc}. Le grain baisse, les contours restent nets.`, set: { nrLum: nl, nrCol: nc, nrKeep: 55, sharpMask: 45 } });
  }
  // netteté
  if (m.sharp < 24) {
    const soft = m.sharp < 12;
    add({ id: 'sharp', group: 'sharp', tab: 'detail', title: soft ? 'Photo douce : manque de netteté' : 'Léger manque de netteté', sev: soft ? 0.55 : 0.35,
      why: ["Les contours sont peu marqués.", soft ? "Si le flou vient du mouvement ou de la mise au point, il reste limité : un détail absent ne s'invente pas." : "Un peu d'accentuation suffit."],
      effect: `Netteté ${soft ? 42 : 28}${soft ? ' et texture +8' : ''}, douce, avec protection du grain.`, set: { sharpness: soft ? 42 : 28, texture: soft ? 8 : 0, sharpMask: 45 } });
  }
  // balance des blancs
  if (m.cast && !m.night && Math.abs(m.cast.rb) > 0.22) {
    const t = clamp(Math.round(-m.cast.rb * 55), -45, 45);
    add({ id: 'wb', group: 'color', tab: 'color', title: m.cast.rb > 0 ? 'Dominante chaude' : 'Dominante froide', sev: clamp((Math.abs(m.cast.rb) - 0.15) * 2, 0.2, 0.6), why: ["Les gris moyens ne sont pas neutres.", "Hors ciel, la couleur penche vers " + (m.cast.rb > 0 ? "l'orange." : "le bleu.")], effect: `Température ${t > 0 ? '+' : ''}${t} pour neutraliser.`, set: { temp: t } });
  }
  // couleurs ternes
  if (!m.night && T.sat < 0.2) add({ id: 'vib', group: 'color', tab: 'color', title: 'Couleurs ternes', sev: 0.25, why: ["Les couleurs sont peu intenses."], effect: 'Vibrance +25 : seules les couleurs faibles sont renforcées.', set: { vibrance: 25, saturation: 4 } });
  // horizon
  if (m.tilt && Math.abs(m.tilt.angle) >= 0.5 && Math.abs(m.tilt.angle) <= 8 && m.tilt.share > 0.05) add({ id: 'tilt', group: 'frame', tab: 'geom', title: `Horizon penché (${f1(Math.abs(m.tilt.angle))}°)`, sev: clamp(Math.abs(m.tilt.angle) / 4, 0.2, 0.6), why: ["Une ligne dominante n'est pas horizontale.", "Une photo bien redressée paraît plus propre."], effect: `Redressement de ${f1(-m.tilt.angle)}° avec recadrage automatique.`, geom: { angle: f1(-m.tilt.angle) } });
  // cadrage
  if (m.box) {
    const bw = m.box.x1 - m.box.x0, bh = m.box.y1 - m.box.y0, area = bw * bh;
    const touches = m.box.x0 < 0.01 || m.box.y0 < 0.01 || m.box.x1 > 0.99 || m.box.y1 > 0.99;
    if (area < 0.07 && bw < 0.4) {
      const k = 2.3, cx = (m.box.x0 + m.box.x1) / 2, cy = (m.box.y0 + m.box.y1) / 2; const w = clamp(bw * k, 0.35, 1); const h = clamp(w * m.W * (2 / 3) / m.H, 0.25, 1);
      const x = clamp(cx - w / 2, 0, 1 - w), y = clamp(cy - h / 2, 0, 1 - h);
      add({ id: 'crop', group: 'frame', tab: 'geom', title: 'Sujet petit dans le cadre', sev: 0.3, why: ["Le sujet occupe peu de place dans l'image.", "Un recadrage serré renforce l'impact, au prix de la résolution."], effect: 'Recadrage en 3:2 autour du sujet.', crop: { x, y, w, h } });
    } else if (touches && area > 0.05) add({ id: 'cut', group: 'frame', tab: 'geom', title: 'Sujet touchant le bord', sev: 0.2, why: ["Une partie du sujet semble coupée par le bord du cadre."], effect: 'Info seulement : un recadrage ne peut pas recréer ce qui manque.', info: true });
  }
  items.sort((a, b) => b.sev - a.sev); items.forEach((it, i) => it.prio = i + 1);
  return items;
}

// ---------- demandes personnelles (« ciel plus dramatique », etc.) ----------
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export function customItems(text) {
  const t = norm(text), out = []; const has = (...r) => r.some(x => x.test(t));
  const add = o => out.push(Object.assign({ custom: true, sev: 0.6, why: ['Demande personnelle : « ' + text.trim() + ' »'], effect: '' }, o));
  const ciel = /ciel/.test(t), avion = /(avion|sujet|appareil|jet|machine|train|personne|portrait|visage|modèle|modele)/.test(t), sol = /(sol|piste|asphalte|tarmac|herbe)/.test(t), nuit = /nuit/.test(t);
  if (ciel && has(/dramat/, /intense/, /profond/, /sombre/, /fonce/, /orage/)) add({ id: 'c_sky_dram', tab: 'zones', title: 'Ciel plus dramatique', effect: 'Zone Ciel : plus sombre, plus de contraste et de relief dans les nuages.', layer: { kind: 'sky', name: 'Ciel', params: { exposure: -0.5, contrast: 30, clarity: 28, saturation: 14, dehaze: 28, highlights: -30 } } });
  else if (ciel && has(/clair/, /lumineu/, /doux/, /leger/)) add({ id: 'c_sky_light', tab: 'zones', title: 'Ciel plus clair et doux', effect: 'Zone Ciel : exposition +0,4, contraste réduit.', layer: { kind: 'sky', name: 'Ciel', params: { exposure: 0.4, contrast: -12, clarity: -10 } } });
  else if (ciel && has(/bleu/, /sature/, /couleur/, /vif/)) add({ id: 'c_sky_blue', tab: 'zones', title: 'Ciel plus bleu', effect: 'Zone Ciel : saturation et fraîcheur augmentées.', layer: { kind: 'sky', name: 'Ciel', params: { saturation: 30, temp: -10, contrast: 10 } } });
  else if (ciel) add({ id: 'c_sky', tab: 'zones', title: 'Travailler le ciel', effect: 'Zone Ciel créée : règle-la à ton goût.', layer: { kind: 'sky', name: 'Ciel', params: { contrast: 10, clarity: 10 } } });
  if (avion && has(/lumineu/, /clair/, /eclair/, /ressort/, /visible/)) add({ id: 'c_pl_light', tab: 'zones', title: 'Sujet plus lumineux', effect: 'Zone Sujet : exposition +0,5, ombres relevées.', layer: { kind: 'subject', name: 'Sujet', params: { exposure: 0.5, shadows: 35, clarity: 14 } } });
  if (avion && has(/net/, /detail/, /precis/, /piqu/, /texture/)) add({ id: 'c_pl_sharp', tab: 'zones', title: 'Sujet plus net', effect: 'Zone Sujet : netteté, texture et clarté en hausse.', layer: { kind: 'subject', name: 'Sujet', params: { sharpness: 55, texture: 30, clarity: 22 } } });
  if (avion && has(/contrast/, /punch/, /relief/, /volume/)) add({ id: 'c_pl_con', tab: 'zones', title: 'Sujet avec plus de relief', effect: 'Zone Sujet : contraste et clarté.', layer: { kind: 'subject', name: 'Sujet', params: { contrast: 22, clarity: 25 } } });
  if (avion && has(/sombre/, /fonce/)) add({ id: 'c_pl_dark', tab: 'zones', title: 'Sujet plus sombre', effect: 'Zone Sujet : exposition -0,4.', layer: { kind: 'subject', name: 'Sujet', params: { exposure: -0.4 } } });
  if (sol && has(/sombre/, /fonce/, /moins clair/)) add({ id: 'c_gr_dark', tab: 'zones', title: 'Sol plus sombre', effect: 'Zone Sol : exposition -0,5.', layer: { kind: 'ground', name: 'Sol', params: { exposure: -0.5, contrast: 8 } } });
  else if (sol && has(/clair/, /lumineu/)) add({ id: 'c_gr_light', tab: 'zones', title: 'Sol plus clair', effect: 'Zone Sol : exposition +0,4.', layer: { kind: 'ground', name: 'Sol', params: { exposure: 0.4, shadows: 20 } } });
  if (nuit && has(/froid/, /bleu/)) add({ id: 'c_nuit_cold', tab: 'color', title: 'Ambiance nuit plus froide', effect: 'Température -18, saturation légèrement réduite.', set: { temp: -18, saturation: -4 } });
  else if (nuit && has(/chaud/, /orange/, /dore/)) add({ id: 'c_nuit_warm', tab: 'color', title: 'Ambiance nuit plus chaude', effect: 'Température +18.', set: { temp: 18 } });
  else if (!ciel && !avion && !sol && has(/froid/)) add({ id: 'c_cold', tab: 'color', title: 'Plus froid', effect: 'Température -15.', set: { temp: -15 } });
  else if (!ciel && !avion && !sol && has(/chaud/, /dore/, /golden/)) add({ id: 'c_warm', tab: 'color', title: 'Plus chaud', effect: 'Température +15.', set: { temp: 15 } });
  if (!ciel && !avion && !sol && has(/couleur/, /vif/, /eclatant/, /sature/) && !has(/moins/)) add({ id: 'c_col', tab: 'color', title: 'Couleurs plus vives', effect: 'Vibrance +25, saturation +6.', set: { vibrance: 25, saturation: 6 } });
  if (has(/terne/, /desatur/, /sobre/, /moins de couleur/)) add({ id: 'c_desat', tab: 'color', title: 'Couleurs plus sobres', effect: 'Saturation -18.', set: { saturation: -18 } });
  if (!ciel && !avion && !sol && has(/contrast/, /punch/)) add({ id: 'c_con', tab: 'light', title: 'Plus de contraste', effect: 'Contraste +25, clarté +12.', set: { contrast: 25, clarity: 12 } });
  if (has(/cinema/, /film/, /ambiance/) && !nuit) add({ id: 'c_cine', tab: 'light', title: 'Ambiance cinéma', effect: 'Contraste +15, vignettage 25, saturation -8.', set: { contrast: 15, vignette: 25, saturation: -8 } });
  if (has(/vignet/)) add({ id: 'c_vig', tab: 'light', title: 'Vignettage', effect: 'Bords assombris (30).', set: { vignette: 30 } });
  if (!avion && has(/propre/, /bruit/, /grain/, /lisse/)) add({ id: 'c_nr', tab: 'detail', title: 'Image plus propre', effect: 'Réduction du bruit 55 / 60.', set: { nrLum: 55, nrCol: 60, nrKeep: 55 } });
  if (!avion && !ciel && has(/net/, /precis/, /piqu/)) add({ id: 'c_sh', tab: 'detail', title: 'Plus net', effect: 'Netteté 55, texture +20.', set: { sharpness: 55, texture: 20 } });
  if (!ciel && !avion && !sol && has(/sombre/, /fonce/)) add({ id: 'c_dark', tab: 'light', title: 'Plus sombre', effect: 'Exposition -0,4.', set: { exposure: -0.4 } });
  else if (!ciel && !avion && !sol && !nuit && has(/lumineu/, /clair/, /eclair/)) add({ id: 'c_bright', tab: 'light', title: 'Plus lumineux', effect: 'Exposition +0,4, ombres +15.', set: { exposure: 0.4, shadows: 15 } });
  return out;
}

export async function analyzeBitmap(bitmap, mm) {
  if (!mm) { mm = new MaskManager(); mm.setSource(bitmap); }
  const m = measure(bitmap, mm); const items = suggestions(m); return { m, items, score: score(m), mm };
}
