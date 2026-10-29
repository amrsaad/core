import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { applyDoc, canon, emptyDoc, LOG_MAX, mergeDocs, stampChanges, syncedChanged, toDoc, tsKey, type SyncDoc, type SyncState } from '../src/lib/sync/merge';
import { emptyState, type AppState, type SavedMoment } from '../src/lib/state';
import type { Moment } from '../src/moments/types';
import { DAY } from './sync-helpers';

// Gleiche Prüfdaten in ios/CoreTests/SyncTests.swift (tests/fixtures/sync-vectors.json und sync-random.json)

const mo = (id: string): Moment => ({ id, videoId: `vid${id}`, start: 10, end: 70, channel: 'Kanal A', videoTitle: 'T', area: 'brain', topic: 'augen', hook: `Hook ${id}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z' });
const sv = (id: string, savedAt = '2026-10-25T10:00:00.000Z', done?: boolean): SavedMoment => ({ moment: mo(id), savedAt, ...(done ? { done } : {}) });

/** Dokument aus einem Teil des Zustands, der Rest leer */
const doc = (state: Partial<SyncState> = {}, ts: Record<string, number> = {}): SyncDoc => {
  const d = emptyDoc();
  return { ...d, state: { ...d.state, ...state }, ts };
};
const same = (x: SyncDoc, y: SyncDoc) => expect(canon(x)).toBe(canon(y));

interface Case {
  name: string;
  a: SyncDoc;
  b: SyncDoc;
  expected: SyncDoc;
}

const W = (topic: Record<string, number> = {}, channel: Record<string, number> = {}, area: Record<string, number> = {}) => ({ area, channel, topic });
const log = (id: string, day: string, ended: boolean, watched: number, feedback?: 'mehr' | 'kenne' | 'schwach' | 'falsch') => ({ id, day, ended, watched, ...(feedback ? { feedback } : {}) });
const note = (key: string, at: number, extra: object = {}) => ({ key, id: key.split('#')[0], hook: 'H', chips: [] as never[], text: 'T', tab: 'Video', commit: 'abc', at, ...extra });

const manyDays = (from: number, n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`2026-${String(Math.floor((from + i) / 28) + 1).padStart(2, '0')}-${String(((from + i) % 28) + 1).padStart(2, '0')}`, { seen: i + 1, gotIt: 0 }]));

const WU = (topic: Record<string, number>, channel: Record<string, number>, until: Record<string, { at: number; back: number }>) => ({ area: {}, channel, topic, until });

const CASES: Case[] = [
  {
    name: 'gesehen: Vereinigung, frühester Zeitpunkt',
    a: doc({ momentSeen: { m1: 100, m2: 200 } }),
    b: doc({ momentSeen: { m2: 150, m3: 300 } }),
    expected: doc({ momentSeen: { m1: 100, m2: 150, m3: 300 } }),
  },
  {
    name: 'Protokoll: je Moment und Tag, Ende und Weitergeschautes bleiben, sortiert',
    a: doc({ momentLog: [log('m2', '2026-10-24', true, 30, 'mehr'), log('m1', '2026-10-24', false, 5)] }),
    b: doc({ momentLog: [log('m1', '2026-10-24', true, 20, 'kenne'), log('m3', '2026-10-23', false, 3)] }),
    expected: doc({ momentLog: [log('m3', '2026-10-23', false, 3), log('m1', '2026-10-24', true, 20, 'kenne'), log('m2', '2026-10-24', true, 30, 'mehr')] }),
  },
  {
    name: 'gemerkt: beide Seiten bringen etwas mit',
    a: doc({ savedMoments: { s1: sv('s1') } }, { [tsKey.saved('s1')]: 100 }),
    b: doc({ savedMoments: { s2: sv('s2') } }, { [tsKey.saved('s2')]: 200 }),
    expected: doc({ savedMoments: { s1: sv('s1'), s2: sv('s2') } }, { [tsKey.saved('s1')]: 100, [tsKey.saved('s2')]: 200 }),
  },
  {
    name: 'gemerkt: wegnehmen auf dem anderen Gerät ist neuer, der Eintrag bleibt weg',
    a: doc({ savedMoments: { s1: sv('s1') } }, { [tsKey.saved('s1')]: 100 }),
    b: doc({}, { [tsKey.saved('s1')]: 200 }),
    expected: doc({}, { [tsKey.saved('s1')]: 200 }),
  },
  {
    name: 'gemerkt: erneut gemerkt ist neuer als das Wegnehmen',
    a: doc({ savedMoments: { s1: sv('s1', '2026-10-27T09:00:00.000Z') } }, { [tsKey.saved('s1')]: 300 }),
    b: doc({}, { [tsKey.saved('s1')]: 200 }),
    expected: doc({ savedMoments: { s1: sv('s1', '2026-10-27T09:00:00.000Z') } }, { [tsKey.saved('s1')]: 300 }),
  },
  {
    name: 'gemerkt: alter Stand ohne Zeitstempel, was da ist, bleibt',
    a: doc({ savedMoments: { s1: sv('s1') } }),
    b: doc({}),
    expected: doc({ savedMoments: { s1: sv('s1') } }),
  },
  {
    name: 'gemerkt: gleicher Zeitstempel, umgesetzt zählt, frühestes Datum',
    a: doc({ savedMoments: { s1: sv('s1', '2026-10-25T10:00:00.000Z', true) } }, { [tsKey.saved('s1')]: 100 }),
    b: doc({ savedMoments: { s1: sv('s1', '2026-10-24T08:00:00.000Z') } }, { [tsKey.saved('s1')]: 100 }),
    expected: doc({ savedMoments: { s1: sv('s1', '2026-10-24T08:00:00.000Z', true) } }, { [tsKey.saved('s1')]: 100 }),
  },
  {
    name: 'Gewichte: je Schlüssel der jüngste Zeitstempel',
    a: doc({ momentWeights: W({ augen: 0.7 }, { c1: 0.9 }) }, { [tsKey.weight('topic', 'augen')]: 100, [tsKey.weight('channel', 'c1')]: 300 }),
    b: doc({ momentWeights: W({ augen: 1.3, kraft: 1.1 }, {}, { brain: 1.2 }) }, { [tsKey.weight('topic', 'augen')]: 200, [tsKey.weight('topic', 'kraft')]: 50, [tsKey.weight('area', 'brain')]: 60 }),
    expected: doc({ momentWeights: W({ augen: 1.3, kraft: 1.1 }, { c1: 0.9 }, { brain: 1.2 }) }, { [tsKey.weight('topic', 'augen')]: 200, [tsKey.weight('topic', 'kraft')]: 50, [tsKey.weight('area', 'brain')]: 60, [tsKey.weight('channel', 'c1')]: 300 }),
  },
  {
    name: 'Gewichte: Zurücksetzen ist neuer als der alte Wert',
    a: doc({ momentWeights: W({ augen: 0.7 }) }, { [tsKey.weight('topic', 'augen')]: 100 }),
    b: doc({}, { [tsKey.weight('topic', 'augen')]: 200 }),
    expected: doc({}, { [tsKey.weight('topic', 'augen')]: 200 }),
  },
  {
    name: 'Gewichte: ohne Zeitstempel gewinnt das weiter vom Standard entfernte',
    a: doc({ momentWeights: W({ x: 1.1, y: 0.5 }) }),
    b: doc({ momentWeights: W({ x: 0.6, y: 2 }) }),
    expected: doc({ momentWeights: W({ x: 0.6, y: 0.5 }) }),
  },
  {
    name: 'Abläufe: der Ablauf folgt dem Zeitstempel seines Gewichts, der jüngere gewinnt',
    a: doc({ momentWeights: WU({ augen: 0.2 }, {}, { 't:augen': { at: 5000, back: 1 } }) }, { [tsKey.weight('topic', 'augen')]: 100 }),
    b: doc({ momentWeights: WU({ augen: 0.2 }, {}, { 't:augen': { at: 9000, back: 0.8 } }) }, { [tsKey.weight('topic', 'augen')]: 200 }),
    expected: doc({ momentWeights: WU({ augen: 0.2 }, {}, { 't:augen': { at: 9000, back: 0.8 } }) }, { [tsKey.weight('topic', 'augen')]: 200 }),
  },
  {
    name: 'Abläufe: Zurücksetzen auf dem anderen Gerät ist neuer, Gewicht und Ablauf fallen weg',
    a: doc({ momentWeights: WU({ augen: 0.2 }, {}, { 't:augen': { at: 5000, back: 1 } }) }, { [tsKey.weight('topic', 'augen')]: 100 }),
    b: doc({}, { [tsKey.weight('topic', 'augen')]: 300 }),
    expected: doc({}, { [tsKey.weight('topic', 'augen')]: 300 }),
  },
  {
    name: 'Abläufe: ohne Zeitstempel gewinnt der spätere Termin, bei Gleichstand das größere Gewicht danach',
    a: doc({ momentWeights: WU({}, { c1: 0.2, c2: 0.2 }, { 'c:c1': { at: 5000, back: 0.6 }, 'c:c2': { at: 7000, back: 0.4 } }) }),
    b: doc({ momentWeights: WU({}, { c1: 0.2, c2: 0.2 }, { 'c:c1': { at: 6000, back: 0.5 }, 'c:c2': { at: 7000, back: 0.6 } }) }),
    expected: doc({ momentWeights: WU({}, { c1: 0.2, c2: 0.2 }, { 'c:c1': { at: 6000, back: 0.5 }, 'c:c2': { at: 7000, back: 0.6 } }) }),
  },
  {
    name: 'Abläufe: Kanal und Thema laufen getrennt, von beiden Seiten',
    a: doc({ momentWeights: WU({ augen: 0.2 }, {}, { 't:augen': { at: 5000, back: 1 } }) }, { [tsKey.weight('topic', 'augen')]: 100 }),
    b: doc({ momentWeights: WU({}, { c1: 0.2 }, { 'c:c1': { at: 8000, back: 0.6 } }) }, { [tsKey.weight('channel', 'c1')]: 150 }),
    expected: doc({ momentWeights: WU({ augen: 0.2 }, { c1: 0.2 }, { 't:augen': { at: 5000, back: 1 }, 'c:c1': { at: 8000, back: 0.6 } }) }, { [tsKey.weight('topic', 'augen')]: 100, [tsKey.weight('channel', 'c1')]: 150 }),
  },
  {
    name: 'Abruf: Ergebnisse vereinigt, Termin vom jüngsten Ergebnis',
    a: doc({ recall: { r1: { id: 'r1', due: 1000 + 2 * DAY, results: [{ at: 1000, got: false }] }, r2: { id: 'r2', due: null, results: [{ at: 5, got: true }] } } }),
    b: doc({ recall: { r1: { id: 'r1', due: 2000 + 7 * DAY, results: [{ at: 2000, got: true }] } } }),
    expected: doc({ recall: { r1: { id: 'r1', due: 2000 + 7 * DAY, results: [{ at: 1000, got: false }, { at: 2000, got: true }] }, r2: { id: 'r2', due: null, results: [{ at: 5, got: true }] } } }),
  },
  {
    name: 'Abruf: dasselbe Ergebnis auf beiden Geräten zählt einmal',
    a: doc({ recall: { r1: { id: 'r1', due: 9000, results: [{ at: 1000, got: true }] } } }),
    b: doc({ recall: { r1: { id: 'r1', due: 9000, results: [{ at: 1000, got: true }] } } }),
    expected: doc({ recall: { r1: { id: 'r1', due: 9000, results: [{ at: 1000, got: true }] } } }),
  },
  {
    name: 'Notizen: Vereinigung, gesendet bleibt',
    a: doc({ feedbackNotes: [note('n1#10', 10), note('n3#30', 30)] }),
    b: doc({ feedbackNotes: [note('n1#10', 10, { sent: 5000 }), note('n2#20', 20)] }),
    expected: doc({ feedbackNotes: [note('n1#10', 10, { sent: 5000 }), note('n2#20', 20), note('n3#30', 30)] }),
  },
  {
    name: 'Tageszahl und Zeit im Feed: je Tag das Größere',
    a: doc({ dayCount: { '2026-10-26': { seen: 4, gotIt: 1 } }, feedTime: { '2026-10-26': 60000 } }),
    b: doc({ dayCount: { '2026-10-26': { seen: 2, gotIt: 3 }, '2026-10-27': { seen: 1, gotIt: 0 } }, feedTime: { '2026-10-26': 90000, '2026-10-27': 1000 } }),
    expected: doc({ dayCount: { '2026-10-26': { seen: 4, gotIt: 3 }, '2026-10-27': { seen: 1, gotIt: 0 } }, feedTime: { '2026-10-26': 90000, '2026-10-27': 1000 } }),
  },
  {
    name: 'Tageszahl: nur die letzten 60 Tage',
    a: doc({ dayCount: manyDays(0, 40) }),
    b: doc({ dayCount: manyDays(30, 40) }),
    expected: doc({ dayCount: Object.fromEntries(Object.entries(manyDays(0, 70)).slice(10).map(([k, v], i) => [k, { ...v, seen: i + 10 < 40 ? i + 11 : i + 10 - 29 }])) }),
  },
  {
    name: 'Einstellungen: je Schlüssel der jüngste Zeitstempel, Gleichstand das Größere',
    a: doc({ settings: { playbackSpeed: 1, form: 'audio', captionMode: 'on' } }, { [tsKey.setting('playbackSpeed')]: 100, [tsKey.setting('form')]: 400, [tsKey.setting('captionMode')]: 50 }),
    b: doc({ settings: { playbackSpeed: 1.5, form: 'text', captionMode: 'off' } }, { [tsKey.setting('playbackSpeed')]: 200, [tsKey.setting('form')]: 300, [tsKey.setting('captionMode')]: 50 }),
    expected: doc({ settings: { playbackSpeed: 1.5, form: 'audio', captionMode: 'on' } }, { [tsKey.setting('playbackSpeed')]: 200, [tsKey.setting('form')]: 400, [tsKey.setting('captionMode')]: 50 }),
  },
  {
    name: 'Einstellungen: Mix gehört zusammen, der jüngere gewinnt',
    a: doc({ settings: { areaShares: { brain: 0.5, body: 0.25, beat: 0.25 } } }, { [tsKey.setting('areaShares')]: 500 }),
    b: doc({ settings: { areaShares: { brain: 0.2, body: 0.4, beat: 0.4 } } }, { [tsKey.setting('areaShares')]: 400 }),
    expected: doc({ settings: { areaShares: { brain: 0.5, body: 0.25, beat: 0.25 } } }, { [tsKey.setting('areaShares')]: 500 }),
  },
  {
    name: 'Stumme Sprecher: Wieder-anzeigen auf dem anderen Gerät gilt, wenn es neuer ist',
    a: doc({ mutedChannels: { 'Kanal A': 'Kanal A' } }, { [tsKey.muted('Kanal A')]: 100 }),
    b: doc({}, { [tsKey.muted('Kanal A')]: 200 }),
    expected: doc({}, { [tsKey.muted('Kanal A')]: 200 }),
  },
  {
    name: 'Herz: zurückgenommen ist neuer',
    a: doc({ momentLiked: { m1: 111, m2: 222 } }, { [tsKey.liked('m1')]: 300, [tsKey.liked('m2')]: 100 }),
    b: doc({ momentLiked: { m2: 222 } }, { [tsKey.liked('m1')]: 100, [tsKey.liked('m2')]: 200 }),
    expected: doc({ momentLiked: { m1: 111, m2: 222 } }, { [tsKey.liked('m1')]: 300, [tsKey.liked('m2')]: 200 }),
  },
  {
    name: 'Plan: der jüngere Plan gilt als Ganzes',
    a: doc({ plans: { '2026-10-19': { when: 'When I wake up', will: 'I will stretch' } } }, { [tsKey.plan('2026-10-19')]: 100 }),
    b: doc({ plans: { '2026-10-19': { when: 'When I wake up', will: 'I will stretch', happened: true } } }, { [tsKey.plan('2026-10-19')]: 200 }),
    expected: doc({ plans: { '2026-10-19': { when: 'When I wake up', will: 'I will stretch', happened: true } } }, { [tsKey.plan('2026-10-19')]: 200 }),
  },
  {
    name: 'Digest-Taps: je Schlüssel der jüngste Zeitstempel, beide Seiten bringen etwas mit',
    a: doc({ digestTaps: { 'a:m1': { choice: 'done', at: 100 }, 'c:m3': { choice: 'a', at: 300 } } }, { [tsKey.digest('a:m1')]: 100, [tsKey.digest('c:m3')]: 300 }),
    b: doc({ digestTaps: { 'a:m1': { choice: 'drop', at: 200 }, 'a:m2': { choice: 'done', at: 50 } } }, { [tsKey.digest('a:m1')]: 200, [tsKey.digest('a:m2')]: 50 }),
    expected: doc({ digestTaps: { 'a:m1': { choice: 'drop', at: 200 }, 'a:m2': { choice: 'done', at: 50 }, 'c:m3': { choice: 'a', at: 300 } } }, { [tsKey.digest('a:m1')]: 200, [tsKey.digest('a:m2')]: 50, [tsKey.digest('c:m3')]: 300 }),
  },
  {
    name: 'Digest-Taps: gleicher Zeitstempel, der spätere Tap, dann die größere Wahl',
    a: doc({ digestTaps: { 'a:m1': { choice: 'done', at: 500 }, 'c:m3': { choice: 'a', at: 700 } } }, { [tsKey.digest('a:m1')]: 100, [tsKey.digest('c:m3')]: 100 }),
    b: doc({ digestTaps: { 'a:m1': { choice: 'drop', at: 400 }, 'c:m3': { choice: 'b', at: 700 } } }, { [tsKey.digest('a:m1')]: 100, [tsKey.digest('c:m3')]: 100 }),
    expected: doc({ digestTaps: { 'a:m1': { choice: 'done', at: 500 }, 'c:m3': { choice: 'b', at: 700 } } }, { [tsKey.digest('a:m1')]: 100, [tsKey.digest('c:m3')]: 100 }),
  },
  {
    name: 'Digest-Taps: alter Stand ohne Zeitstempel, was da ist, bleibt',
    a: doc({ digestTaps: { 'a:m1': { choice: 'done', at: 100 } } }),
    b: doc({}),
    expected: doc({ digestTaps: { 'a:m1': { choice: 'done', at: 100 } } }),
  },
  {
    name: 'Tage und Wochen: späterer Tag, Rückblick einmal gezeigt',
    a: doc({ notesPromptDay: '2026-10-26', momentDay: '2026-10-27', weekReviewShown: { '2026-10-19': true } }),
    b: doc({ notesPromptDay: '2026-10-27', momentDay: '2026-10-26', weekReviewShown: { '2026-10-12': true } }),
    expected: doc({ notesPromptDay: '2026-10-27', momentDay: '2026-10-27', weekReviewShown: { '2026-10-12': true, '2026-10-19': true } }),
  },
  {
    name: 'zwei Geräte offline: beides bleibt, nichts geht verloren',
    a: doc(
      { momentSeen: { m1: 10, m2: 20 }, savedMoments: { m1: sv('m1') }, momentLiked: { m2: 20 }, momentWeights: W({ augen: 1.3 }), dayCount: { '2026-10-28': { seen: 2, gotIt: 0 } } },
      { [tsKey.saved('m1')]: 1000, [tsKey.liked('m2')]: 2000, [tsKey.weight('topic', 'augen')]: 2000 },
    ),
    b: doc(
      { momentSeen: { m3: 30 }, savedMoments: { m3: sv('m3') }, momentWeights: W({ kraft: 0.7 }), dayCount: { '2026-10-28': { seen: 1, gotIt: 1 } } },
      { [tsKey.saved('m3')]: 1500, [tsKey.weight('topic', 'kraft')]: 1500 },
    ),
    expected: doc(
      { momentSeen: { m1: 10, m2: 20, m3: 30 }, savedMoments: { m1: sv('m1'), m3: sv('m3') }, momentLiked: { m2: 20 }, momentWeights: W({ augen: 1.3, kraft: 0.7 }), dayCount: { '2026-10-28': { seen: 2, gotIt: 1 } } },
      { [tsKey.saved('m1')]: 1000, [tsKey.saved('m3')]: 1500, [tsKey.liked('m2')]: 2000, [tsKey.weight('topic', 'augen')]: 2000, [tsKey.weight('topic', 'kraft')]: 1500 },
    ),
  },
];

// ---------- Zufallsdokumente ----------

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function randomDoc(r: () => number): SyncDoc {
  const pickOf = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const some = <T,>(xs: T[], p = 0.5) => xs.filter(() => r() < p);
  const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  const chans = ['Kanal A', 'Kanal B', 'Kanal C'];
  const topics = ['augen', 'kraft', 'islam'];
  const days = ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'];
  const weeks = ['2026-10-12', '2026-10-19'];
  const t = () => (r() < 0.25 ? undefined : 100 + Math.floor(r() * 5) * 100);
  const d = emptyDoc();
  const ts: Record<string, number> = {};
  const stamp = (k: string) => {
    const v = t();
    if (v !== undefined) ts[k] = v;
  };
  const s = d.state;
  for (const id of some(ids)) s.momentSeen[id] = 1000 + Math.floor(r() * 9) * 100;
  for (const id of some(ids, 0.4)) s.momentLog.push({ id, day: pickOf(days), ended: r() < 0.5, watched: Math.floor(r() * 90), ...(r() < 0.3 ? { feedback: pickOf(['mehr', 'kenne', 'schwach', 'falsch'] as const) } : {}) });
  s.momentLog = mergeDocs({ ...d, state: { ...s } }, emptyDoc()).state.momentLog;
  for (const day of some(days)) s.dayCount[day] = { seen: Math.floor(r() * 9), gotIt: Math.floor(r() * 5) };
  for (const id of some(ids, 0.4)) {
    s.savedMoments[id] = { moment: mo(id), savedAt: `2026-10-2${Math.floor(r() * 8)}T10:00:00.000Z`, ...(r() < 0.3 ? { done: true } : {}) };
    stamp(tsKey.saved(id));
  }
  for (const id of ids) if (!(id in s.savedMoments)) stamp(tsKey.saved(id));
  for (const [fam, keys] of [['topic', topics], ['channel', chans], ['area', ['brain', 'body', 'beat']]] as const) {
    for (const k of keys) {
      if (r() < 0.5) {
        s.momentWeights[fam][k] = Number((0.3 + Math.floor(r() * 27) / 10).toFixed(4));
        stamp(tsKey.weight(fam, k));
      } else if (r() < 0.3) stamp(tsKey.weight(fam, k));
    }
  }
  // Abläufe am Ende, damit frühere Zufallsfolgen unverändert bleiben
  for (const [fam, keys] of [['topic', topics], ['channel', chans]] as const) {
    for (const k of keys) {
      if (k in s.momentWeights[fam] && r() < 0.4) {
        s.momentWeights.until = { ...s.momentWeights.until, [`${fam === 'channel' ? 'c' : 't'}:${k}`]: { at: 1000 + Math.floor(r() * 5) * 1000, back: Number((0.4 + Math.floor(r() * 7) / 10).toFixed(4)) } };
      }
    }
  }
  for (const id of some(ids, 0.4)) {
    const n = 1 + Math.floor(r() * 3);
    const results = Array.from({ length: n }, (_, i) => ({ at: 1000 + (Math.floor(r() * 4) + i) * 100, got: r() < 0.5 }));
    results.sort((p, q) => p.at - q.at || Number(p.got) - Number(q.got));
    s.recall[id] = { id, due: r() < 0.2 ? null : 5000 + Math.floor(r() * 5) * 100, results: results.filter((x, i) => results.findIndex((y) => y.at === x.at && y.got === x.got) === i) };
  }
  for (const id of some(ids, 0.4)) {
    const at = 10 + Math.floor(r() * 3);
    s.feedbackNotes.push(note(`${id}#${at}`, at, r() < 0.4 ? { sent: 9000 + Math.floor(r() * 3) } : {}));
  }
  s.feedbackNotes = mergeDocs({ ...d, state: { ...s } }, emptyDoc()).state.feedbackNotes;
  for (const id of some(ids, 0.3)) {
    s.momentLiked[id] = 500 + Math.floor(r() * 4) * 10;
    stamp(tsKey.liked(id));
  }
  for (const c of some(chans, 0.3)) {
    s.mutedChannels[c] = c;
    stamp(tsKey.muted(c));
  }
  for (const day of some(days, 0.5)) s.feedTime[day] = Math.floor(r() * 30) * 1000;
  for (const w of some(weeks, 0.5)) s.weekReviewShown[w] = true;
  for (const w of some(weeks, 0.4)) {
    s.plans[w] = { when: pickOf(['When I wake up', 'When I sit down']), will: pickOf(['I will stretch', 'I will read']), ...(r() < 0.4 ? { happened: r() < 0.5 } : {}) };
    stamp(tsKey.plan(w));
  }
  for (const k of some(['a:m1', 'a:m2', 'c:m3'], 0.4)) {
    s.digestTaps[k] = { choice: k.startsWith('a') ? pickOf(['done', 'drop'] as const) : pickOf(['a', 'b'] as const), at: 1000 + Math.floor(r() * 4) * 100 };
    stamp(tsKey.digest(k));
  }
  if (r() < 0.5) {
    s.settings.playbackSpeed = pickOf([1, 1.5]);
    stamp(tsKey.setting('playbackSpeed'));
  }
  if (r() < 0.5) {
    s.settings.form = pickOf(['video', 'audio', 'text'] as const);
    stamp(tsKey.setting('form'));
  }
  if (r() < 0.4) {
    s.settings.captionMode = pickOf(['auto', 'on', 'off'] as const);
    stamp(tsKey.setting('captionMode'));
  }
  if (r() < 0.4) {
    const a = Math.floor(r() * 5) / 10;
    s.settings.areaShares = { brain: a, body: (1 - a) / 2, beat: (1 - a) / 2 } as never;
    stamp(tsKey.setting('areaShares'));
  }
  if (r() < 0.6) s.notesPromptDay = pickOf(days);
  if (r() < 0.6) s.momentDay = pickOf(days);
  return { ...d, ts };
}

describe('Zusammenführen: feste Fälle, in beide Richtungen', () => {
  for (const c of CASES) {
    it(c.name, () => {
      same(mergeDocs(c.a, c.b), c.expected);
      same(mergeDocs(c.b, c.a), c.expected);
    });
  }
  it('Protokoll wird auf 3000 Einträge gekürzt, die jüngsten Tage bleiben', () => {
    const big = (d0: number, n: number) => Array.from({ length: n }, (_, i) => log(`m${String(i).padStart(5, '0')}`, `2026-${String(d0).padStart(2, '0')}-01`, false, 1));
    const m = mergeDocs(doc({ momentLog: big(1, 2000) }), doc({ momentLog: big(2, 2000) }));
    expect(m.state.momentLog.length).toBe(LOG_MAX);
    expect(m.state.momentLog.every((e) => e.day === '2026-02-01' || e.day === '2026-01-01')).toBe(true);
    expect(m.state.momentLog.filter((e) => e.day === '2026-02-01').length).toBe(2000);
  });
  it('mit dem leeren Dokument ändert sich nichts', () => {
    for (const c of CASES) same(mergeDocs(c.a, emptyDoc()), mergeDocs(c.a, c.a));
  });
});

describe('Zusammenführen: Eigenschaften über Zufallsdokumente', () => {
  const r = rng(20261028);
  const docs = Array.from({ length: 150 }, () => [randomDoc(r), randomDoc(r), randomDoc(r)] as const);
  it('vertauschbar: merge(a,b) = merge(b,a)', () => {
    for (const [a, b] of docs) same(mergeDocs(a, b), mergeDocs(b, a));
  });
  it('wiederholbar: merge(a,a) = merge(a, leer), merge(merge(a,b),b) = merge(a,b)', () => {
    for (const [a, b] of docs) {
      same(mergeDocs(a, a), mergeDocs(a, emptyDoc()));
      const m = mergeDocs(a, b);
      same(mergeDocs(m, b), m);
      same(mergeDocs(m, a), m);
    }
  });
  it('gruppierbar: merge(merge(a,b),c) = merge(a,merge(b,c))', () => {
    for (const [a, b, c] of docs) same(mergeDocs(mergeDocs(a, b), c), mergeDocs(a, mergeDocs(b, c)));
  });
  it('drei Geräte in beliebiger Reihenfolge konvergieren', () => {
    for (const [a, b, c] of docs) {
      const all = [mergeDocs(mergeDocs(a, b), c), mergeDocs(mergeDocs(c, a), b), mergeDocs(mergeDocs(b, c), a)];
      same(all[0], all[1]);
      same(all[1], all[2]);
    }
  });
});

describe('Prüfdaten für die iPhone-App (tests/fixtures)', () => {
  const vectors = CASES.map((c) => ({ name: c.name, a: c.a, b: c.b, expected: c.expected }));
  const r = rng(77);
  const random = Array.from({ length: 40 }, () => {
    const a = randomDoc(r);
    const b = randomDoc(r);
    return { a, b, expected: mergeDocs(a, b) };
  });
  const write = process.env.WRITE_SYNC_FIXTURES === '1';
  for (const [file, data] of [['sync-vectors.json', vectors], ['sync-random.json', random]] as const) {
    const path = new URL(`./fixtures/${file}`, import.meta.url);
    it(`${file} stimmt mit der aktuellen Zusammenführung überein`, () => {
      if (write || !existsSync(path)) writeFileSync(path, JSON.stringify(data, null, 0) + '\n');
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(JSON.parse(JSON.stringify(data)));
    });
  }
});

const base = (over: Partial<AppState> = {}): AppState => ({ ...emptyState(), ...over });

describe('Zeitstempel beim Ändern', () => {
  it('ohne Änderung bleibt derselbe Zustand', () => {
    const s = base({ momentSeen: { a: 1 } });
    expect(stampChanges(s, { ...s, momentSeen: { a: 1, b: 2 } }, 5)).toEqual({ ...s, momentSeen: { a: 1, b: 2 } });
    const n = { ...s, momentSeen: { ...s.momentSeen, b: 2 } };
    expect(stampChanges(s, n, 5)).toBe(n);
  });
  it('geänderte Gewichte, gemerkte Momente, Herzen, Stumme, Pläne, Einstellungen bekommen die Zeit', () => {
    const s = base();
    const n = stampChanges(
      s,
      {
        ...s,
        momentWeights: { area: { brain: 1.1 }, channel: { c: 0.9 }, topic: { t: 0.7 } },
        savedMoments: { m1: sv('m1') },
        momentLiked: { m1: 1 },
        mutedChannels: { c: 'c' },
        plans: { w: { when: 'abc', will: 'def' } },
        settings: { ...s.settings, form: 'audio', playbackSpeed: 1 },
      },
      777,
    );
    expect(n.syncTs).toEqual({ [tsKey.weight('area', 'brain')]: 777, [tsKey.weight('channel', 'c')]: 777, [tsKey.weight('topic', 't')]: 777, [tsKey.saved('m1')]: 777, [tsKey.liked('m1')]: 777, [tsKey.muted('c')]: 777, [tsKey.plan('w')]: 777, [tsKey.setting('form')]: 777, [tsKey.setting('playbackSpeed')]: 777 });
  });
  it('Taps auf der Wochenkarte bekommen die Zeit der Änderung', () => {
    const s = base();
    const n = stampChanges(s, { ...s, digestTaps: { 'a:m1': { choice: 'done', at: 5 } } }, 321);
    expect(n.syncTs).toEqual({ [tsKey.digest('a:m1')]: 321 });
    expect(syncedChanged(s, n)).toBe(true);
    // die geladene Wochenkarte selbst wandert nicht
    const l = { ...s, digestLatest: { v: 1 as const, week: '2026-W44', generatedAt: '2026-10-29T17:00:00.000Z', saves: 1, counts: { action: 0, habit: 0, rule: 0, know: 1, research: 0, content: 0, script: 0, source: 0, contradiction: 0 }, actions: [], contradictions: [] } };
    expect(stampChanges(s, l, 5)).toBe(l);
    expect(syncedChanged(s, l)).toBe(false);
    expect(JSON.stringify(toDoc(l))).not.toMatch(/digestLatest|2026-W44/);
  });
  it('Wegnehmen und Zurücksetzen bekommen auch eine Zeit', () => {
    const s = base({ savedMoments: { m1: sv('m1') }, momentWeights: { area: {}, channel: { c: 0.9 }, topic: { t: 0.7 } }, mutedChannels: { c: 'c' }, syncTs: { old: 1 } });
    const n = stampChanges(s, { ...s, savedMoments: {}, momentWeights: { area: {}, channel: {}, topic: {} }, mutedChannels: {} }, 900);
    expect(n.syncTs).toEqual({ old: 1, [tsKey.saved('m1')]: 900, [tsKey.weight('channel', 'c')]: 900, [tsKey.weight('topic', 't')]: 900, [tsKey.muted('c')]: 900 });
  });
  it('nur das geänderte Gewicht wird gestempelt', () => {
    const s = base({ momentWeights: { area: {}, channel: { a: 0.9, b: 1.2 }, topic: {} }, syncTs: { [tsKey.weight('channel', 'a')]: 1, [tsKey.weight('channel', 'b')]: 1 } });
    const n = stampChanges(s, { ...s, momentWeights: { ...s.momentWeights, channel: { a: 0.9, b: 1.5 } } }, 50);
    expect(n.syncTs).toEqual({ [tsKey.weight('channel', 'a')]: 1, [tsKey.weight('channel', 'b')]: 50 });
  });
  it('ein neuer, geänderter oder abgelaufener Ablauf wird mit dem Gewicht gestempelt', () => {
    const s = base({ momentWeights: { area: {}, channel: {}, topic: { t: 0.2 }, until: { 't:t': { at: 5000, back: 1 } } }, syncTs: { [tsKey.weight('topic', 't')]: 1 } });
    const n = stampChanges(s, { ...s, momentWeights: { area: {}, channel: {}, topic: { t: 0.2 }, until: { 't:t': { at: 9000, back: 1 } } } }, 77);
    expect(n.syncTs).toEqual({ [tsKey.weight('topic', 't')]: 77 });
    const gone = stampChanges(s, { ...s, momentWeights: { area: {}, channel: {}, topic: { t: 1 } } }, 88);
    expect(gone.syncTs?.[tsKey.weight('topic', 't')]).toBe(88);
  });
  it('Gerätespezifisches (Player-Modus, Messwerte) wird nicht gestempelt', () => {
    const s = base();
    const n = { ...s, settings: { ...s.settings, playerMode: 'single' as const }, playLatency: [] };
    expect(stampChanges(s, n, 5)).toBe(n);
  });
});

describe('Dokument und Zustand', () => {
  it('toDoc nimmt nur Synchronisiertes, Gerätespezifisches bleibt draußen', () => {
    const s = base({ momentSeen: { a: 1 }, deskHelpSeen: true, playLatency: [{ ms: 1, buffered: true, at: 1 }] as never, tapMs: [{ ms: 1, at: 1 }] as never, settings: { ...emptyState().settings, playerMode: 'single' } });
    const d = toDoc(s);
    expect(Object.keys(d.state).sort()).toEqual(['dayCount', 'digestTaps', 'feedTime', 'feedbackNotes', 'momentLiked', 'momentLog', 'momentSeen', 'momentWeights', 'mutedChannels', 'plans', 'recall', 'savedMoments', 'settings', 'weekReviewShown']);
    expect(Object.keys(d.state.settings).sort()).toEqual(['areaShares', 'captionMode', 'playbackSpeed']);
    expect(JSON.stringify(d)).not.toMatch(/playerMode|deskHelpSeen|playLatency|tapMs/);
  });
  it('applyDoc übernimmt Fremdes, behält Gerätespezifisches und eigene Änderungen', () => {
    const local = base({ momentSeen: { a: 1 }, savedMoments: { m1: sv('m1') }, syncTs: { [tsKey.saved('m1')]: 10 }, deskHelpSeen: true, settings: { ...emptyState().settings, playerMode: 'single' } });
    const remote = doc({ momentSeen: { b: 2 }, savedMoments: { m2: sv('m2') }, settings: { form: 'text' } }, { [tsKey.saved('m2')]: 20, [tsKey.setting('form')]: 20 });
    const out = applyDoc(local, mergeDocs(toDoc(local), remote));
    expect(out.momentSeen).toEqual({ a: 1, b: 2 });
    expect(Object.keys(out.savedMoments).sort()).toEqual(['m1', 'm2']);
    expect(out.settings.form).toBe('text');
    expect(out.settings.playerMode).toBe('single');
    expect(out.deskHelpSeen).toBe(true);
    expect(out.syncTs).toEqual({ [tsKey.saved('m1')]: 10, [tsKey.saved('m2')]: 20, [tsKey.setting('form')]: 20 });
  });
  it('applyDoc mit demselben Inhalt lässt alle Verweise stehen', () => {
    const local = base({ momentSeen: { a: 1 }, savedMoments: { m1: sv('m1') }, momentWeights: { area: {}, channel: {}, topic: { t: 0.7 } }, syncTs: { x: 1 } });
    const out = applyDoc(local, toDoc(local));
    expect(out.momentSeen).toBe(local.momentSeen);
    expect(out.savedMoments).toBe(local.savedMoments);
    expect(out.momentWeights).toBe(local.momentWeights);
    expect(out.settings).toBe(local.settings);
  });
  it('syncedChanged erkennt Änderungen an Synchronisiertem, nicht an Gerätespezifischem', () => {
    const s = base();
    expect(syncedChanged(s, { ...s })).toBe(false);
    expect(syncedChanged(s, { ...s, playLatency: [] })).toBe(false);
    expect(syncedChanged(s, { ...s, settings: { ...s.settings, playerMode: 'single' } })).toBe(false);
    expect(syncedChanged(s, { ...s, momentSeen: { a: 1 } })).toBe(true);
    expect(syncedChanged(s, { ...s, settings: { ...s.settings, form: 'text' } })).toBe(true);
    expect(syncedChanged(s, { ...s, feedTime: { d: 1 } })).toBe(true);
  });
  it('zwei Geräte, eine Sitzung: A merkt, B nimmt weg, beide konvergieren', () => {
    let a = base({ savedMoments: { m1: sv('m1') }, syncTs: { [tsKey.saved('m1')]: 100 } });
    let b = applyDoc(base(), mergeDocs(toDoc(base()), toDoc(a)));
    expect(Object.keys(b.savedMoments)).toEqual(['m1']);
    b = stampChanges(b, { ...b, savedMoments: {} }, 200);
    a = applyDoc(a, mergeDocs(toDoc(a), toDoc(b)));
    expect(a.savedMoments).toEqual({});
    same(toDoc(a), toDoc(b));
  });
});
