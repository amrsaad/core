// Ausschnitt start bis end aus einer mp3-Datei per Byte-Range, ohne die ganze Datei zu laden.
// Reine Funktionen über Bytes, der Abruf kommt von außen (fetchRange), damit Tests ohne Netz laufen.
// Gleiche Regel wie ios/Core/Mp3Range.swift (Zahlen und Grenzen identisch, beide gegen dieselbe Testdatei geprüft).
//
// Annahme: konstante Bitrate (CBR). Die Zeit eines Bytes ist dann exakt Frames mal Frame-Dauer.
// Variable Bitrate (Xing, VBRI oder wechselnde Bitrate im Ausschnitt) wird nicht vorgeladen, der Moment streamt wie bisher.

export const LEAD_S = 0.15;
export const TAIL_S = 1.0;
export const HEAD_BYTES = 16384;
export const MAX_SLICE_BYTES = 4 * 1024 * 1024;

const BR_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BR_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SR: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export interface FrameHeader {
  /** Länge des Frames in Bytes samt Header */
  len: number;
  bitrate: number;
  sampleRate: number;
  version: number;
  samples: number;
  /** Frame trägt eine CRC (2 Bytes nach dem Header) */
  crc: boolean;
  mono: boolean;
}

export function parseHeader(b: Uint8Array, i: number): FrameHeader | null {
  if (i < 0 || i + 4 > b.length) return null;
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 3;
  const layer = (b[i + 1] >> 1) & 3;
  if (version === 1 || layer !== 1) return null;
  const bi = b[i + 2] >> 4;
  const si = (b[i + 2] >> 2) & 3;
  if (bi === 0 || bi === 15 || si === 3) return null;
  const pad = (b[i + 2] >> 1) & 1;
  const bitrate = (version === 3 ? BR_V1 : BR_V2)[bi];
  const sampleRate = SR[version][si];
  const samples = version === 3 ? 1152 : 576;
  const len = Math.floor(((samples / 8) * bitrate * 1000) / sampleRate) + pad;
  return { len, bitrate, sampleRate, version, samples, crc: (b[i + 1] & 1) === 0, mono: b[i + 3] >> 6 === 3 };
}

/** Größe eines ID3v2-Tags am Anfang (0, wenn keiner da ist) */
export function id3v2Size(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const size = ((b[6] & 127) << 21) | ((b[7] & 127) << 14) | ((b[8] & 127) << 7) | (b[9] & 127);
  return 10 + size + ((b[5] & 0x10) !== 0 ? 10 : 0);
}

const sameStream = (a: FrameHeader, h: FrameHeader) => a.version === h.version && a.sampleRate === h.sampleRate;

/** Erster Frame ab from, bestätigt durch eine Kette von n gleichartigen Headern (oder Dateiende) */
export function findFrame(b: Uint8Array, from: number, chain = 3): number {
  for (let i = Math.max(0, from); i + 4 <= b.length; i++) {
    if (b[i] !== 0xff) continue;
    const h = parseHeader(b, i);
    if (!h) continue;
    let p = i + h.len;
    let ok = 1;
    while (ok < chain) {
      if (p + 4 > b.length) break;
      const n = parseHeader(b, p);
      if (!n || !sameStream(h, n)) {
        ok = -1;
        break;
      }
      p += n.len;
      ok++;
    }
    if (ok >= chain || (ok > 0 && p + 4 > b.length && ok >= 2)) return i;
  }
  return -1;
}

export type TagKind = 'info' | 'xing' | 'vbri' | null;

/** Xing, Info oder VBRI im ersten Frame */
export function tagOf(b: Uint8Array, at: number, h: FrameHeader): TagKind {
  const side = h.version === 3 ? (h.mono ? 17 : 32) : h.mono ? 9 : 17;
  const x = at + 4 + (h.crc ? 2 : 0) + side;
  const s = (o: number) => (o + 4 <= b.length ? String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) : '');
  const t = s(x);
  if (t === 'Xing') return 'xing';
  if (t === 'Info') return 'info';
  if (s(at + 36) === 'VBRI') return 'vbri';
  return null;
}

export interface Mp3Head {
  /** Byte, ab dem die Tonzeit 0 gilt (erster Tonframe, nach einem Info-Frame) */
  audio0: number;
  bitrate: number;
  sampleRate: number;
  version: number;
  samples: number;
  /** mittlere Frame-Länge in Bytes, Bruchteil bleibt (44,1 kHz) */
  frameBytes: number;
}

export interface RangeResult {
  /** Gelieferte Bytes. Weniger als angefragt heißt: Dateiende erreicht. */
  bytes: Uint8Array;
}
export type RangeFetch = (from: number, to: number) => Promise<RangeResult>;

export type Mp3Fail = 'vbr' | 'no-sync' | 'free-format' | 'too-big' | 'short' | 'mixed';
export class Mp3Error extends Error {
  constructor(public reason: Mp3Fail) {
    super(`mp3 ${reason}`);
  }
}

/** Kopfdaten der Datei: ID3, erster Frame, Xing/Info/VBRI. Wirft Mp3Error, wenn der Ausschnitt-Weg nicht trägt. */
export async function readHead(fetchRange: RangeFetch): Promise<Mp3Head> {
  // Content-Range ist über CORS meist nicht lesbar, darum kommt die Dateigröße hier nirgends vor
  const first = await fetchRange(0, HEAD_BYTES - 1);
  const skip = id3v2Size(first.bytes);
  let buf = first.bytes;
  let base = 0;
  if (skip + 4096 > buf.length && buf.length >= HEAD_BYTES) {
    buf = (await fetchRange(skip, skip + HEAD_BYTES - 1)).bytes;
    base = skip;
  }
  const f = findFrame(buf, base === 0 ? skip : 0);
  if (f < 0) throw new Mp3Error('no-sync');
  const h = parseHeader(buf, f)!;
  const tag = tagOf(buf, f, h);
  if (tag === 'xing' || tag === 'vbri') throw new Mp3Error('vbr');
  const frameBytes = ((h.samples / 8) * h.bitrate * 1000) / h.sampleRate;
  // Info ist ein stiller Frame ohne Ton: Zeit 0 beginnt danach
  const audio0 = base + f + (tag === 'info' ? h.len : 0);
  return { audio0, bitrate: h.bitrate, sampleRate: h.sampleRate, version: h.version, samples: h.samples, frameBytes };
}

export interface Mp3Slice {
  bytes: Uint8Array;
  /** Tonzeit des ersten Bytes in der Quelle, Sekunden */
  offset: number;
  /** Dauer des Ausschnitts in Sekunden */
  duration: number;
}

/** Bytes → Tonzeit am Framebeginn (exakt bei CBR) */
export const timeOfFrameAt = (head: Mp3Head, byte: number) => (Math.round((byte - head.audio0) / head.frameBytes) * head.samples) / head.sampleRate;

/** Ausschnitt start bis end holen. head kann aus einem früheren Moment derselben Datei kommen. */
export async function sliceMp3(fetchRange: RangeFetch, head: Mp3Head, start: number, end: number): Promise<Mp3Slice> {
  const bps = (head.bitrate * 1000) / 8;
  const from = Math.max(head.audio0, head.audio0 + Math.floor(Math.max(0, start - LEAD_S) * bps));
  const to = head.audio0 + Math.ceil((end + TAIL_S) * bps) + Math.ceil(head.frameBytes * 3);
  if (to <= from) throw new Mp3Error('short');
  if (to - from > MAX_SLICE_BYTES) throw new Mp3Error('too-big');
  const r = await fetchRange(from, to);
  const f = findFrame(r.bytes, 0);
  if (f < 0) throw new Mp3Error('no-sync');
  // Alle Frames bis zum Ende: gleiche Bitrate und Abtastrate, sonst ist es kein CBR an dieser Stelle
  let p = f;
  let n = 0;
  while (p + 4 <= r.bytes.length) {
    const h = parseHeader(r.bytes, p);
    if (!h) break;
    if (h.bitrate !== head.bitrate || h.sampleRate !== head.sampleRate || h.version !== head.version) throw new Mp3Error('mixed');
    if (p + h.len > r.bytes.length) break;
    p += h.len;
    n++;
  }
  // Ein Rest hinter den Frames ist nur erlaubt, wenn er am Dateiende liegt (ID3v1) oder ein abgeschnittener letzter Frame ist
  const rest = r.bytes.length - p;
  const atEnd = r.bytes.length < to - from + 1;
  if (rest >= 4 && !atEnd && parseHeader(r.bytes, p) === null) throw new Mp3Error('mixed');
  const bytes = r.bytes.subarray(f, p);
  if (!n) throw new Mp3Error('short');
  const duration = (n * head.samples) / head.sampleRate;
  return { bytes, offset: timeOfFrameAt(head, from + f), duration };
}
