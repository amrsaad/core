import { describe, expect, it } from 'vitest';
import { RECALL_EVERY } from '../src/moments/recall';
import { gateBack, gateLeave, gateShown, newGate, type Gate } from '../src/moments/recallgate';
import { emptyState } from '../src/lib/state';
import { applyDoc, mergeDocs, toDoc } from '../src/lib/sync/merge';
import { DAY_MS, skipCard } from '../src/moments/recall';

/** Spielt Wechsel durch: 'p' = im Vordergrund gespielt, 'b' = im Hintergrund oder nie gespielt, 'R' = Rückkehr aus dem Hintergrund. Gibt die Wechsel zurück, bei denen eine Karte kommt. */
function run(steps: string): { cards: number[]; held: number[]; gate: Gate } {
  let g = newGate();
  const cards: number[] = [];
  const held: number[] = [];
  steps.split('').forEach((c, i) => {
    if (c === 'R') {
      g = gateBack(g);
      return;
    }
    const r = gateLeave(g, c === 'p');
    g = r.gate;
    if (r.held) held.push(i);
    if (r.due) {
      cards.push(i);
      g = gateShown(g); // der Aufrufer zeigt die Karte
    }
  });
  return { cards, held, gate: g };
}

describe('Abstand der Abrufkarten (Runde 34)', () => {
  it('9 gespielte Momente: keine Karte, der 10. bringt sie', () => {
    expect(run('p'.repeat(9)).cards).toEqual([]);
    expect(run('p'.repeat(10)).cards).toEqual([9]);
  });
  it('Hintergrund und nie gespielte Momente zählen nicht', () => {
    expect(run('p'.repeat(9) + 'b'.repeat(20)).cards).toEqual([]);
    expect(run('pppp' + 'b'.repeat(15) + 'ppppp').cards).toEqual([]);
    expect(run('pppp' + 'b'.repeat(15) + 'pppppp').cards).toEqual([24]);
  });
  it('nie zwei Karten näher als 10 gespielte Momente, auch bei vielen fälligen Wiedervorlagen', () => {
    const { cards } = run('p'.repeat(100));
    expect(cards.length).toBe(10);
    for (let i = 1; i < cards.length; i++) expect(cards[i] - cards[i - 1]).toBeGreaterThanOrEqual(RECALL_EVERY);
    // mit eingestreutem Hintergrund bleibt der Abstand in gespielten Momenten
    const mixed = run(('p'.repeat(6) + 'bb').repeat(20));
    for (let i = 1; i < mixed.cards.length; i++) {
      const between = ('p'.repeat(6) + 'bb').repeat(20).slice(mixed.cards[i - 1] + 1, mixed.cards[i] + 1).split('p').length - 1;
      expect(between).toBeGreaterThanOrEqual(RECALL_EVERY);
    }
  });
  it('keine Karte bei der Rückkehr, erst nach einem im Vordergrund gehörten Moment', () => {
    // 10 gespielt, Karte war nicht zeigbar (Zähler bleibt), Rückkehr, Wechsel ohne Vordergrund-Hören: gehalten
    let g: Gate = { played: 10, hold: false };
    g = gateBack(g);
    const noHear = gateLeave(g, false);
    expect(noHear.due).toBe(false);
    expect(noHear.held).toBe(true);
    // der nächste Moment wird im Vordergrund gehört: beim Verlassen kommt die Karte
    const heard = gateLeave(noHear.gate, true);
    expect(heard.due).toBe(true);
    expect(heard.held).toBe(false);
  });
  it('Rückkehr ohne fälligen Abstand ändert nichts am Zähler', () => {
    const g = gateBack({ played: 3, hold: false });
    expect(g.played).toBe(3);
    const r = gateLeave(g, true);
    expect(r.gate).toEqual({ played: 4, hold: false });
    expect(r.due).toBe(false);
  });
  it('nicht zeigbare Karte (Settings, Hintergrund) bleibt fällig und wird nicht vorgemerkt', () => {
    let g: Gate = { played: 9, hold: false };
    const a = gateLeave(g, true);
    expect(a.due).toBe(true);
    g = a.gate; // Aufrufer konnte nicht zeigen: kein gateShown
    expect(gateLeave(g, true).due).toBe(true);
    expect(gateLeave(g, true).gate.played).toBe(11);
  });
});

describe('Dieselbe Karte am selben Tag höchstens einmal (Runde 34)', () => {
  it('weggewischt, wieder wegwischen am selben Tag nicht möglich, weil sie erst morgen fällig ist', () => {
    const T = 1_800_000_000_000;
    let r = skipCard({}, 'm', T);
    for (let h = 0; h < 24; h++) expect(r.m.due as number).toBeGreaterThan(T + h * 3_600_000);
    r = skipCard(r, 'm', T + DAY_MS);
    expect(r.m.due).toBe(T + 2 * DAY_MS);
    // am selben Kalendertag in jeder Zeitzone liegt die nächste Fälligkeit mindestens 24 h später
    expect((r.m.due as number) - (T + DAY_MS)).toBeGreaterThanOrEqual(DAY_MS);
  });
});

describe('Sync: weggewischte Erstkarte ohne Ergebnisse', () => {
  it('alter Zustand ohne Eintrag lädt, Eintrag mit leeren Ergebnissen wird zusammengeführt, die spätere Fälligkeit gewinnt', () => {
    const T = 1_800_000_000_000;
    const a = emptyState();
    const b = { ...emptyState(), recall: skipCard({}, 'm', T) };
    const da = toDoc(a);
    const db = toDoc(b);
    const merged = mergeDocs(da, db);
    expect(merged.state.recall.m).toEqual({ id: 'm', due: T + DAY_MS, results: [] });
    // Reihenfolge egal
    expect(mergeDocs(db, da).state.recall.m).toEqual(merged.state.recall.m);
    // zwei Geräte wischen weg, das spätere Datum gilt, nichts geht verloren
    const c = { ...emptyState(), recall: skipCard({}, 'm', T + 3600_000) };
    expect(mergeDocs(db, toDoc(c)).state.recall.m.due).toBe(T + 3600_000 + DAY_MS);
    // und auf den Zustand angewendet
    expect(applyDoc(emptyState(), merged).recall?.m?.due).toBe(T + DAY_MS);
  });
});
