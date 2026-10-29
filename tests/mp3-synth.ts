// Synthetische mp3-Dateien für Tests: gültige Frame-Header, Nutzdaten tragen die Frame-Nummer. Kein Ton, nur Bytes.
const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SRS: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000] };

export interface SynthOpts {
  bitrate?: number;
  sampleRate?: number;
  /** 3 = MPEG 1, 2 = MPEG 2 */
  version?: 3 | 2;
  /** Tonframes (ohne Info/Xing-Frame) */
  frames: number;
  id3?: number;
  tag?: 'info' | 'xing' | null;
  /** ab diesem Tonframe anderes Bitrate */
  switchAt?: { frame: number; bitrate: number };
  /** ID3v1 am Ende */
  id3v1?: boolean;
}

export const frameLen = (version: 2 | 3, bitrate: number, sr: number, pad: number) => Math.floor(((version === 3 ? 1152 : 576) / 8) * bitrate * 1000 / sr) + pad;

export function synthMp3(o: SynthOpts): { bytes: Uint8Array; audio0: number; frameStarts: number[] } {
  const version = o.version ?? 3;
  const sr = o.sampleRate ?? (version === 3 ? 44100 : 22050);
  const parts: Uint8Array[] = [];
  let pos = 0;
  const push = (u: Uint8Array) => {
    parts.push(u);
    pos += u.length;
  };
  if (o.id3) {
    const h = new Uint8Array(o.id3);
    h.set([0x49, 0x44, 0x33, 4, 0, 0]);
    const size = o.id3 - 10;
    h.set([(size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127], 6);
    push(h);
  }
  const mk = (bitrate: number, idx: number, n: number, tag?: string) => {
    const table = version === 3 ? BR1 : BR2;
    const bi = table.indexOf(bitrate);
    const si = SRS[version].indexOf(sr);
    // Padding wie bei 44,1 kHz: Bruchteil sammeln
    const exact = ((version === 3 ? 1152 : 576) / 8 * bitrate * 1000) / sr;
    const pad = Math.floor((n + 1) * (exact - Math.floor(exact))) - Math.floor(n * (exact - Math.floor(exact)));
    const len = Math.floor(exact) + pad;
    const f = new Uint8Array(len);
    f[0] = 0xff;
    f[1] = 0xe0 | (version << 3) | (1 << 1) | 1; // Layer III, keine CRC
    f[2] = (bi << 4) | (si << 2) | (pad << 1);
    f[3] = 0xc0; // mono
    const side = version === 3 ? 17 : 9;
    if (tag) f.set(Array.from(tag).map((c) => c.charCodeAt(0)), 4 + side);
    else new DataView(f.buffer).setUint32(60 < len ? 52 : 8, idx);
    return f;
  };
  const br0 = o.bitrate ?? 128;
  let n = 0;
  if (o.tag) push(mk(br0, 0, n++, o.tag === 'info' ? 'Info' : 'Xing'));
  const audio0 = pos;
  const starts: number[] = [];
  for (let i = 0; i < o.frames; i++) {
    const br = o.switchAt && i >= o.switchAt.frame ? o.switchAt.bitrate : br0;
    starts.push(pos);
    push(mk(br, i, n++));
  }
  if (o.id3v1) push(Object.assign(new Uint8Array(128), { 0: 0x54, 1: 0x41, 2: 0x47 }));
  const bytes = new Uint8Array(pos);
  let q = 0;
  for (const p of parts) {
    bytes.set(p, q);
    q += p.length;
  }
  return { bytes, audio0, frameStarts: starts };
}

/** Frame-Nummer, die mk() in die Nutzdaten geschrieben hat */
export const frameIndexAt = (b: Uint8Array, at: number, len: number) => new DataView(b.buffer, b.byteOffset).getUint32(at + (60 < len ? 52 : 8));
