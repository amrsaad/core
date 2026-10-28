import { describe, expect, it } from 'vitest';
import { buildIssue, CHIPS, chipEffect, enc, firstOpenOfDay, makeEntry, markSent, promptLine, rows, shouldPrompt, TEXT_MAX, unsent, URL_MAX, type NoteEntry } from '../src/moments/note';

// Gleiche Prüfdaten in ios/CoreTests/Round1Tests.swift (testNote)
const ctx = (id: string, hook: string) => ({ id, hook, tab: 'Video', commit: '4ed41a7' });
const A = ctx('abc123:100', "Don't compare body fat across devices (100% rule)!");
const B = ctx('def456:20', 'Sleep | not coffee');

describe('Rückmeldung (Auftrag 27.10.2026)', () => {
  it('sieben Chips in fester Reihenfolge', () => {
    expect([...CHIPS]).toEqual(['Known', 'Not for me', 'Wrong', 'Boring', 'Bad cut', 'Great', 'Mute speaker']);
  });
  it('Known, Wrong und Mute wirken, die anderen speichern nur', () => {
    expect(chipEffect('Known')).toBe('kenne');
    expect(chipEffect('Wrong')).toBe('falsch');
    expect(chipEffect('Mute speaker')).toBe('mute');
    expect(chipEffect('Not for me')).toBe('thema');
    expect(['Boring', 'Bad cut', 'Great'].map((c) => chipEffect(c as never))).toEqual([null, null, null]);
  });
  it('Notiz aus Chip oder Text, ohne beides keine Notiz, Text gekürzt und getrimmt', () => {
    expect(makeEntry(A, [], '  ', 1)).toBeNull();
    const e = makeEntry(A, ['Great'], '  Clear.  ', 1700000000000)!;
    expect(e).toEqual({ key: 'abc123:100#1700000000000', id: 'abc123:100', hook: A.hook, chips: ['Great'], text: 'Clear.', tab: 'Video', commit: '4ed41a7', at: 1700000000000 });
    expect(makeEntry(A, [], 'Late cut', 1)!.chips).toEqual([]);
    expect(makeEntry(A, [], 'x'.repeat(TEXT_MAX + 50), 1)!.text.length).toBe(TEXT_MAX);
  });
  it('Zeile "N notes, send?" einmal pro Tag und nur mit ungesendeten Notizen', () => {
    expect(promptLine(1)).toBe('1 note, send?');
    expect(promptLine(3)).toBe('3 notes, send?');
    expect(shouldPrompt(2, undefined, '2026-10-28')).toBe(true);
    expect(shouldPrompt(2, '2026-10-27', '2026-10-28')).toBe(true);
    expect(shouldPrompt(2, '2026-10-28', '2026-10-28')).toBe(false);
    expect(shouldPrompt(0, undefined, '2026-10-28')).toBe(false);
    expect(firstOpenOfDay(undefined, '2026-10-28')).toBe(true);
    expect(firstOpenOfDay('2026-10-27', '2026-10-28')).toBe(true);
    expect(firstOpenOfDay('2026-10-28', '2026-10-28')).toBe(false);
  });
  const list: NoteEntry[] = [
    makeEntry(A, ['Known'], '', 1)!,
    makeEntry(B, [], 'Cut is\ntwo seconds late', 2)!,
    makeEntry(A, ['Bad cut'], 'Starts mid-sentence', 3)!,
  ];
  it('Notizen zum selben Moment werden eine Zeile, Chips in Listenreihenfolge, Texte mit Schrägstrich', () => {
    const r = rows(list);
    expect(r.length).toBe(2);
    expect(r[0]).toMatchObject({ id: 'abc123:100', chips: ['Known', 'Bad cut'], text: 'Starts mid-sentence', keys: ['abc123:100#1', 'abc123:100#3'] });
    expect(r[1]).toMatchObject({ id: 'def456:20', chips: [], text: 'Cut is\ntwo seconds late' });
  });
  it('ein einziges Issue: Titel, Tabelle mit Moment-ID, Hook, Chips, Text, Reiter, App-Commit, Label feedback', () => {
    const b = buildIssue(list, '2026-10-28')!;
    expect(b.rows).toBe(2);
    expect(b.keys).toEqual(['abc123:100#1', 'abc123:100#3', 'def456:20#2']);
    const q = new URL(b.url).searchParams;
    expect(b.url.startsWith('https://github.com/amrsaad/core-content/issues/new?title=')).toBe(true);
    expect(q.get('title')).toBe('Core feedback 2026-10-28, 2 moments');
    expect(q.get('labels')).toBe('feedback');
    expect(q.get('body')).toBe(
      [
        '| Moment | Hook | Chips | Text | Tab | App |',
        '|---|---|---|---|---|---|',
        "| abc123:100 | Don't compare body fat across devices (100% rule)! | Known, Bad cut | Starts mid-sentence | Video | 4ed41a7 |",
        '| def456:20 | Sleep / not coffee | - | Cut is two seconds late | Video | 4ed41a7 |',
      ].join('\n'),
    );
    expect(b.url).toBe(
      'https://github.com/amrsaad/core-content/issues/new?title=Core%20feedback%202026-10-28%2C%202%20moments&body=%7C%20Moment%20%7C%20Hook%20%7C%20Chips%20%7C%20Text%20%7C%20Tab%20%7C%20App%20%7C%0A%7C---%7C---%7C---%7C---%7C---%7C---%7C%0A%7C%20abc123%3A100%20%7C%20Don%27t%20compare%20body%20fat%20across%20devices%20%28100%25%20rule%29%21%20%7C%20Known%2C%20Bad%20cut%20%7C%20Starts%20mid-sentence%20%7C%20Video%20%7C%204ed41a7%20%7C%0A%7C%20def456%3A20%20%7C%20Sleep%20%2F%20not%20coffee%20%7C%20-%20%7C%20Cut%20is%20two%20seconds%20late%20%7C%20Video%20%7C%204ed41a7%20%7C&labels=feedback',
    );
    expect(b.url).not.toMatch(/[ '()!*"<>]/);
    expect(enc("a b&c=d+e'(f)!*")).toBe('a%20b%26c%3Dd%2Be%27%28f%29%21%2A');
  });
  it('ohne Notizen kein Issue, Einzahl im Titel', () => {
    expect(buildIssue([], '2026-10-28')).toBeNull();
    expect(new URL(buildIssue([list[0]], '2026-10-28')!.url).searchParams.get('title')).toBe('Core feedback 2026-10-28, 1 moment');
  });
  it('zu viele Notizen: so viele Zeilen wie in die Adresse passen, der Rest bleibt ungesendet', () => {
    const many = Array.from({ length: 60 }, (_, i) => makeEntry(ctx(`vid${i}:0`, `Hook number ${i} `.repeat(4)), ['Boring'], 'y'.repeat(300), i + 10)!);
    const b = buildIssue(many, '2026-10-28')!;
    expect(b.url.length).toBeLessThanOrEqual(URL_MAX);
    expect(b.rows).toBeGreaterThan(5);
    expect(b.rows).toBeLessThan(60);
    expect(b.keys).toEqual(many.slice(0, b.rows).map((e) => e.key));
    const left = unsent(markSent(many, b.keys, 99));
    expect(left.length).toBe(60 - b.rows);
    expect(left[0].key).toBe(many[b.rows].key);
  });
  it('gesendet markieren, alte gesendete Notizen fallen nach 30 Tagen heraus', () => {
    const day = 86_400_000;
    const old = { ...list[0], sent: 1_000_000 };
    const out = markSent([old, list[1]], [list[1].key], 1_000_000 + 31 * day);
    expect(out.map((e) => e.key)).toEqual([list[1].key]);
    expect(out[0].sent).toBe(1_000_000 + 31 * day);
    expect(unsent(out)).toEqual([]);
    expect(unsent(undefined)).toEqual([]);
  });
});
