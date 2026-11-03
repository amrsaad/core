import { beforeEach, describe, expect, it } from 'vitest';
import { DIAG_LINE_MAX, DIAG_MAX, deviceTag, diagLog, foldDiag, mergeDiag, type DiagEntry } from '../src/lib/diag';
import { applyDoc, canonNoDiag, emptyDoc, mergeDocs, syncedChanged, toDoc } from '../src/lib/sync/merge';
import { emptyState } from '../src/lib/state';

const e = (t: number, d: string, l: string): DiagEntry => ({ t, d, l });
const mulberry = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const randomList = (rnd: () => number, n: number): DiagEntry[] =>
  Array.from({ length: n }, () => e(1_700_000_000_000 + Math.floor(rnd() * 400), ['aaaa', 'bbbb', 'cccc'][Math.floor(rnd() * 3)], `line ${Math.floor(rnd() * 30)}`));

beforeEach(() => diagLog.clear());

describe('Diagnose-Ringpuffer', () => {
  it('hält höchstens 500 Zeilen, die ältesten fallen heraus', () => {
    expect(DIAG_MAX).toBe(500);
    for (let i = 0; i < 620; i++) diagLog.push(`z ${i}`);
    expect(diagLog.entries().length).toBe(500);
    expect(diagLog.raw()[0]).toBe('z 120');
    expect(diagLog.raw()[499]).toBe('z 619');
  });

  it('Copy diagnostics bleibt: lines mit mm:ss, raw ohne Zeitstempel, auch nach über 99 Minuten gleich lang', () => {
    diagLog.push('net: online');
    expect(diagLog.lines()[0]).toMatch(/^\d{2,}:\d{2} net: online$/);
    expect(diagLog.raw()).toEqual(['net: online']);
  });

  it('jede Zeile trägt Zeit und eine Geräte-Kennung mit 4 Zeichen, gleich für alle Zeilen', () => {
    diagLog.push('a');
    diagLog.push('b');
    const [x, y] = diagLog.entries();
    expect(x.d).toMatch(/^[a-z0-9]{4}$/);
    expect(y.d).toBe(x.d);
    expect(x.d).toBe(deviceTag());
    expect(Math.abs(Date.now() - x.t)).toBeLessThan(5000);
  });

  it('kürzt lange Zeilen, damit der Sync-Stand klein bleibt', () => {
    diagLog.push('x'.repeat(1000));
    expect(diagLog.entries()[0].l.length).toBe(DIAG_LINE_MAX);
  });
});

describe('mergeDiag', () => {
  it('ordnet nach Zeit, nimmt gleiche Zeilen nur einmal', () => {
    const a = [e(30, 'aaaa', 'c'), e(10, 'aaaa', 'a')];
    const b = [e(20, 'bbbb', 'b'), e(10, 'aaaa', 'a')];
    expect(mergeDiag(a, b)).toEqual([e(10, 'aaaa', 'a'), e(20, 'bbbb', 'b'), e(30, 'aaaa', 'c')]);
  });

  it('behält die letzten 500, die ältesten fallen heraus', () => {
    const a = Array.from({ length: 400 }, (_, i) => e(1000 + i, 'aaaa', `a${i}`));
    const b = Array.from({ length: 400 }, (_, i) => e(2000 + i, 'bbbb', `b${i}`));
    const m = mergeDiag(a, b)!;
    expect(m.length).toBe(500);
    expect(m[0]).toEqual(e(1300, 'aaaa', 'a300'));
    expect(m[499]).toEqual(e(2399, 'bbbb', 'b399'));
  });

  it('nichts auf beiden Seiten ergibt undefined, Fremdes und Kaputtes wird verworfen', () => {
    expect(mergeDiag(undefined, undefined)).toBeUndefined();
    expect(mergeDiag([], [])).toBeUndefined();
    expect(mergeDiag([{ t: NaN, d: 'x', l: 'y' } as DiagEntry, null as unknown as DiagEntry, e(1, 'aaaa', 'ok')], undefined)).toEqual([e(1, 'aaaa', 'ok')]);
  });

  it('vertauschbar, wiederholbar, gruppierbar (200 zufällige Fälle, 600 Zeilen)', () => {
    const rnd = mulberry(7);
    for (let i = 0; i < 200; i++) {
      const a = randomList(rnd, 300);
      const b = randomList(rnd, 300);
      const c = randomList(rnd, 300);
      const ab = mergeDiag(a, b);
      expect(mergeDiag(b, a)).toEqual(ab);
      expect(mergeDiag(ab, ab)).toEqual(ab);
      expect(mergeDiag(mergeDiag(a, b), c)).toEqual(mergeDiag(a, mergeDiag(b, c)));
      expect(ab!.length).toBeLessThanOrEqual(500);
    }
  });
});

describe('Diagnose im Sync-Stand', () => {
  it('foldDiag legt die Zeilen der Sitzung in den Zustand, ein zweites Mal ändert nichts (gleicher Verweis)', () => {
    diagLog.push('bg: ended A');
    diagLog.push('bg: next B');
    const s0 = emptyState();
    const s1 = foldDiag(s0);
    expect(s1.diag?.map((x) => x.l)).toEqual(['bg: ended A', 'bg: next B']);
    expect(foldDiag(s1)).toBe(s1);
    diagLog.clear();
    expect(foldDiag(s0)).toBe(s0);
  });

  it('toDoc, mergeDocs und applyDoc tragen das Feld, ohne Zeilen bleibt das Dokument wie bisher', () => {
    expect(toDoc(emptyState()).state.diag).toBeUndefined();
    expect('diag' in mergeDocs(emptyDoc(), emptyDoc()).state).toBe(false);
    const a = { ...emptyState(), diag: [e(2, 'aaaa', 'x'), e(1, 'aaaa', 'w')] };
    const b = { ...emptyState(), diag: [e(3, 'bbbb', 'y')] };
    const merged = mergeDocs(toDoc(a), toDoc(b));
    expect(merged.state.diag?.map((x) => x.l)).toEqual(['w', 'x', 'y']);
    const applied = applyDoc(a, merged);
    expect(applied.diag?.map((x) => x.l)).toEqual(['w', 'x', 'y']);
    // gleicher Stand ergibt denselben Verweis, kein unnötiges Neuzeichnen
    expect(applyDoc(applied, merged).diag).toBe(applied.diag);
  });

  it('Diagnose allein löst keinen Sync aus und fehlt im Vergleich ohne Protokoll', () => {
    const a = emptyState();
    const b = { ...a, diag: [e(1, 'aaaa', 'x')] };
    expect(syncedChanged(a, b)).toBe(false);
    expect(canonNoDiag(toDoc(a))).toBe(canonNoDiag(toDoc(b)));
    expect(JSON.stringify(toDoc(b))).not.toBe(JSON.stringify(toDoc(a)));
  });
});
