// Import RAW (Canon CR2 du EOS 100D, DNG, NEF, ARW…) via LibRaw (WebAssembly), avec repli sur l'aperçu JPEG intégré
export const RAW_RE = /\.(cr2|cr3|crw|dng|nef|nrw|arw|srf|sr2|raf|orf|rw2|pef|srw|3fr|erf|kdc|mrw|raw)$/i;
export const isRaw = f => RAW_RE.test(f.name || '');

let H_LUT = null;
function halfLUT() {
  if (H_LUT) return H_LUT; H_LUT = new Uint16Array(65536); const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  for (let i = 0; i < 65536; i++) {
    const v = i / 65535; if (v <= 0) { H_LUT[i] = 0; continue; } f[0] = v; const x = u[0], e = ((x >> 23) & 255) - 127;
    if (e < -14) H_LUT[i] = Math.round(v / 2 ** -24); else H_LUT[i] = ((e + 15) << 10) + (((x & 0x7fffff) + 0x1000) >> 13);
  }
  return H_LUT;
}

// extrait le plus grand JPEG intégré (CR2 / DNG / NEF sont des conteneurs TIFF)
export function embeddedJpeg(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); const le = dv.getUint16(0) === 0x4949; let best = null;
  const rd16 = o => dv.getUint16(o, le), rd32 = o => dv.getUint32(o, le); const seen = new Set();
  const scan = off => {
    if (!off || off + 2 > u8.length || seen.has(off)) return; seen.add(off);
    const n = rd16(off); let comp = 0, so = 0, sc = 0, jo = 0, jl = 0, sub = [];
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12; if (e + 12 > u8.length) break; const tag = rd16(e), type = rd16(e + 2), cnt = rd32(e + 4); const val = (type === 3 && cnt === 1) ? rd16(e + 8) : rd32(e + 8);
      if (tag === 259) comp = val; else if (tag === 273) so = val; else if (tag === 279) sc = val; else if (tag === 513) jo = val; else if (tag === 514) jl = val; else if (tag === 330) { if (cnt === 1) sub.push(val); else for (let k = 0; k < cnt; k++) sub.push(rd32(val + k * 4)); }
    }
    for (const [o, l] of [[so, sc], [jo, jl]]) if (o && l && o + l <= u8.length && u8[o] === 0xFF && u8[o + 1] === 0xD8 && (!best || l > best[1])) best = [o, l];
    sub.forEach(scan); const next = rd32(off + 2 + n * 12); if (next) scan(next);
  };
  try { scan(rd32(4)); } catch { }
  if (!best) { // repli : recherche brute de segments JPEG
    for (let i = 0; i < u8.length - 3; i++) if (u8[i] === 0xFF && u8[i + 1] === 0xD8 && u8[i + 2] === 0xFF) { let j = u8.length - 2; while (j > i && !(u8[j] === 0xFF && u8[j + 1] === 0xD9)) j--; const l = j - i + 2; if (l > 50000 && (!best || l > best[1])) best = [i, l]; i += 2000; }
  }
  return best ? u8.subarray(best[0], best[0] + best[1]) : null;
}

export async function decodeRaw(file, { half = false, onStatus = () => { }, canHalfFloat = true } = {}) {
  const buf = new Uint8Array(await file.arrayBuffer());
  try {
    onStatus('Décodage du RAW…');
    const { default: LibRaw } = await import('../vendor/libraw/index.js');
    const raw = new LibRaw();
    try {
      await raw.open(buf.slice(), { useCameraWb: true, noAutoBright: true, outputBps: 16, outputColor: 1, highlight: 2, userQual: 3, halfSize: !!half, gamm: [1 / 2.4, 12.92], userFlip: -1, bright: 1.0 });
      const img = await raw.imageData(); if (!img || !img.data) throw new Error('RAW vide');
      const { width: w, height: h, colors } = img; const src = img.data; const n = w * h; const c = colors >= 3 ? 3 : 1;
      onStatus('Conversion 16 bits…');
      const out8 = new Uint8ClampedArray(n * 4); let h16 = null;
      if (canHalfFloat && img.bits === 16) h16 = new Uint16Array(n * 4); const L = halfLUT(), one = L[65535];
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) { const v = src[i * c + (c === 3 ? k : 0)]; out8[i * 4 + k] = img.bits === 16 ? (v + 128) >> 8 : v; if (h16) h16[i * 4 + k] = L[v]; }
        out8[i * 4 + 3] = 255; if (h16) h16[i * 4 + 3] = one;
      }
      const bitmap = await createImageBitmap(new ImageData(out8, w, h));
      return { bitmap, half16: h16 ? { data: h16, w, h } : null, w, h, source: 'raw' };
    } finally { raw.dispose(); }
  } catch (err) {
    console.warn('LibRaw a échoué, repli sur l\'aperçu intégré', err);
    onStatus('Aperçu JPEG intégré…');
    const j = embeddedJpeg(buf); if (!j) throw new Error('Fichier RAW illisible sur cet appareil.');
    const bitmap = await createImageBitmap(new Blob([j], { type: 'image/jpeg' }), { imageOrientation: 'from-image' });
    return { bitmap, half16: null, w: bitmap.width, h: bitmap.height, source: 'preview' };
  }
}
