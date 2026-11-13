// Realistischer Nutzungsstand für die Größenmessung des Syncs (Zahlen aus dem Befund vom 13.11.: Pool rund 1400 Momente, einige Wochen Nutzung)
import type { AppState } from '../src/lib/state';
import { emptyState } from '../src/lib/state';
import type { Moment, MomentLogEntry } from '../src/moments/types';
import type { DiagEntry } from '../src/lib/diag';
import { stampChanges } from '../src/lib/sync/merge';

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const words = 'the model decision patient sleep training protein recovery heart rate zone threshold lactate morning light attention memory spacing recall evidence trial dose effect risk benefit habit cue reward energy stress cortisol fasting glucose'.split(' ');
const text = (n: number) => {
  let s = '';
  while (s.length < n) s += (s ? ' ' : '') + pick(words);
  return s.slice(0, n);
};

export const NOW = Date.parse('2026-11-13T09:00:00Z');
export const DAY_MS = 86_400_000;
export const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);

export function makeMoment(i: number): Moment {
  const form = i % 3 === 0 ? 'audio' : i % 3 === 1 ? 'video' : 'text';
  const m: Moment = {
    id: `${(i * 2654435761 >>> 0).toString(36).slice(0, 8)}:${(i * 37) % 3000}`,
    videoId: form === 'audio' ? `pod-${i.toString(36).padStart(8, '0')}` : form === 'text' ? `txt-${i.toString(36).padStart(8, '0')}` : (i * 7919).toString(36).padStart(11, 'x').slice(0, 11),
    start: (i * 13) % 3000,
    end: ((i * 13) % 3000) + 45,
    channel: `Channel ${i % 40}`,
    videoTitle: text(70),
    area: (['brain', 'body', 'beat'] as const)[i % 3],
    topic: `topic${i % 60}`,
    hook: text(130),
    forYou: text(180),
    context: text(280),
    kind: 'regel',
    recall: { question: text(150), options: [text(60), text(60), text(60)], correct: 1, why: text(240) },
    form,
    createdAt: '2026-10-20T08:00:00.000Z',
    subtopic: ['a/b', 'c/d'],
    lang: 'en',
    publishedAt: '2026-10-19T08:00:00.000Z',
  };
  if (form === 'text') m.excerpt = text(700);
  else {
    m.cues = Array.from({ length: 22 }, (_, k) => [k * 2, text(70)] as [number, string]);
    m.thumb = `https://i.ytimg.com/vi/${m.videoId}/hqdefault.jpg`;
    m.url = `https://www.youtube.com/watch?v=${m.videoId}&t=${m.start}`;
  }
  return m;
}

export interface Scale {
  pool: number;
  saved: number;
  seen: number;
  log: number;
  days: number;
}
export const DEFAULT_SCALE: Scale = { pool: 1400, saved: 90, seen: 1000, log: 2400, days: 40 };

/** Zustand nach einigen Wochen Nutzung, Typen wie in state.ts, Zeitstempel wie sie stampChanges setzen */
export function makeState(sc: Scale = DEFAULT_SCALE): AppState {
  seed = 42;
  const pool = Array.from({ length: sc.pool }, (_, i) => makeMoment(i));
  let s = emptyState();
  const t0 = NOW - sc.days * DAY_MS;
  const seen: Record<string, number> = {};
  for (let i = 0; i < sc.seen; i++) seen[pool[i].id] = t0 + Math.floor(rnd() * sc.days * DAY_MS);
  const log: MomentLogEntry[] = [];
  for (let i = 0; i < sc.log; i++) log.push({ id: pool[i % sc.pool].id, day: dayStr(t0 + Math.floor(rnd() * sc.days * DAY_MS)), ended: rnd() > 0.5, watched: Math.floor(rnd() * 60), ...(rnd() > 0.9 ? { feedback: 'mehr' as const } : {}) });
  const saved: AppState['savedMoments'] = {};
  for (let i = 0; i < sc.saved; i++) saved[pool[i * 3].id] = { moment: pool[i * 3], savedAt: new Date(t0 + i * 3_600_000).toISOString() };
  const w = (n: number, mk: (i: number) => string) => Object.fromEntries(Array.from({ length: n }, (_, i) => [mk(i), 0.5 + rnd()]));
  const until = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`e:${pool[i].videoId}`, { at: NOW + i * 1000, back: 1 }]));
  const diag: DiagEntry[] = Array.from({ length: 500 }, (_, i) => ({ t: NOW - (500 - i) * 60_000, d: 'ab12', l: text(80 + Math.floor(rnd() * 80)) }));
  const dayCount = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [dayStr(NOW - i * DAY_MS), { seen: 20 + (i % 9), gotIt: 3 }]));
  const recall = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [pool[i].id, { id: pool[i].id, due: NOW + i * 1000, results: [{ at: t0 + i * 1000, got: true }, { at: t0 + i * 2000, got: false }] }]));
  const hour = () => ({ seen: 3, done: 2, saves: 0, skips: 1 });
  const days: Record<string, { byHour: Record<string, Record<string, Record<string, ReturnType<typeof hour>>>>; mixClump: { pairs: number; episode: number; channel: number; area: number } }> = {};
  for (let d = 0; d < sc.days; d++) {
    const byHour: Record<string, Record<string, Record<string, ReturnType<typeof hour>>>> = {};
    for (const h of ['06', '07', '12', '18', '21', '22']) byHour[h] = { brain: { video: hour(), audio: hour() }, body: { audio: hour() } };
    days[dayStr(NOW - d * DAY_MS)] = { byHour, mixClump: { pairs: 10, episode: 1, channel: 2, area: 3 } };
  }
  const missed = Array.from({ length: 20 }, (_, i) => ({ id: pool[i].id, question: text(150), correct: text(60), why: text(240), source: pool[i].url, videoTitle: text(70), at: NOW - i * 1000 }));
  const notes = Array.from({ length: 12 }, (_, i) => ({ key: `${pool[i].id}@${NOW + i}`, id: pool[i].id, hook: text(130), chips: [], text: text(120), tab: 'audio', commit: 'abc1234', at: NOW + i }));
  s = {
    ...s,
    momentSeen: seen,
    momentLog: log,
    savedMoments: saved,
    dayCount,
    recall,
    diag,
    feedbackNotes: notes as AppState['feedbackNotes'],
    momentWeights: { area: { brain: 1, body: 1, beat: 1 }, channel: w(40, (i) => `Channel ${i}`), topic: w(60, (i) => `topic${i}`), episode: w(300, (i) => pool[i].videoId), subtopic: w(80, (i) => `a/b${i}`), until },
    momentLiked: Object.fromEntries(pool.slice(0, 150).map((m) => [m.id, NOW])),
    momentAsked: Object.fromEntries(pool.slice(0, 25).map((m) => [m.id, NOW])),
    momentRejected: Object.fromEntries(pool.slice(200, 290).map((m) => [m.id, NOW])),
    momentUnseen: Object.fromEntries(pool.slice(300, 320).map((m) => [m.id, NOW])),
    momentSwipes: Object.fromEntries(pool.slice(400, 650).map((m) => [m.id, { n: 2, at: NOW, until: NOW + 30 * DAY_MS }])),
    mutedChannels: { 'Channel 3': 'x' } as Record<string, string>,
    feedTime: Object.fromEntries(Array.from({ length: sc.days }, (_, i) => [dayStr(NOW - i * DAY_MS), 900_000])),
    weekReviewShown: { '2026-11-09': true },
    plans: { '2026-11-09': { when: 'Monday morning', will: text(100) } },
    digestTaps: {},
    signals: { days, missed } as AppState['signals'],
    recallQueue: [],
  };
  // Zeitstempel wie im Betrieb: jeder geänderte Schlüssel hat einen
  return stampChanges(emptyState(), s, NOW);
}
