import { describe, expect, it } from 'vitest';
import { canWarm, COVER_MARGIN_MS, coverMs, MIN_WARM_LEN_S, onNonCurrentPlaying, roleOf, rolesAt, slotOf, slowNet, startQuality, swipePlan, videoStats, WARM_MS, type SlotView, type WarmCtx } from '../src/video/warmup';

const ctx = (o: Partial<WarmCtx> = {}): WarmCtx => ({ youtube: true, lenS: 60, text: false, forYou: false, recall: false, visible: true, single: false, ...o });
const view = (o: Partial<SlotView> = {}): SlotView => ({ index: -1, warm: 'idle', visited: false, warmPlayedMs: 0, ...o });

describe('Rollen der drei Player (A aktuell, B nächster, C übernächster)', () => {
  it('Slot ist Moment-Index modulo 3, auch für negative Indizes', () => {
    expect([0, 1, 2, 3, 4, 5].map((j) => slotOf(j))).toEqual([0, 1, 2, 0, 1, 2]);
    expect(slotOf(-1)).toBe(2);
  });

  it('bei idx 0 ist Slot 0 aktuell, Slot 1 nächster, Slot 2 übernächster', () => {
    expect(rolesAt(0)).toEqual(['current', 'next', 'after']);
  });

  it('nach einem Wisch nach vorn wird B zu A, C zu B und der alte A zu C', () => {
    expect(rolesAt(1)).toEqual(['after', 'current', 'next']);
    expect(rolesAt(2)).toEqual(['next', 'after', 'current']);
    expect(rolesAt(3)).toEqual(['current', 'next', 'after']);
  });

  it('roleOf passt zu rolesAt für die Momente der drei Slots', () => {
    for (let idx = 0; idx < 7; idx++) {
      const byRoleOf = [idx, idx + 1, idx + 2].map((j) => ({ s: slotOf(j), r: roleOf(j, idx) }));
      for (const { s, r } of byRoleOf) expect(rolesAt(idx)[s]).toBe(r);
    }
  });

  it('der Moment davor ist weder nächster noch übernächster', () => {
    expect(roleOf(2, 3)).toBe('other');
  });
});

describe('Warmlauf nur dort, wo er etwas bringt', () => {
  it('nur der nächste YouTube-Moment läuft warm', () => {
    expect(canWarm('next', ctx())).toBe(true);
    expect(canWarm('after', ctx())).toBe(false);
    expect(canWarm('current', ctx())).toBe(false);
    expect(canWarm('other', ctx())).toBe(false);
  });

  it('eigene Streams, Text, Für-dich-Karte, Abrufkarte, Hintergrund und Ein-Player-Modus laufen nicht warm', () => {
    expect(canWarm('next', ctx({ youtube: false }))).toBe(false);
    expect(canWarm('next', ctx({ text: true }))).toBe(false);
    expect(canWarm('next', ctx({ forYou: true }))).toBe(false);
    expect(canWarm('next', ctx({ recall: true }))).toBe(false);
    expect(canWarm('next', ctx({ visible: false }))).toBe(false);
    expect(canWarm('next', ctx({ single: true }))).toBe(false);
  });

  it('sehr kurze Momente laufen nicht warm', () => {
    expect(canWarm('next', ctx({ lenS: MIN_WARM_LEN_S - 1 }))).toBe(false);
    expect(canWarm('next', ctx({ lenS: MIN_WARM_LEN_S }))).toBe(true);
  });

  it('meldet ein nicht aktueller Player PLAYING, hält nur der laufende Warmlauf des nächsten Moments', () => {
    expect(onNonCurrentPlaying('running', 'next', true)).toBe('hold');
    expect(onNonCurrentPlaying('idle', 'next', true)).toBe('pause');
    expect(onNonCurrentPlaying('done', 'next', true)).toBe('pause');
    expect(onNonCurrentPlaying('running', 'after', true)).toBe('pause');
    expect(onNonCurrentPlaying('running', 'next', false)).toBe('pause');
  });
});

describe('Abdeckfläche nach PLAYING (Kaltstart und zu früher Wisch)', () => {
  it('Warmlauf fertig: keine Fläche nötig', () => {
    expect(coverMs('done', 0)).toBe(0);
  });
  it('Warmlauf läuft: nur der Rest der drei Sekunden', () => {
    expect(coverMs('running', 1200)).toBe(WARM_MS - 1200 + COVER_MARGIN_MS);
    expect(coverMs('running', 9000)).toBe(0);
  });
  it('kein Warmlauf: volle drei Sekunden', () => {
    expect(coverMs('idle', 0)).toBe(WARM_MS + COVER_MARGIN_MS);
  });
});

describe('Wisch: Zielslot, Abdeckung, Nachrücken', () => {
  // Zustand bei idx 0: Slot 0 aktuell (visited), Slot 1 warm fertig, Slot 2 wartet am ersten Bild
  const base = (): SlotView[] => [view({ index: 0, visited: true }), view({ index: 1, warm: 'done' }), view({ index: 2, warm: 'idle' })];

  it('Wisch nach vorn auf den warmen Slot: keine Abdeckung, der übernächste rückt nach und läuft warm', () => {
    const p = swipePlan(1, base(), () => ctx());
    expect(p.target).toBe(1);
    expect(p.coverMs).toBe(0);
    expect(p.promote).toBe(2);
  });

  it('Wisch bevor der Warmlauf fertig war: Rest der Abdeckung', () => {
    const v = base();
    v[1] = view({ index: 1, warm: 'running', warmPlayedMs: 1000 });
    expect(swipePlan(1, v, () => ctx()).coverMs).toBe(WARM_MS - 1000 + COVER_MARGIN_MS);
  });

  it('Wisch auf einen Slot ohne den Moment (zweiter schneller Wisch): kalt, volle Abdeckung', () => {
    const v = base();
    v[2] = view({ index: -1 });
    expect(swipePlan(2, v, () => ctx()).coverMs).toBe(WARM_MS + COVER_MARGIN_MS);
  });

  it('eigener Stream als Ziel braucht keine Abdeckung', () => {
    expect(swipePlan(1, base(), (j) => ctx({ youtube: j !== 1 })).coverMs).toBe(0);
  });

  it('der nachrückende Moment läuft nur einmal warm', () => {
    const v = base();
    v[2] = view({ index: 2, warm: 'idle', visited: true });
    expect(swipePlan(1, v, () => ctx()).promote).toBeNull();
    v[2] = view({ index: 2, warm: 'done' });
    expect(swipePlan(1, v, () => ctx()).promote).toBeNull();
  });

  it('Nachfolger ohne YouTube wird nicht angestoßen', () => {
    expect(swipePlan(1, base(), (j) => ctx({ youtube: j !== 2 })).promote).toBeNull();
  });

  it('Wisch zurück von idx 2 auf 1: Zielslot hielt den übernächsten, also kalt. Der verlassene Moment rückt nicht neu nach.', () => {
    // bei idx 2: Slot 2 aktuell (visited), Slot 0 hält 3 (warm fertig), Slot 1 hält 4 (erstes Bild), Moment 1 ist weg
    const v: SlotView[] = [view({ index: 3, warm: 'done' }), view({ index: 4, warm: 'idle' }), view({ index: 2, visited: true })];
    const p = swipePlan(1, v, () => ctx());
    expect(p.target).toBe(1);
    expect(p.coverMs).toBe(WARM_MS + COVER_MARGIN_MS);
    // Nachfolger von 1 ist 2: er war aktuell, kein neuer Warmlauf
    expect(p.promote).toBeNull();
  });

  it('nach zwei Wischen vorwärts hintereinander rotiert der Plan durch alle drei Slots', () => {
    const v = base();
    const p1 = swipePlan(1, v, () => ctx());
    // Zustand nach Wisch 1: Slot 1 aktuell, Slot 2 läuft warm, Slot 0 lädt den Moment 3
    v[1] = { ...v[1], visited: true };
    v[2] = { ...v[2], warm: 'running', warmPlayedMs: 3200 };
    v[0] = view({ index: 3 });
    const p2 = swipePlan(2, v, () => ctx());
    expect([p1.target, p2.target]).toEqual([1, 2]);
    expect(p2.coverMs).toBe(0);
    expect(p2.promote).toBe(0);
  });
});

describe('Netzart und Qualität', () => {
  it('3g, 2g und slow-2g starten klein, 4g und unbekannt nicht', () => {
    expect(slowNet('3g')).toBe(true);
    expect(slowNet('2g')).toBe(true);
    expect(slowNet('slow-2g')).toBe(true);
    expect(slowNet('4g')).toBe(false);
    expect(slowNet(undefined)).toBe(false);
    expect(startQuality('3g')).toBe('small');
    expect(startQuality('4g')).toBeUndefined();
  });
});

describe('Median und p90', () => {
  it('leer ist leer', () => {
    expect(videoStats([])).toEqual({ n: 0, median: null, p90: null });
  });
  it('20 Werte: Median und 90. Perzentil nach nächstem Rang', () => {
    const ms = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    expect(videoStats(ms)).toEqual({ n: 20, median: 1000, p90: 1800 });
  });
  it('Reihenfolge der Eingabe spielt keine Rolle', () => {
    expect(videoStats([900, 100, 500])).toEqual({ n: 3, median: 500, p90: 900 });
  });
});
