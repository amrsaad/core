// Erzeugt die markierten Icons der Vorschau (Entscheidung 56): die Originale aus public/ mit einem orangen Balken unten.
// Keine Abhängigkeit, kein Browser: liest 8-Bit-PNG ohne Interlacing (RGB oder RGBA), zeichnet den Balken und schreibt neu.
// Aufruf: npm run icons:preview  (schreibt public/preview/icon-192.png, icon-512.png, apple-touch-icon.png)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const BAR = [255, 138, 0]; // #FF8A00
const BAR_SHARE = 0.17; // Anteil der Höhe
const FILES = ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};

function decode(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('kein PNG');
  let pos = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; color = data[9]; interlace = data[12]; }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) throw new Error(`nicht unterstützt: depth ${depth}, color ${color}, interlace ${interlace}`);
  const bpp = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 0xff;
    }
  }
  return { w, h, color, bpp, px };
}

function encode({ w, h, color, bpp, px }) {
  const stride = w * bpp;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); // Filter 0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = color;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(new URL('../public/preview/', import.meta.url), { recursive: true });
for (const name of FILES) {
  const img = decode(readFileSync(new URL(`../public/${name}`, import.meta.url)));
  const from = img.h - Math.round(img.h * BAR_SHARE);
  for (let y = from; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * img.bpp;
      img.px[i] = BAR[0]; img.px[i + 1] = BAR[1]; img.px[i + 2] = BAR[2];
      if (img.bpp === 4) img.px[i + 3] = 255;
    }
  }
  writeFileSync(new URL(`../public/preview/${name}`, import.meta.url), encode(img));
  console.log(`public/preview/${name} (${img.w}x${img.h})`);
}
