import { describe, expect, it } from 'vitest';
import {
  applyEffect,
  confirmLine,
  DAY_MS,
  emptyWeights,
  known,
  learned,
  notForMe,
  RULE,
  settle,
  signal,
  skip,
  untilKey,
  weak,
  weightText,
  wrong,
  type SkipRun,
} from '../src/moments/learn';
import { SIGNAL, type Weights } from '../src/moments/mix';
import { chipEffect, CHIPS } from '../src/moments/note';

// Gleiche Prüfdaten in ios/CoreTests/LearnTests.swift

const T0 = 1_800_000_000_000;
const M = { area: 'brain', channel: 'Barbell Medicine', topic: 'kraft' };
const OTHER = { area: 'brain', channel: 'Sigma Nutrition (Prof. Grant Tinsley)', topic: 'ernaehrung' };
const w = (o: Partial<Weights> = {}): Weights => ({ ...emptyWeights(), ...o });
const near = (a: number | undefined, b: number) => expect(a).toBeCloseTo(b, 3);

describe('Skip (unter 3 s weggewischt)', () => {
  it('setzt Kanal und Thema auf höchstens 0,6, der Bereich bleibt', () => {
    const r = skip(w(), undefined, M, T0);
    near(r.weights.channel[M.channel], 0.6);
    near(r.weights.topic[M.topic], 0.6);
    expect(r.weights.area).toEqual({});
    expect(r.weights.until).toBeUndefined();
    expect(r.run).toEqual({ channel: M.channel, n: 1 });
  });
  it('ein Skip hebt nie ein niedrigeres Gewicht an und senkt ein höheres auf 0,6', () => {
    const r = skip(w({ channel: { [M.channel]: 0.4 }, topic: { [M.topic]: 1.8 } }), undefined, M, T0);
    near(r.weights.channel[M.channel], 0.4);
    near(r.weights.topic[M.topic], 0.6);
  });
  it('zweiter Skip desselben Kanals in Folge: Kanal 0,2 für 14 Tage, danach zurück auf 0,6', () => {
    const one = skip(w(), undefined, M, T0);
    const two = skip(one.weights, one.run, M, T0 + 5000);
    near(two.weights.channel[M.channel], 0.2);
    near(two.weights.topic[M.topic], 0.6);
    const u = two.weights.until?.[untilKey('channel', M.channel)];
    expect(u).toEqual({ at: T0 + 5000 + 14 * DAY_MS, back: 0.6 });
    expect(two.run).toEqual({ channel: M.channel, n: 2 });
    // einen Tick vor dem Ablauf gilt noch 0,2, am Ablauf 0,6
    near(settle(two.weights, T0 + 5000 + 14 * DAY_MS - 1).channel[M.channel], 0.2);
    const after = settle(two.weights, T0 + 5000 + 14 * DAY_MS);
    near(after.channel[M.channel], 0.6);
    expect(after.until).toBeUndefined();
  });
  it('anderer Kanal dazwischen: keine Folge, der Zähler fängt neu an', () => {
    const a = skip(w(), undefined, M, T0);
    const b = skip(a.weights, a.run, OTHER, T0 + 1);
    expect(b.run).toEqual({ channel: OTHER.channel, n: 1 });
    near(b.weights.channel[M.channel], 0.6);
    expect(b.weights.until).toBeUndefined();
    // und zurück zu M ist wieder der erste Skip von M
    const c = skip(b.weights, b.run, M, T0 + 2);
    expect(c.run).toEqual({ channel: M.channel, n: 1 });
    expect(c.weights.until).toBeUndefined();
  });
  it('kein Lauf (andere Wertung dazwischen): der nächste Skip ist wieder der erste', () => {
    const a = skip(w(), undefined, M, T0);
    const b = skip(a.weights, undefined as SkipRun | undefined, M, T0 + 1);
    expect(b.run.n).toBe(1);
    expect(b.weights.until).toBeUndefined();
  });
  it('dritter Skip in Folge verlängert die Frist ab jetzt, das Gewicht danach bleibt 0,6', () => {
    let r = skip(w(), undefined, M, T0);
    r = skip(r.weights, r.run, M, T0 + 1000);
    r = skip(r.weights, r.run, M, T0 + 2 * DAY_MS);
    expect(r.run.n).toBe(3);
    expect(r.weights.until?.[untilKey('channel', M.channel)]).toEqual({ at: T0 + 2 * DAY_MS + 14 * DAY_MS, back: 0.6 });
  });
  it('lag das Gewicht schon unter 0,6, bleibt es danach dort', () => {
    let r = skip(w({ channel: { [M.channel]: 0.4 } }), undefined, M, T0);
    r = skip(r.weights, r.run, M, T0 + 1);
    expect(r.weights.until?.[untilKey('channel', M.channel)]?.back).toBe(0.4);
  });
});

describe('Not for me', () => {
  it('Thema 0,2 für 30 Tage, Kanal 0,5, Bereich bleibt', () => {
    const r = notForMe(w(), M, T0);
    near(r.topic[M.topic], 0.2);
    near(r.channel[M.channel], 0.5);
    expect(r.area).toEqual({});
    expect(r.until?.[untilKey('topic', M.topic)]).toEqual({ at: T0 + 30 * DAY_MS, back: 1 });
    expect(r.until?.[untilKey('channel', M.channel)]).toBeUndefined();
  });
  it('nach 30 Tagen ist das Thema wieder auf dem Gewicht davor, höchstens 1, der Kanal bleibt bei 0,5', () => {
    const plain = settle(notForMe(w(), M, T0), T0 + 30 * DAY_MS);
    near(plain.topic[M.topic], 1);
    expect(plain.until).toBeUndefined();
    near(plain.channel[M.channel], 0.5);
    // ein sehr beliebtes Thema kommt auf 1 zurück, nicht auf 2,4
    near(settle(notForMe(w({ topic: { [M.topic]: 2.4 } }), M, T0), T0 + 30 * DAY_MS).topic[M.topic], 1);
    // ein schon schwaches Thema kommt auf sein altes Gewicht
    near(settle(notForMe(w({ topic: { [M.topic]: 0.7 } }), M, T0), T0 + 30 * DAY_MS).topic[M.topic], 0.7);
    // einen Tick vorher gilt noch 0,2
    near(settle(notForMe(w(), M, T0), T0 + 30 * DAY_MS - 1).topic[M.topic], 0.2);
  });
  it('ein Kanal unter 0,5 bleibt, wo er ist', () => {
    near(notForMe(w({ channel: { [M.channel]: 0.3 } }), M, T0).channel[M.channel], 0.3);
  });
  it('zweimal hintereinander verlängert die Frist auf 30 Tage ab dem zweiten Mal, das Gewicht danach bleibt', () => {
    const a = notForMe(w({ topic: { [M.topic]: 0.8 } }), M, T0);
    const b = notForMe(a, M, T0 + 10 * DAY_MS);
    expect(b.until?.[untilKey('topic', M.topic)]).toEqual({ at: T0 + 40 * DAY_MS, back: 0.8 });
  });
});

describe('Wrong, Known (Already known), Weak', () => {
  it('Wrong: nur der Kanal auf höchstens 0,5', () => {
    const r = wrong(w({ topic: { [M.topic]: 1.4 } }), M, T0);
    near(r.channel[M.channel], 0.5);
    near(r.topic[M.topic], 1.4);
    expect(r.area).toEqual({});
    near(wrong(w({ channel: { [M.channel]: 0.3 } }), M, T0).channel[M.channel], 0.3);
  });
  it('Known: nur das Thema auf höchstens 0,7', () => {
    const r = known(w({ channel: { [M.channel]: 1.4 } }), M, T0);
    near(r.topic[M.topic], 0.7);
    near(r.channel[M.channel], 1.4);
    expect(r.area).toEqual({});
    near(known(w({ topic: { [M.topic]: 0.3 } }), M, T0).topic[M.topic], 0.3);
  });
  it('Weak: nur der Kanal auf höchstens 0,7', () => {
    const r = weak(w({ topic: { [M.topic]: 1.4 } }), M, T0);
    near(r.channel[M.channel], 0.7);
    near(r.topic[M.topic], 1.4);
    expect(r.area).toEqual({});
    near(weak(w({ channel: { [M.channel]: 0.3 } }), M, T0).channel[M.channel], 0.3);
  });
  it('die Deckel summieren sich nicht, ein zweites Wrong ändert nichts', () => {
    const a = wrong(w(), M, T0);
    expect(wrong(a, M, T0 + 1)).toEqual(a);
    expect(known(known(w(), M, T0), M, T0)).toEqual(known(w(), M, T0));
  });
  it('ein Deckel nimmt auch das Gewicht danach eines laufenden Ablaufs mit', () => {
    // Kanal ist per Doppel-Skip bis in 14 Tagen auf 0,2, danach 0,6. Wrong deckelt das "danach" auf 0,5.
    let r = skip(w(), undefined, M, T0);
    r = skip(r.weights, r.run, M, T0 + 1);
    const x = wrong(r.weights, M, T0 + 2);
    near(x.channel[M.channel], 0.2);
    expect(x.until?.[untilKey('channel', M.channel)]?.back).toBe(0.5);
    near(settle(x, T0 + 15 * DAY_MS).channel[M.channel], 0.5);
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
  it('Faktoren bleiben wie bisher', () => {
    expect([SIGNAL.more, SIGNAL.save, SIGNAL.ended, SIGNAL.back, SIGNAL.early, SIGNAL.mostly]).toEqual([1.3, 1.1, 1.1, 1.1, 0.95, 1.05]);
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
    const a = notForMe(w(), M, T0);
    const b = signal(a, M, SIGNAL.more, T0 + 1000);
    near(b.topic[M.topic], 0.26);
    expect(b.until?.[untilKey('topic', M.topic)]?.back).toBeCloseTo(1.3, 6);
  });
});

describe('Abläufe als Zeitstempel in den Gewichten', () => {
  it('settle gibt denselben Verweis zurück, solange nichts abgelaufen ist', () => {
    const a = notForMe(w(), M, T0);
    expect(settle(a, T0 + 1)).toBe(a);
    const plain = w({ channel: { x: 0.7 } });
    expect(settle(plain, T0)).toBe(plain);
  });
  it('settle verändert die Eingabe nicht', () => {
    const a = notForMe(w(), M, T0);
    const frozen = JSON.stringify(a);
    settle(a, T0 + 99 * DAY_MS);
    expect(JSON.stringify(a)).toBe(frozen);
  });
  it('jede Regel rechnet zuerst die abgelaufenen Fristen ein', () => {
    const a = notForMe(w(), M, T0);
    const late = T0 + 31 * DAY_MS;
    // Known nach Ablauf: das Thema ist wieder 1 und wird auf 0,7 gedeckelt, kein Rest der Sperre
    const k = known(a, M, late);
    near(k.topic[M.topic], 0.7);
    expect(k.until).toBeUndefined();
    // More nach Ablauf wächst aus dem Gewicht danach
    near(signal(a, M, SIGNAL.more, late).topic[M.topic], 1.3);
  });
  it('mehrere Abläufe laufen unabhängig ab', () => {
    let r = notForMe(w(), M, T0); // Thema 30 Tage
    r = skip(r, undefined, OTHER, T0).weights;
    const two = skip(r, { channel: OTHER.channel, n: 1 }, OTHER, T0 + 1); // Kanal OTHER 14 Tage
    const day20 = settle(two.weights, T0 + 20 * DAY_MS);
    near(day20.channel[OTHER.channel], 0.6);
    near(day20.topic[M.topic], 0.2);
    const day31 = settle(two.weights, T0 + 31 * DAY_MS);
    near(day31.topic[M.topic], 1);
    expect(day31.until).toBeUndefined();
  });
});

describe('Chips und Bestätigungszeile', () => {
  it('jeder Chip lernt das, was in der Regel steht', () => {
    expect(CHIPS.map((c) => chipEffect(c))).toEqual(['known', 'notForMe', 'weak', 'wrong', null, 'mute']);
    const at = T0;
    near(applyEffect(w(), 'known', M, at).topic[M.topic], 0.7);
    near(applyEffect(w(), 'wrong', M, at).channel[M.channel], 0.5);
    near(applyEffect(w(), 'weak', M, at).channel[M.channel], 0.7);
    near(applyEffect(w(), 'notForMe', M, at).topic[M.topic], 0.2);
    expect(applyEffect(w(), 'mute', M, at)).toEqual(w());
  });
  it('Bestätigungszeile je Chip', () => {
    expect(confirmLine('wrong', M)).toBe('Less Barbell Medicine');
    expect(confirmLine('weak', M)).toBe('Less Barbell Medicine');
    expect(confirmLine('known', M)).toBe('Less Kraft');
    expect(confirmLine('notForMe', M)).toBe('Less Kraft');
    expect(confirmLine('mute', M)).toBe('Barbell Medicine muted');
    expect(confirmLine(null, M)).toBe('Noted');
    expect(confirmLine('wrong', OTHER)).toBe('Less Sigma Nutrition · Prof. Grant Tinsley');
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
    const a = notForMe(w(), M, T0);
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

describe('Abläufe der Regeln, vom Wischen bis zur Sperre', () => {
  it('Kanal zweimal sofort weggewischt, dann 14 Tage nichts, dann wieder 0,6', () => {
    let run: SkipRun | undefined;
    let weights = w();
    for (const [i, m] of [M, M].entries()) {
      const r = skip(weights, run, m, T0 + i * 1000);
      weights = r.weights;
      run = r.run;
    }
    expect(learned(weights, T0 + 13 * DAY_MS).channelDown[0]).toMatchObject({ key: M.channel, weight: 0.2 });
    expect(learned(weights, T0 + 15 * DAY_MS).channelDown[0]).toMatchObject({ key: M.channel, weight: 0.6 });
  });
  it('RULE-Zahlen wie beschlossen', () => {
    expect(RULE).toEqual({ skip: 0.6, skipRun: 0.2, skipRunDays: 14, notForMeTopic: 0.2, notForMeDays: 30, notForMeChannel: 0.5, wrongChannel: 0.5, knownTopic: 0.7, weakChannel: 0.7 });
  });
});
