import { describe, expect, it } from 'vitest';
import { adjustChannel, buildQueue, newCursor, type MixPrefs } from '../src/video/mix';
import type { Area } from '../src/types';
import type { Video } from '../src/videoTypes';

const now = Date.parse('2026-10-23T08:00:00Z');
let n = 0;
function vids(area: Area, topic: string, channels: number, per: number): Video[] {
  const out: Video[] = [];
  for (let c = 0; c < channels; c++)
    for (let i = 0; i < per; i++) {
      n++;
      out.push({ id: `v${n}`, channelId: `${area}-${topic}-${c}`, channelName: `K${c}`, area, topic, lang: 'en', title: `Video ${n}`, published: '2026-09-01T00:00:00Z', thumb: '' });
    }
  return out;
}
const pool = [
  ...vids('brain', 'augen', 4, 30), ...vids('brain', 'ki', 5, 30), ...vids('brain', 'business', 5, 30), ...vids('brain', 'varia', 4, 30),
  ...vids('body', 'kraft', 4, 30), ...vids('body', 'recovery', 2, 30),
  ...vids('beat', 'islam', 5, 30),
];
const prefs = (over: Partial<MixPrefs> = {}): MixPrefs => ({ areaShares: { brain: 0.55, body: 0.25, beat: 0.2 }, channelWeights: {}, mutedChannels: {}, videoSeen: {}, ...over });

describe('Video-Mix', () => {
  const blocks = buildQueue(pool, prefs(), newCursor(true), now, 100);
  const flat = blocks.flatMap((b) => b.videos);

  it('Blöcke à 3 Videos gleichen Bereichs', () => {
    expect(blocks).toHaveLength(100);
    for (const b of blocks) {
      expect(b.videos).toHaveLength(3);
      expect(new Set(b.videos.map((v) => v.area)).size).toBe(1);
      expect(b.videos.every((v) => v.area === b.area)).toBe(true);
    }
  });

  it('Anteile über 300 Videos innerhalb ±5 %', () => {
    expect(flat).toHaveLength(300);
    const share = (a: Area) => flat.filter((v) => v.area === a).length / flat.length;
    expect(Math.abs(share('brain') - 0.55)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(share('body') - 0.25)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(share('beat') - 0.2)).toBeLessThanOrEqual(0.05);
  });

  it('Beat zuerst am Tag, sonst nicht zwingend', () => {
    expect(blocks[0].area).toBe('beat');
    expect(buildQueue(pool, prefs(), newCursor(false), now, 1)[0].area).toBe('brain');
  });

  it('Brain rotiert durch augen, ki, business, varia', () => {
    const topics = blocks.filter((b) => b.area === 'brain').slice(0, 4).map((b) => b.topic);
    expect(topics).toEqual(['augen', 'ki', 'business', 'varia']);
  });

  it('kein Video doppelt, gesehene nie', () => {
    expect(new Set(flat.map((v) => v.id)).size).toBe(flat.length);
    const seen = Object.fromEntries(flat.slice(0, 150).map((v) => [v.id, 1]));
    const again = buildQueue(pool, prefs({ videoSeen: seen }), newCursor(false), now, 200).flatMap((b) => b.videos);
    expect(again.some((v) => seen[v.id])).toBe(false);
    expect(new Set(again.map((v) => v.id)).size).toBe(again.length);
  });

  it('stummgeschalteter Kanal erscheint nie', () => {
    const muted = { 'beat-islam-0': 'K0', 'brain-ki-1': 'K1' };
    const all = buildQueue(pool, prefs({ mutedChannels: muted }), newCursor(true), now, 400).flatMap((b) => b.videos);
    expect(all.length).toBeGreaterThan(300);
    expect(all.some((v) => muted[v.channelId as keyof typeof muted])).toBe(false);
  });

  it('Kanalgewichte bleiben zwischen 0.2 und 3.0', () => {
    let w: Record<string, number> = {};
    for (let i = 0; i < 40; i++) w = adjustChannel(w, 'x', 1.3);
    expect(w.x).toBe(3);
    for (let i = 0; i < 80; i++) w = adjustChannel(w, 'x', 0.7);
    expect(w.x).toBe(0.2);
  });

  it('höheres Kanalgewicht kommt zuerst dran', () => {
    const b = buildQueue(pool, prefs({ channelWeights: { 'beat-islam-3': 3 } }), newCursor(true), now, 1)[0];
    expect(b.videos[0].channelId).toBe('beat-islam-3');
  });
});
