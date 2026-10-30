import { describe, expect, it } from 'vitest';
import { findFrame, id3v2Size, Mp3Error, parseHeader, readHead, sliceMp3, type RangeFetch } from '../src/moments/mp3range';
import { frameIndexAt, frameLen, synthMp3 } from './mp3-synth';

const source = (bytes: Uint8Array) => {
  const calls: [number, number][] = [];
  let got = 0;
  const fetchRange: RangeFetch = async (from, to) => {
    calls.push([from, to]);
    const slice = bytes.subarray(from, Math.min(bytes.length, to + 1));
    got += slice.length;
    return { bytes: slice.slice() };
  };
  return { fetchRange, calls, get got() { return got; } };
};

const FRAME_S = 1152 / 44100;

describe('mp3 Ausschnitt per Range', () => {
  it('liest Header und Frame-Länge nach der Formel', () => {
    const { bytes } = synthMp3({ frames: 10 });
    const h = parseHeader(bytes, 0)!;
    expect(h).toMatchObject({ bitrate: 128, sampleRate: 44100, version: 3, samples: 1152 });
    expect(h.len).toBe(frameLen(3, 128, 44100, 0));
    expect(id3v2Size(synthMp3({ frames: 3, id3: 700 }).bytes)).toBe(700);
  });

  it('findet den ersten Frame auch nach Müll vor der Kette', () => {
    const { bytes } = synthMp3({ frames: 20 });
    const junk = new Uint8Array(100 + bytes.length);
    junk.fill(0x11, 0, 100);
    junk.set([0xff, 0xfb, 0x00], 50); // falscher Sync
    junk.set(bytes, 100);
    expect(findFrame(junk, 0)).toBe(100);
  });

  it('CBR ohne Tag: Ausschnitt trifft die Zeit auf einen Frame genau und lädt nur Bruchteile', async () => {
    const f = synthMp3({ frames: 40_000, id3: 500 }); // etwa 17 Minuten
    const src = source(f.bytes);
    const head = await readHead(src.fetchRange);
    expect(head.audio0).toBe(500);
    const s = await sliceMp3(src.fetchRange, head, 600, 647);
    // erster Frame im Ausschnitt gehört zur Tonzeit offset
    const first = Math.round((s.offset * 44100) / 1152);
    expect(first * FRAME_S).toBeCloseTo(s.offset, 6);
    expect(frameIndexAt(s.bytes, 0, parseHeader(s.bytes, 0)!.len)).toBe(first);
    expect(600 - s.offset).toBeGreaterThanOrEqual(0.1);
    expect(600 - s.offset).toBeLessThan(0.25);
    // reicht über end hinaus
    expect(s.offset + s.duration).toBeGreaterThan(647 + 0.9);
    expect(s.offset + s.duration).toBeLessThan(647 + 1.5);
    // 47 s bei 16 kB/s plus Kopf, nicht die 17 Minuten
    expect(src.got).toBeLessThan(16384 + 47 * 16000 * 1.15);
    expect(src.calls).toHaveLength(2);
  });

  it('Info-Tag (CBR): Zeit 0 beginnt hinter dem Info-Frame', async () => {
    const f = synthMp3({ frames: 5000, id3: 183, tag: 'info', bitrate: 96, sampleRate: 48000 });
    const src = source(f.bytes);
    const head = await readHead(src.fetchRange);
    expect(head.audio0).toBe(f.audio0);
    const s = await sliceMp3(src.fetchRange, head, 30, 70);
    const len = parseHeader(s.bytes, 0)!.len;
    const idx = frameIndexAt(s.bytes, 0, len);
    expect((idx * 1152) / 48000).toBeCloseTo(s.offset, 6);
  });

  it('Xing und VBRI gelten als variable Bitrate und werden nicht geschnitten', async () => {
    const f = synthMp3({ frames: 300, tag: 'xing' });
    await expect(readHead(source(f.bytes).fetchRange)).rejects.toMatchObject({ reason: 'vbr' });
  });

  it('wechselnde Bitrate im Ausschnitt wird erkannt', async () => {
    const f = synthMp3({ frames: 20_000, switchAt: { frame: 9000, bitrate: 64 } });
    const src = source(f.bytes);
    const head = await readHead(src.fetchRange);
    await expect(sliceMp3(src.fetchRange, head, 220, 260)).rejects.toBeInstanceOf(Mp3Error);
  });

  it('großes ID3 (Cover) hinter den ersten 16 kB', async () => {
    const f = synthMp3({ frames: 4000, id3: 200_000 });
    const src = source(f.bytes);
    const head = await readHead(src.fetchRange);
    expect(head.audio0).toBe(200_000);
    const s = await sliceMp3(src.fetchRange, head, 20, 50);
    expect(s.offset).toBeGreaterThan(19.7);
    expect(src.got).toBeLessThan(16384 * 2 + 31 * 16000 * 1.2);
  });

  it('MPEG 2 (22,05 kHz) rechnet mit 576 Samples pro Frame', async () => {
    const f = synthMp3({ frames: 6000, version: 2, bitrate: 32, sampleRate: 22050 });
    const src = source(f.bytes);
    const head = await readHead(src.fetchRange);
    expect(head.samples).toBe(576);
    const s = await sliceMp3(src.fetchRange, head, 40, 80);
    expect(40 - s.offset).toBeGreaterThanOrEqual(0.1);
    expect(40 - s.offset).toBeLessThan(0.25);
    expect(s.duration).toBeGreaterThan(40.9);
  });

  it('Ausschnitt am Dateiende wird begrenzt, ID3v1 am Ende stört nicht', async () => {
    const f = synthMp3({ frames: 3000, id3v1: true });
    const src = source(f.bytes);
    const head = await readHead(src.fetchRange);
    const endS = (3000 * 1152) / 44100;
    const s = await sliceMp3(src.fetchRange, head, endS - 20, endS - 1);
    expect(s.offset + s.duration).toBeCloseTo(endS, 1);
  });

  it('ein zweiter Moment derselben Datei braucht den Kopf nicht noch einmal', async () => {
    const f = synthMp3({ frames: 40_000 });
    const src = source(f.bytes);
    const head = await readHead(src.fetchRange);
    await sliceMp3(src.fetchRange, head, 100, 140);
    const n = src.calls.length;
    await sliceMp3(src.fetchRange, head, 900, 940);
    expect(src.calls.length).toBe(n + 1);
  });

  it('keine Frames: no-sync', async () => {
    const src = source(new Uint8Array(40_000).fill(7));
    await expect(readHead(src.fetchRange)).rejects.toMatchObject({ reason: 'no-sync' });
  });
});
