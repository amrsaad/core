import { describe, expect, it } from 'vitest';
import {
  applyEffect,
  confirmLine,
  DAY_MS,
  emptyWeights,
  LEARN_VERSION,
  learned,
  migrateWeights,
  notForMe,
  RULE,
  settle,
  signal,
  skip,
  tap,
  untilKey,
  weak,
  weightText,
  type Learn,
} from '../src/moments/learn';
import { SIGNAL, type Weights } from '../src/moments/mix';
import { chipEffect, CHIPS } from '../src/moments/note';
import { applyDoc, emptyDoc, mergeDocs, stampChanges, toDoc } from '../src/lib/sync/merge';
import { emptyState } from '../src/lib/state';

// Gleiche Prüfdaten in ios/CoreTests/LearnTests.swift

const T0 = 1_800_000_000_000;
const M = { area: 'brain', channel: 'Barbell Medicine', topic: 'kraft', videoId: 'vidKraft1', subtopic: ['kraft/hypertrophie', 'kraft/programm'] };
const SAME_EP = { ...M };
const OTHER = { area: 'brain', channel: 'Sigma Nutrition (Prof. Grant Tinsley)', topic: 'ernaehrung', videoId: 'vidErn1' };
const w = (o: Partial<Weights> = {}): Weights => ({ ...emptyWeights(), ...o });
const L = (o: Partial<Weights> = {}, taps: Learn['taps'] = {}): Learn => ({ weights: w(o), taps });
const near = (a: number | undefined, b: number) => expect(a).toBeCloseTo(b, 3);
const ek = (id: string) => untilKey('episode', id);

describe('Skip (unter 3 s weggewischt)', () => {
  it('Kanal und Thema mal 0,97, der Bereich und die Folge bleiben', () => {
    const r = skip(L(), M, T0);
    near(r.weights.channel[M.channel], 0.97);
    near(r.weights.topic[M.topic], 0.97);
    expect(r.weights.area).toEqual({});
    expect(r.weights.episode).toBeUndefined();
    expect(r.weights.until).toBeUndefined();
  });
  it('der zweite Skip derselben Folge in 7 Tagen setzt die Folge auf 0,5 für 7 Tage', () => {
    const a = skip(L(), M, T0);
    const b = skip(a, SAME_EP, T0 + 3 * DAY_MS);
    near(b.weights.episode?.[M.videoId], 0.5);
    expect(b.weights.until?.[ek(M.videoId)]).toEqual({ at: T0 + 10 * DAY_MS, back: 1 });
    // der Kanal wird nicht gesperrt: nur mal 0,97 je Skip
    near(b.weights.channel[M.channel], 0.97 * 0.97);
    // nach 7 Tagen ist die Folge wieder bei 1
    near(settle(b.weights, T0 + 10 * DAY_MS).episode?.[M.videoId], 1);
    near(settle(b.weights, T0 + 10 * DAY_MS - 1).episode?.[M.videoId], 0.5);
  });
  it('Skips anderer Folgen zählen nicht zusammen, Skips mit mehr als 7 Tagen Abstand auch nicht', () => {
    const a = skip(skip(L(), M, T0), { ...M, videoId: 'andere' }, T0 + 1);
    expect(a.weights.episode).toBeUndefined();
    const b = skip(skip(L(), M, T0), M, T0 + 8 * DAY_MS);
    expect(b.weights.episode).toBeUndefined();
  });
  it('ein Skip senkt nie unter 0,2', () => {
    let r = L();
    for (let i = 0; i < 200; i++) r = skip(r, { ...M, videoId: 'v' + i }, T0 + i);
    expect(r.weights.channel[M.channel]).toBe(0.2);
  });
});

describe('Not for me', () => {
  it('Folge 0,3 für 30 Tage, Thema höchstens 0,9, Kanal und Bereich bleiben', () => {
    const r = notForMe(L(), M, T0).weights;
    near(r.episode?.[M.videoId], 0.3);
    expect(r.until?.[ek(M.videoId)]).toEqual({ at: T0 + 30 * DAY_MS, back: 1 });
    near(r.topic[M.topic], 0.9);
    expect(r.channel).toEqual({});
    expect(r.area).toEqual({});
    // nach 30 Tagen ist die Folge wieder bei 1, das Thema bleibt bei 0,9
    const later = settle(r, T0 + 30 * DAY_MS);
    near(later.episode?.[M.videoId], 1);
    near(later.topic[M.topic], 0.9);
    near(settle(r, T0 + 30 * DAY_MS - 1).episode?.[M.videoId], 0.3);
  });
  it('das Thema bleibt, wo es schon niedriger ist, und ein beliebtes sinkt nur auf 0,9', () => {
    near(notForMe(L({ topic: { [M.topic]: 0.4 } }), M, T0).weights.topic[M.topic], 0.4);
    near(notForMe(L({ topic: { [M.topic]: 2.4 } }), M, T0).weights.topic[M.topic], 0.9);
  });
  it('das Gewicht der Folge davor kommt zurück, höchstens 1', () => {
    near(settle(notForMe(L({ episode: { [M.videoId]: 2 } }), M, T0).weights, T0 + 31 * DAY_MS).episode?.[M.videoId], 1);
    near(settle(notForMe(L({ episode: { [M.videoId]: 0.7 } }), M, T0).weights, T0 + 31 * DAY_MS).episode?.[M.videoId], 0.7);
  });
  it('dreimal in 30 Tagen im selben Unterthema: Unterthema 0,3 für 30 Tage', () => {
    const tag = M.subtopic[0];
    let r = notForMe(L(), { ...M, videoId: 'e1' }, T0);
    r = notForMe(r, { ...M, videoId: 'e2' }, T0 + 5 * DAY_MS);
    expect(r.weights.subtopic).toBeUndefined();
    r = notForMe(r, { ...M, videoId: 'e3' }, T0 + 20 * DAY_MS);
    near(r.weights.subtopic?.[tag], 0.3);
    expect(r.weights.until?.[untilKey('subtopic', tag)]).toEqual({ at: T0 + 50 * DAY_MS, back: 1 });
    near(settle(r.weights, T0 + 50 * DAY_MS).subtopic?.[tag], 1);
    // das zweite Unterthema des Moments zählt für sich, hier ebenfalls drei Tipps
    near(r.weights.subtopic?.[M.subtopic[1]], 0.3);
  });
  it('Tipps älter als 30 Tage zählen nicht mit', () => {
    let r = notForMe(L(), { ...M, videoId: 'e1' }, T0);
    r = notForMe(r, { ...M, videoId: 'e2' }, T0 + 20 * DAY_MS);
    r = notForMe(r, { ...M, videoId: 'e3' }, T0 + 40 * DAY_MS);
    expect(r.weights.subtopic).toBeUndefined();
  });
  it('ein Moment ohne Unterthema lernt Folge und Thema, ohne Zähler', () => {
    const r = notForMe(L(), { ...OTHER }, T0);
    near(r.weights.episode?.[OTHER.videoId], 0.3);
    expect(r.taps).toEqual({});
  });
  it('kein Thema wird mehr gesperrt: ein Tipp nimmt dem Thema weniger als 10 Prozent', () => {
    expect(notForMe(L(), M, T0).weights.topic[M.topic]).toBeGreaterThanOrEqual(0.9);
  });
});

describe('Known, Wrong, Mute', () => {
  it('ändern keine Gewichte und keine Zähler', () => {
    const start = L({ topic: { [M.topic]: 1.4 }, channel: { [M.channel]: 1.2 } }, { 'w:x': [T0] });
    for (const e of ['known', 'wrong', 'mute'] as const) expect(applyEffect(start, e, M, T0)).toEqual(start);
  });
});

describe('Weak', () => {
  it('Kanal mal 0,9 je Tipp, kumulativ', () => {
    const a = weak(L(), M, T0);
    near(a.weights.channel[M.channel], 0.9);
    const b = weak(a, M, T0 + 1000);
    near(b.weights.channel[M.channel], 0.81);
    expect(b.weights.topic).toEqual({});
    expect(b.weights.area).toEqual({});
  });
  it('der dritte Tipp in 30 Tagen setzt den Kanal auf 0,5', () => {
    let r = weak(L(), M, T0);
    r = weak(r, M, T0 + 10 * DAY_MS);
    near(r.weights.channel[M.channel], 0.81);
    r = weak(r, M, T0 + 29 * DAY_MS);
    near(r.weights.channel[M.channel], 0.5);
  });
  it('liegen die Tipps weiter auseinander, bleibt es bei 0,9 je Tipp', () => {
    let r = weak(L(), M, T0);
    r = weak(r, M, T0 + 20 * DAY_MS);
    r = weak(r, M, T0 + 40 * DAY_MS);
    near(r.weights.channel[M.channel], 0.729);
  });
  it('Untergrenze 0,5, ein tieferes Gewicht bleibt', () => {
    let r = L({ channel: { [M.channel]: 0.52 } });
    r = weak(r, M, T0);
    near(r.weights.channel[M.channel], 0.5);
    near(weak(L({ channel: { [M.channel]: 0.3 } }), M, T0).weights.channel[M.channel], 0.3);
  });
});

describe('Zähler', () => {
  it('tap zählt innerhalb der Frist und lässt Altes nach 30 Tagen fallen', () => {
    let r = tap(undefined, 'a', T0, 7);
    expect(r.n).toBe(1);
    r = tap(r.log, 'a', T0 + 3 * DAY_MS, 7);
    expect(r.n).toBe(2);
    r = tap(r.log, 'a', T0 + 9 * DAY_MS, 7);
    expect(r.n).toBe(2);
    r = tap(r.log, 'b', T0 + 40 * DAY_MS, 7);
    expect(r.log.a).toBeUndefined();
    expect(r.log.b).toEqual([T0 + 40 * DAY_MS]);
  });
});

describe('More, Save, Ende wie bisher, zusätzlich auf Thema', () => {
  it('Faktor auf Kanal und Thema, abgeschwächt auf den Bereich', () => {
    for (const [name, f] of [['more', SIGNAL.more], ['save', SIGNAL.save], ['ended', SIGNAL.ended]] as const) {
      const r = signal(w(), M, f, T0);
      near(r.channel[M.channel], f);
      near(r.topic[M.topic], f);
      near(r.area[M.area], Math.sqrt(f));
      expect(name).toBeTruthy();
    }
  });
  it('Faktoren: Speichern, Zurückwischen und Abruf wiegen mehr als Zuschauzeit (Issue 24)', () => {
    expect([SIGNAL.more, SIGNAL.save, SIGNAL.ended, SIGNAL.back, SIGNAL.early, SIGNAL.mostly]).toEqual([1.3, 1.2, 1.1, 1.25, 0.95, 1.05]);
    expect(SIGNAL.recall).toBe(1.2);
    expect(Math.min(SIGNAL.save, SIGNAL.back, SIGNAL.recall)).toBeGreaterThan(SIGNAL.ended);
  });
  it('zwischen 0,2 und 3', () => {
    let r = w();
    for (let i = 0; i < 40; i++) r = signal(r, M, SIGNAL.more, T0);
    expect(r.channel[M.channel]).toBe(3);
    expect(r.topic[M.topic]).toBe(3);
    for (let i = 0; i < 80; i++) r = signal(r, M, 0.7, T0);
    expect(r.channel[M.channel]).toBe(0.2);
  });
  it('Herz zurücknehmen (1 / 1,3) macht More rückgängig', () => {
    const r = signal(signal(w(), M, SIGNAL.more, T0), M, 1 / SIGNAL.more, T0);
    near(r.channel[M.channel], 1);
    near(r.topic[M.topic], 1);
  });
  it('unter einem laufenden Ablauf wächst auch das Gewicht danach mit', () => {
    const a = w({ topic: { [M.topic]: 0.2 }, until: { [untilKey('topic', M.topic)]: { at: T0 + 30 * DAY_MS, back: 1 } } });
    const b = signal(a, M, SIGNAL.more, T0 + 1000);
    near(b.topic[M.topic], 0.26);
    expect(b.until?.[untilKey('topic', M.topic)]?.back).toBeCloseTo(1.3, 6);
  });
});

describe('Abläufe als Zeitstempel in den Gewichten', () => {
  it('settle gibt denselben Verweis zurück, solange nichts abgelaufen ist', () => {
    const a = notForMe(L(), M, T0).weights;
    expect(settle(a, T0 + 1)).toBe(a);
    const plain = w({ channel: { x: 0.7 } });
    expect(settle(plain, T0)).toBe(plain);
  });
  it('settle verändert die Eingabe nicht', () => {
    const a = notForMe(L(), M, T0).weights;
    const frozen = JSON.stringify(a);
    settle(a, T0 + 99 * DAY_MS);
    expect(JSON.stringify(a)).toBe(frozen);
  });
  it('More nach Ablauf wächst aus dem Gewicht danach', () => {
    const a = notForMe(L({ topic: {} }), M, T0).weights;
    const withEp = signal(a, M, SIGNAL.more, T0 + 31 * DAY_MS);
    expect(withEp.until).toBeUndefined();
    near(withEp.episode?.[M.videoId], 1);
    near(withEp.topic[M.topic], 0.9 * 1.3);
  });
  it('mehrere Abläufe laufen unabhängig ab', () => {
    let r = notForMe(L(), M, T0); // Folge 30 Tage
    r = skip(skip(r, OTHER, T0 + 1), OTHER, T0 + 2); // Folge OTHER 7 Tage
    const day10 = settle(r.weights, T0 + 10 * DAY_MS);
    near(day10.episode?.[OTHER.videoId], 1);
    near(day10.episode?.[M.videoId], 0.3);
    const day31 = settle(r.weights, T0 + 31 * DAY_MS);
    near(day31.episode?.[M.videoId], 1);
    expect(day31.until).toBeUndefined();
  });
});

describe('Chips und Bestätigungszeile', () => {
  it('jeder Chip lernt das, was in der Regel steht', () => {
    expect(CHIPS.map((c) => chipEffect(c))).toEqual(['known', 'notForMe', 'weak', 'wrong', null, 'mute']);
    near(applyEffect(L(), 'weak', M, T0).weights.channel[M.channel], 0.9);
    near(applyEffect(L(), 'notForMe', M, T0).weights.episode?.[M.videoId], 0.3);
    expect(applyEffect(L(), 'known', M, T0)).toEqual(L());
    expect(applyEffect(L(), 'wrong', M, T0)).toEqual(L());
    expect(applyEffect(L(), 'mute', M, T0)).toEqual(L());
  });
  it('Bestätigungszeile sagt, was sich geändert hat', () => {
    expect(confirmLine('notForMe', M)).toBe('Less from this episode for 30 days');
    expect(confirmLine('known', M)).toBe('Marked known');
    expect(confirmLine('weak', M)).toBe('Less Barbell Medicine');
    expect(confirmLine('weak', OTHER)).toBe('Less Sigma Nutrition · Prof. Grant Tinsley');
    expect(confirmLine('mute', M)).toBe('Barbell Medicine muted');
    expect(confirmLine('mute', M, 53)).toBe('Barbell Medicine muted, 53 moments');
    expect(confirmLine('mute', M, 1)).toBe('Barbell Medicine muted, 1 moment');
    expect(confirmLine('wrong', M)).toBe('Noted');
    expect(confirmLine(null, M)).toBe('Noted');
  });
  it('Bad cut lernt nichts, Bestätigung ist Noted', () => {
    expect(chipEffect('Bad cut')).toBeNull();
  });
});

describe('Karte "What Core learned"', () => {
  const many = (n: number, f: (i: number) => number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${String(i).padStart(2, '0')}`, f(i)]));
  it('je fünf oben und unten, stärkste und schwächste zuerst', () => {
    const l = learned(w({ channel: many(8, (i) => 1 + (i + 1) / 10), topic: many(8, (i) => 1 - (i + 1) / 12) }), T0);
    expect(l.channelUp.map((r) => r.key)).toEqual(['k07', 'k06', 'k05', 'k04', 'k03']);
    expect(l.channelUp[0].weight).toBeCloseTo(1.8, 6);
    expect(l.channelDown).toEqual([]);
    expect(l.topicDown.map((r) => r.key)).toEqual(['k07', 'k06', 'k05', 'k04', 'k03']);
    expect(l.topicUp).toEqual([]);
  });
  it('Gewicht 1 steht nirgends, Gleichstand nach Name', () => {
    const l = learned(w({ channel: { b: 1.5, a: 1.5, c: 1, d: 0.5 } }), T0);
    expect(l.channelUp.map((r) => r.key)).toEqual(['a', 'b']);
    expect(l.channelDown.map((r) => r.key)).toEqual(['d']);
  });
  it('zeigt das wirksame Gewicht und das Ende einer laufenden Frist', () => {
    const a = w({ topic: { [M.topic]: 0.2 }, channel: { [M.channel]: 0.5 }, until: { [untilKey('topic', M.topic)]: { at: T0 + 30 * DAY_MS, back: 1 } } });
    const during = learned(a, T0 + DAY_MS);
    expect(during.topicDown[0]).toEqual({ key: M.topic, weight: 0.2, until: T0 + 30 * DAY_MS });
    expect(during.channelDown[0]).toEqual({ key: M.channel, weight: 0.5 });
    // nach Ablauf: das Thema ist wieder bei 1 und fällt aus der Liste
    expect(learned(a, T0 + 31 * DAY_MS).topicDown).toEqual([]);
  });
  it('Gewicht mit Pfeil', () => {
    expect(weightText(0.6)).toBe('0.60 ↓');
    expect(weightText(1.3)).toBe('1.30 ↑');
    expect(weightText(0.2)).toBe('0.20 ↓');
  });
  it('Reset: leere Gewichte ohne Abläufe', () => {
    const l = learned(emptyWeights(), T0);
    expect(l).toEqual({ channelUp: [], channelDown: [], topicUp: [], topicDown: [] });
    expect(emptyWeights()).toEqual({ area: {}, channel: {}, topic: {} });
  });
});

describe('Übergang der bestehenden Gewichte (Issue 28, Punkt 9)', () => {
  const old = w({
    channel: { a: 0.2, b: 0.5, c: 0.3, d: 1.4 },
    topic: { ki: 0.2, augen: 0.7, linse: 0.45 },
    until: {
      [untilKey('topic', 'ki')]: { at: T0 + 20 * DAY_MS, back: 1 },
      [untilKey('channel', 'a')]: { at: T0 + 10 * DAY_MS, back: 0.6 },
      [untilKey('channel', 'b')]: { at: T0 + 10 * DAY_MS, back: 0.5 },
      [ek('vid')]: { at: T0 + 10 * DAY_MS, back: 1 },
    },
    episode: { vid: 0.3 },
  });
  it('Kanal- und Themagewichte unter 0,5 kommen auf 0,8, alles andere bleibt', () => {
    const r = migrateWeights(old);
    expect(r.channel).toEqual({ a: 0.8, b: 0.5, c: 0.8, d: 1.4 });
    expect(r.topic).toEqual({ ki: 0.8, augen: 0.7, linse: 0.8 });
    expect(r.episode).toEqual({ vid: 0.3 });
  });
  it('die Abläufe der angehobenen Gewichte entfallen, die anderen bleiben', () => {
    const r = migrateWeights(old);
    expect(Object.keys(r.until ?? {}).sort()).toEqual([untilKey('channel', 'b'), ek('vid')].sort());
  });
  it('das Thema KI ist danach nicht mehr 30 Tage weg: auch nach Ablauf bleibt 0,8', () => {
    const r = settle(migrateWeights(old), T0 + 31 * DAY_MS);
    near(r.topic.ki, 0.8);
    near(r.channel.a, 0.8);
  });
  it('einmalig: ein zweiter Lauf ändert nichts, ohne niedrige Gewichte bleibt der Verweis', () => {
    const once = migrateWeights(old);
    expect(migrateWeights(once)).toBe(once);
    const fine = w({ channel: { x: 0.9 }, topic: { y: 0.5 } });
    expect(migrateWeights(fine)).toBe(fine);
    expect(LEARN_VERSION).toBe(2);
  });
  it('der angehobene Wert bekommt über den Sync einen neueren Zeitstempel und gewinnt gegen den alten Wert des anderen Geräts', () => {
    const before = { ...emptyState(), momentWeights: old, syncTs: { 'w:topic:ki': 100, 'w:channel:a': 100 } };
    const after = { ...before, momentWeights: migrateWeights(before.momentWeights) };
    const stamped = stampChanges(before, after, 5000);
    expect(stamped.syncTs!['w:topic:ki']).toBe(5000);
    const other = { ...emptyState(), momentWeights: w({ topic: { ki: 0.2 } }), syncTs: { 'w:topic:ki': 100 } };
    const merged = applyDoc(stamped, mergeDocs(toDoc(stamped), toDoc(other)));
    near(merged.momentWeights.topic.ki, 0.8);
  });
});

describe('Folge und Unterthema im Sync', () => {
  it('Gewichte je Folge und Unterthema wandern, je Schlüssel gewinnt der jüngere Zeitstempel', () => {
    const a = { ...emptyState(), momentWeights: w({ episode: { e1: 0.3 }, subtopic: { 'ki/x': 0.3 } }), syncTs: { 'w:episode:e1': 200, 'w:subtopic:ki/x': 100 } };
    const b = { ...emptyState(), momentWeights: w({ episode: { e1: 1 }, subtopic: { 'ki/x': 0.5 } }), syncTs: { 'w:episode:e1': 100, 'w:subtopic:ki/x': 300 } };
    const m1 = mergeDocs(toDoc(a), toDoc(b)).state.momentWeights;
    const m2 = mergeDocs(toDoc(b), toDoc(a)).state.momentWeights;
    expect(m1).toEqual(m2);
    near(m1.episode?.e1, 0.3);
    near(m1.subtopic?.['ki/x'], 0.5);
  });
  it('ohne Folge und Unterthema bleiben die Felder aus dem Dokument', () => {
    const d = mergeDocs(emptyDoc(), emptyDoc()).state.momentWeights;
    expect('episode' in d).toBe(false);
    expect('subtopic' in d).toBe(false);
  });
  it('stampChanges stempelt Folge und Unterthema', () => {
    const before = emptyState();
    const after = { ...before, momentWeights: w({ episode: { e1: 0.3 } }) };
    expect(stampChanges(before, after, 777).syncTs!['w:episode:e1']).toBe(777);
  });
});

describe('Abläufe der Regeln', () => {
  it('RULE-Zahlen wie beschlossen (Entscheidung 38)', () => {
    expect(RULE).toEqual({
      skipFactor: 0.97,
      skipEpisode: 0.5,
      skipEpisodeDays: 7,
      skipEpisodeTaps: 2,
      notForMeEpisode: 0.3,
      notForMeDays: 30,
      notForMeTopic: 0.9,
      subtopicTaps: 3,
      subtopicWeight: 0.3,
      subtopicDays: 30,
      weakFactor: 0.9,
      weakFloor: 0.5,
      weakTaps: 3,
      weakDays: 30,
    });
  });
});
