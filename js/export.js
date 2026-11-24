// Encodeurs sans perte (PNG, TIFF), JPEG qualité maximale, ZIP, filigrane, formats réseaux sociaux
const te = new TextEncoder();
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf, c = 0) { c = ~c >>> 0; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return ~c >>> 0; }

export const FORMATS = [
  { id: 'orig', label: 'Taille d\'origine', w: 0, h: 0, ratio: 0, sharp: 0 },
  { id: 'ig45', label: 'Instagram portrait 4:5 — 1080×1350', w: 1080, h: 1350, ratio: 4 / 5, sharp: 0.25 },
  { id: 'ig11', label: 'Instagram carré — 1080×1080', w: 1080, h: 1080, ratio: 1, sharp: 0.25 },
  { id: 'ig191', label: 'Instagram paysage — 1080×566', w: 1080, h: 566, ratio: 1080 / 566, sharp: 0.25 },
  { id: 'story', label: 'Story / Reels / TikTok 9:16 — 1080×1920', w: 1080, h: 1920, ratio: 9 / 16, sharp: 0.25 },
  { id: 'yt', label: 'YouTube 16:9 — 1920×1080', w: 1920, h: 1080, ratio: 16 / 9, sharp: 0.2 },
  { id: 'ytthumb', label: 'Miniature YouTube — 1280×720', w: 1280, h: 720, ratio: 16 / 9, sharp: 0.25 },
  { id: 'yt4k', label: 'YouTube 4K — 3840×2160', w: 3840, h: 2160, ratio: 16 / 9, sharp: 0.15 },
];

// ---- PNG sans perte (sans passer par un canvas, donc sans limite de taille de canvas) ----
export async function encodePNG(rgba, w, h) {
  const row = w * 3 + 1, raw = new Uint8Array(row * h);
  for (let y = 0; y < h; y++) {
    let o = y * row; raw[o++] = 1; const s = y * w * 4;
    for (let x = 0; x < w; x++) { const i = s + x * 4; for (let c = 0; c < 3; c++) raw[o++] = (rgba[i + c] - (x ? rgba[i - 4 + c] : 0)) & 255; }
  }
  let z;
  if (typeof CompressionStream !== 'undefined') z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  else return canvasBlob(rgba, w, h, 'image/png');
  const chunk = (type, data) => { const b = new Uint8Array(12 + data.length), dv = new DataView(b.buffer); dv.setUint32(0, data.length); b.set(te.encode(type), 4); b.set(data, 8); dv.setUint32(8 + data.length, crc32(b.subarray(4, 8 + data.length))); return b; };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const srgb = chunk('sRGB', new Uint8Array([0]));
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), srgb, chunk('IDAT', z), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}

// ---- TIFF 8 bits RGB non compressé ----
export function encodeTIFF(rgba, w, h) {
  const n = 12, ifdOff = 8, extra = ifdOff + 2 + n * 12 + 4, bpsOff = extra, resOff = extra + 6, dataOff = extra + 6 + 16;
  const buf = new ArrayBuffer(dataOff + w * h * 3), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint16(0, 0x4949, true); dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true); dv.setUint16(ifdOff, n, true);
  let p = ifdOff + 2; const ent = (tag, type, cnt, val) => { dv.setUint16(p, tag, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, cnt, true); if (type === 3 && cnt === 1) dv.setUint16(p + 8, val, true); else dv.setUint32(p + 8, val, true); p += 12; };
  ent(256, 4, 1, w); ent(257, 4, 1, h); ent(258, 3, 3, bpsOff); ent(259, 3, 1, 1); ent(262, 3, 1, 2); ent(273, 4, 1, dataOff); ent(277, 3, 1, 3); ent(278, 4, 1, h); ent(279, 4, 1, w * h * 3); ent(282, 5, 1, resOff); ent(283, 5, 1, resOff + 8); ent(296, 3, 1, 2);
  dv.setUint32(p, 0, true);
  dv.setUint16(bpsOff, 8, true); dv.setUint16(bpsOff + 2, 8, true); dv.setUint16(bpsOff + 4, 8, true);
  dv.setUint32(resOff, 300, true); dv.setUint32(resOff + 4, 1, true); dv.setUint32(resOff + 8, 300, true); dv.setUint32(resOff + 12, 1, true);
  let o = dataOff; for (let i = 0; i < w * h; i++) { u8[o++] = rgba[i * 4]; u8[o++] = rgba[i * 4 + 1]; u8[o++] = rgba[i * 4 + 2]; }
  return new Blob([buf], { type: 'image/tiff' });
}

export function canvasBlob(rgba, w, h, type, q) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), x = c.getContext('2d');
  x.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), w, h), 0, 0);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Le navigateur refuse une image aussi grande pour ce format. Choisis PNG ou TIFF.')), type, q));
}
export async function encode(rgba, w, h, fmt, quality = 1) {
  if (fmt === 'png') return encodePNG(rgba, w, h);
  if (fmt === 'tiff') return encodeTIFF(rgba, w, h);
  if (fmt === 'webp') return canvasBlob(rgba, w, h, 'image/webp', quality);
  return canvasBlob(rgba, w, h, 'image/jpeg', quality);
}
export const EXT = { png: 'png', tiff: 'tif', jpeg: 'jpg', webp: 'webp' };

// ---- filigrane texte (coin choisi, opacité, taille relative) ----
export function watermark(rgba, w, h, { text, pos = 'br', opacity = 0.6, size = 0.035 }) {
  if (!text) return;
  const fs = Math.max(12, Math.round(Math.min(w, h) * size)), c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = `600 ${fs}px system-ui, sans-serif`; const tw = Math.ceil(x.measureText(text).width) + 4, th = Math.ceil(fs * 1.4);
  c.width = tw; c.height = th; x.font = `600 ${fs}px system-ui, sans-serif`; x.textBaseline = 'middle';
  x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = fs * 0.15; x.fillStyle = '#fff'; x.fillText(text, 2, th / 2);
  const wm = x.getImageData(0, 0, tw, th).data; const mg = Math.round(fs * 0.7);
  const ox = pos.includes('l') ? mg : w - tw - mg, oy = pos.includes('t') ? mg : h - th - mg;
  for (let y = 0; y < th; y++) for (let xx = 0; xx < tw; xx++) {
    const a = wm[(y * tw + xx) * 4 + 3] / 255 * opacity; if (!a) continue; const px = ox + xx, py = oy + y; if (px < 0 || py < 0 || px >= w || py >= h) continue; const i = (py * w + px) * 4;
    for (let k = 0; k < 3; k++) rgba[i + k] = rgba[i + k] * (1 - a) + wm[(y * tw + xx) * 4 + k] * a;
  }
}

// ---- ZIP (sans compression) ----
export async function makeZip(files) {
  const parts = [], central = []; let off = 0; const now = new Date();
  const dt = ((now.getFullYear() - 1980) << 9 | (now.getMonth() + 1) << 5 | now.getDate()) & 0xFFFF, tm = (now.getHours() << 11 | now.getMinutes() << 5 | (now.getSeconds() >> 1)) & 0xFFFF;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()), name = te.encode(f.name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, tm, true); h.setUint16(12, dt, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, tm, true); c.setUint16(14, dt, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(c.buffer, name); off += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, b) => a + (b.byteLength ?? b.length), 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}

export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
export async function share(blob, name) {
  const f = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return true; }
  return false;
}
