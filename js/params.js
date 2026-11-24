// Paramètres, plages, textes pédagogiques (mode apprendre), courbes
export const DEFAULTS = () => ({
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, burn: 0,
  temp: 0, tint: 0, vibrance: 0, saturation: 0,
  hsl: { h: Array(8).fill(0), s: Array(8).fill(0), l: Array(8).fill(0) },
  sharpness: 0, sharpRadius: 1.0, sharpMask: 25, texture: 0, clarity: 0, dehaze: 0, vignette: 0,
  nrLum: 0, nrCol: 0, nrKeep: 50,
});
export const CURVES = () => ({ m: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] });

// clé : [libellé, min, max, pas, unité]
export const META = {
  exposure: ['Exposition', -4, 4, 0.05, ' IL'], contrast: ['Contraste', -100, 100, 1, ''], highlights: ['Hautes lumières', -100, 100, 1, ''], shadows: ['Ombres', -100, 100, 1, ''],
  whites: ['Blancs', -100, 100, 1, ''], blacks: ['Noirs', -100, 100, 1, ''], burn: ['Lumières brûlées', 0, 100, 1, ''],
  temp: ['Température', -100, 100, 1, ''], tint: ['Teinte', -100, 100, 1, ''], vibrance: ['Vibrance', -100, 100, 1, ''], saturation: ['Saturation', -100, 100, 1, ''],
  sharpness: ['Netteté', 0, 150, 1, ''], sharpRadius: ['Rayon', 0.5, 3, 0.1, ' px'], sharpMask: ['Protection du bruit', 0, 100, 1, ''],
  texture: ['Texture', -100, 100, 1, ''], clarity: ['Clarté', -100, 100, 1, ''], dehaze: ['Voile', -100, 100, 1, ''], vignette: ['Vignettage', -100, 100, 1, ''],
  nrLum: ['Bruit de luminance', 0, 100, 1, ''], nrCol: ['Bruit de couleur', 0, 100, 1, ''], nrKeep: ['Détails conservés', 0, 100, 1, ''],
};

export const HSL_NAMES = ['Rouge', 'Orange', 'Jaune', 'Vert', 'Cyan', 'Bleu', 'Violet', 'Magenta'];
export const HSL_COLORS = ['#e5484d', '#f08c3a', '#e9c53a', '#4cb26a', '#3cb8c6', '#4a7de0', '#8a5ad6', '#d65aa8'];

// Textes courts, en français : ce que c'est, ce qui se passe en montant / en baissant, conseil
export const LEARN = {
  exposure: { d: "Règle la quantité de lumière de toute la photo.", up: "La photo s'éclaircit. Les ciels clairs peuvent brûler.", down: "La photo s'assombrit. Les ombres se bouchent plus vite.", tip: "Commence ici, puis ajuste les ombres et les hautes lumières." },
  contrast: { d: "Écarte les clairs et les sombres.", up: "Plus de punch, mais les ombres et les lumières perdent du détail.", down: "Image plus douce, plus plate.", tip: "Sur une photo plate, +15 à +30 suffit souvent." },
  highlights: { d: "Agit seulement sur les zones claires (ciel, reflets).", up: "Les zones claires brillent plus.", down: "Les zones claires s'assombrissent et retrouvent du détail.", tip: "Un ciel trop clair ? Baisse ici avant de toucher à l'exposition." },
  shadows: { d: "Agit seulement sur les zones sombres.", up: "Les ombres s'éclaircissent et montrent du détail. Le bruit monte aussi.", down: "Les ombres se creusent.", tip: "Pour un sujet sombre en contre-jour, monte les ombres puis réduis le bruit." },
  whites: { d: "Fixe le point le plus clair de l'image.", up: "Les blancs deviennent plus lumineux, l'image gagne en éclat.", down: "Les blancs se calment.", tip: "Surveille l'avertissement d'écrêtage (zones rouges)." },
  blacks: { d: "Fixe le point le plus sombre de l'image.", up: "Les noirs se relèvent : look plus doux, plus délavé.", down: "Les noirs s'enfoncent : image plus profonde.", tip: "Baisse un peu si l'image paraît grise." },
  burn: { d: "Calme les lumières trop fortes et leur rend un peu de couleur.", up: "Les points très clairs (feux, balisage) brûlent moins.", down: "Aucun effet.", tip: "Utile de nuit pour les lumières de piste." },
  temp: { d: "Rend l'image plus chaude (orange) ou plus froide (bleue).", up: "Plus chaud : tons orangés, ambiance de fin de journée.", down: "Plus froid : tons bleus, ambiance de nuit.", tip: "Cherche un gris ou un blanc neutre et corrige jusqu'à ce qu'il soit neutre." },
  tint: { d: "Corrige une dominante verte ou magenta.", up: "Plus de magenta.", down: "Plus de vert.", tip: "Les éclairages de nuit tirent souvent vers le vert." },
  vibrance: { d: "Renforce surtout les couleurs ternes, sans trop toucher aux vives.", up: "Les couleurs faibles gagnent en intensité.", down: "Les couleurs faibles s'éteignent.", tip: "Plus naturel que la saturation." },
  saturation: { d: "Intensité de toutes les couleurs.", up: "Couleurs plus fortes, vite artificielles.", down: "Vers le noir et blanc.", tip: "Reste sous +20 pour un rendu naturel." },
  sharpness: { d: "Accentue les contours.", up: "Les bords sont plus nets. Trop haut : halos et bruit accentué.", down: "Aucun effet.", tip: "Applique la netteté après la réduction du bruit." },
  sharpRadius: { d: "Largeur des contours accentués.", up: "Accentuation plus large, plus visible.", down: "Accentuation très fine.", tip: "1 px convient aux photos pleine taille." },
  sharpMask: { d: "Évite d'accentuer le grain dans les zones lisses.", up: "Seuls les vrais contours sont accentués.", down: "Tout est accentué, grain compris.", tip: "Monte-le si le ciel devient granuleux." },
  texture: { d: "Accentue les petits détails (rivets, peinture, tôle).", up: "Surfaces plus détaillées.", down: "Surfaces plus lisses.", tip: "Bon pour le fuselage, mauvais pour la peau." },
  clarity: { d: "Contraste sur les moyennes zones.", up: "Plus de relief et de volume.", down: "Effet doux, brumeux.", tip: "Trop fort : halos autour des objets." },
  dehaze: { d: "Enlève la brume ou ajoute du voile.", up: "Plus de contraste et de couleur au loin.", down: "Ajoute un voile doux.", tip: "Utile sous la pluie ou en cas de brume." },
  vignette: { d: "Assombrit ou éclaircit les bords.", up: "Bords plus sombres : le regard va au centre.", down: "Bords plus clairs.", tip: "Reste discret (15 à 30)." },
  nrLum: { d: "Lisse le grain de luminance (points clairs et sombres).", up: "Moins de grain, mais risque d'effet cire sur les détails.", down: "Plus de grain.", tip: "Monte jusqu'à ce que le ciel soit propre, puis vérifie les détails à 100 %." },
  nrCol: { d: "Enlève les taches de couleur dans le grain.", up: "Les points rouges et verts disparaissent.", down: "Taches de couleur visibles.", tip: "Peut monter haut sans abîmer la photo." },
  nrKeep: { d: "Quantité de détails remis après la réduction du bruit.", up: "Plus de détails, un peu plus de grain.", down: "Image plus lisse.", tip: "50 est un bon équilibre." },
  angle: { d: "Redresse l'horizon.", up: "Rotation dans le sens horaire.", down: "Rotation dans le sens antihoraire.", tip: "Cale-toi sur l'horizon ou la piste." },
  vp: { d: "Corrige les lignes verticales qui penchent (vue en contre-plongée).", up: "Le haut s'écarte.", down: "Le haut se rapproche.", tip: "Regarde un bâtiment ou un mât pour juger." },
  hp: { d: "Corrige les lignes horizontales en perspective.", up: "Le côté droit s'écarte.", down: "Le côté gauche s'écarte.", tip: "Souvent inutile pour une photo de paysage." },
  curve: { d: "Dessine la réponse tonale point par point.", up: "Monter un point éclaircit cette zone.", down: "Descendre un point l'assombrit.", tip: "Une légère courbe en S donne du contraste." },
  hsl: { d: "Règle chaque couleur séparément.", up: "Teinte : change la couleur. Saturation : l'intensité. Luminance : la clarté.", down: "", tip: "Bleu : le ciel. Orange : les feux de nuit." },
};

export function explainChange(key, oldV, newV) {
  const L = LEARN[key]; if (!L) return null; const name = (META[key] || [key])[0];
  const d = newV - oldV; if (Math.abs(d) < 1e-6) return null;
  const fmt = v => (META[key] && META[key][3] < 1) ? v.toFixed(2) : Math.round(v);
  return { title: `${name} ${newV > 0 ? '+' : ''}${fmt(newV)}`, text: (d > 0 ? L.up : L.down) || L.d, tip: L.tip };
}

// ---------- courbe : interpolation monotone (Fritsch–Carlson) -> 256 valeurs ----------
export function curveValues(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0]); const n = p.length; const out = new Float32Array(256);
  if (n < 2) { for (let i = 0; i < 256; i++) out[i] = i / 255; return out; }
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx.push(p[i + 1][0] - p[i][0] || 1e-6); dy.push(p[i + 1][1] - p[i][1]); m.push(dy[i] / dx[i]); }
  const t = [m[0]]; for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2); t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) { if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; } const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b; if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; } }
  for (let i = 0; i < 256; i++) {
    const x = i / 255; let k = 0; while (k < n - 2 && x > p[k + 1][0]) k++;
    if (x <= p[0][0]) { out[i] = p[0][1]; continue; } if (x >= p[n - 1][0]) { out[i] = p[n - 1][1]; continue; }
    const h = dx[k], s = (x - p[k][0]) / h, s2 = s * s, s3 = s2 * s;
    out[i] = Math.min(1, Math.max(0, (2 * s3 - 3 * s2 + 1) * p[k][1] + (s3 - 2 * s2 + s) * h * t[k] + (-2 * s3 + 3 * s2) * p[k + 1][1] + (s3 - s2) * h * t[k + 1]));
  }
  return out;
}
export function curvesIdentity(c) { return ['m', 'r', 'g', 'b'].every(k => c[k].length === 2 && c[k][0][0] === 0 && c[k][0][1] === 0 && c[k][1][0] === 1 && c[k][1][1] === 1); }
export function buildLUT(c) {
  const m = curveValues(c.m), r = curveValues(c.r), g = curveValues(c.g), b = curveValues(c.b); const u = new Uint8Array(256 * 4);
  const at = (arr, v) => { const x = Math.min(255, Math.max(0, v * 255)); const i = Math.floor(x), f = x - i; return arr[i] * (1 - f) + arr[Math.min(255, i + 1)] * f; };
  for (let i = 0; i < 256; i++) { const v = m[i]; u[i * 4] = Math.round(at(r, v) * 255); u[i * 4 + 1] = Math.round(at(g, v) * 255); u[i * 4 + 2] = Math.round(at(b, v) * 255); u[i * 4 + 3] = 255; }
  return u;
}
