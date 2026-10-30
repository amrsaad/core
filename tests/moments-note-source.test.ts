import { describe, expect, it } from 'vitest';
import { buildIssue, CHIPS, INPUT_CHIPS, INPUT_MAX, inputConfirm, inputIssue, inputValue, kindOf, makeEntry, makeInputEntry, markSent, nextIssue, splitNotes, TEXT_MAX, unsent, type NoteEntry } from '../src/moments/note';

// Source und Topic im Notizen-Blatt (Entscheidung 20, Max 30.10.2026). Nur Web, kein iOS-Gegenstück.
const ctx = (id: string, hook: string) => ({ id, hook, tab: 'Audio', commit: 'abc1234' });
const A = ctx('abc123:100', 'Sleep beats coffee for recall');
const B = ctx('def456:20', 'Why the cut is late');
const DAY = '2026-10-30';

describe('Source und Topic (Entscheidung 20)', () => {
  it('die sechs Rückmeldungs-Chips bleiben unverändert, Source und Topic sind eigene Chips', () => {
    expect([...CHIPS]).toEqual(['Already known', 'Not for me', 'Weak', 'Wrong', 'Bad cut', 'Mute speaker']);
    expect([...INPUT_CHIPS]).toEqual(['Source', 'Topic']);
    expect(inputConfirm('Source')).toBe('Source noted');
    expect(inputConfirm('Topic')).toBe('Topic noted');
  });

  it('Absenden legt eine Notiz ohne Chip mit Präfix source: bzw. topic: an', () => {
    const s = makeInputEntry(A, 'Source', '  https://example.org/podcast  ', 1)!;
    expect(s).toEqual({ key: 'abc123:100#1', id: 'abc123:100', hook: A.hook, chips: [], text: 'source: https://example.org/podcast', tab: 'Audio', commit: 'abc1234', at: 1 });
    const t = makeInputEntry(A, 'Topic', 'neuro-ophthalmology, papilledema', 2)!;
    expect(t.text).toBe('topic: neuro-ophthalmology, papilledema');
    expect(t.chips).toEqual([]);
  });

  it('leerer Wert gibt keine Notiz, Umbrüche werden ein Leerzeichen, der Wert wird gekürzt', () => {
    expect(makeInputEntry(A, 'Source', '   ', 1)).toBeNull();
    expect(makeInputEntry(A, 'Topic', '\n', 1)).toBeNull();
    expect(makeInputEntry(A, 'Topic', 'line one\nline two', 1)!.text).toBe('topic: line one line two');
    const long = makeInputEntry(A, 'Source', 'x'.repeat(TEXT_MAX + 100), 1)!;
    expect(long.text.length).toBeLessThanOrEqual(TEXT_MAX);
    expect(long.text.length).toBe('source: '.length + INPUT_MAX);
  });

  const fb1 = makeEntry(A, ['Weak'], '', 1)!;
  const src1 = makeInputEntry(A, 'Source', 'https://example.org/podcast', 2)!;
  const top1 = makeInputEntry(B, 'Topic', 'IOL calculation after SMILE', 3)!;
  const fb2 = makeEntry(B, [], 'Cut is late', 4)!;
  const src2 = makeInputEntry(B, 'Source', 'Eyes For Ears', 5)!;
  const list: NoteEntry[] = [fb1, src1, top1, fb2, src2];

  it('Aufteilung nach Präfix: Rückmeldung, Source, Topic, Reihenfolge der Liste bleibt', () => {
    const p = splitNotes(list);
    expect(p.feedback.map((e) => e.key)).toEqual([fb1.key, fb2.key]);
    expect(p.source.map((e) => e.key)).toEqual([src1.key, src2.key]);
    expect(p.topic.map((e) => e.key)).toEqual([top1.key]);
    expect(splitNotes([])).toEqual({ feedback: [], source: [], topic: [] });
  });

  it('Art einer Notiz: Präfix nur ohne Chip, Groß und Klein egal, ohne Wert keine Source', () => {
    expect(kindOf(src1)).toBe('source');
    expect(kindOf(top1)).toBe('topic');
    expect(kindOf(makeEntry(A, [], 'Source: typed by hand', 1)!)).toBe('source');
    expect(kindOf(makeEntry(A, [], '  TOPIC:  sleep', 1)!)).toBe('topic');
    expect(kindOf(makeEntry(A, ['Weak'], 'source: x', 1)!)).toBe('feedback');
    expect(kindOf(makeEntry(A, [], 'source:', 1)!)).toBe('feedback');
    expect(kindOf(makeEntry(A, [], 'The source: was unclear', 1)!)).toBe('feedback');
    expect(inputValue(src1)).toBe('https://example.org/podcast');
  });

  it('das Sammel-Issue enthält keine Source- und Topic-Notizen', () => {
    const b = buildIssue(list, DAY)!;
    expect(b.keys).toEqual([fb1.key, fb2.key]);
    expect(b.rows).toBe(2);
    const body = new URL(b.url).searchParams.get('body')!;
    expect(body).not.toContain('source:');
    expect(body).not.toContain('topic:');
    expect(new URL(b.url).searchParams.get('labels')).toBe('feedback');
    expect(buildIssue([src1, top1], DAY)).toBeNull();
  });

  it('eigenes Issue je Source oder Topic: Titel, Label, Body mit Wert und Herkunft', () => {
    const s = inputIssue(src1);
    const q = new URL(s.url).searchParams;
    expect(s.url.startsWith('https://github.com/amrsaad/core-content/issues/new?title=')).toBe(true);
    expect(s.kind).toBe('source');
    expect(s.keys).toEqual([src1.key]);
    expect(q.get('title')).toBe('source: https://example.org/podcast');
    expect(q.get('labels')).toBe('source');
    expect(q.get('body')).toBe(['https://example.org/podcast', '', 'Heard in: abc123:100', 'Hook: Sleep beats coffee for recall', 'Tab: Audio', 'App: abc1234'].join('\n'));
    const t = inputIssue(top1);
    expect(t.kind).toBe('topic');
    expect(new URL(t.url).searchParams.get('title')).toBe('topic: IOL calculation after SMILE');
    expect(new URL(t.url).searchParams.get('labels')).toBe('topic');
    expect(s.url).not.toMatch(/[ '()!*"<>]/);
  });

  it('langer Wert: Titel höchstens 120 Zeichen, Adresse bleibt unter dem Limit', () => {
    const e = makeInputEntry(ctx('x:1', 'h '.repeat(100)), 'Source', 'y'.repeat(INPUT_MAX), 1)!;
    const b = inputIssue(e);
    expect(new URL(b.url).searchParams.get('title')!.length).toBeLessThanOrEqual(120);
    expect(b.url.length).toBeLessThanOrEqual(7000);
  });

  it('Senden in Reihenfolge: erst das Sammel-Issue, dann Source und Topic, älteste zuerst, je ein Issue pro Tipp', () => {
    let notes = list;
    const seen: { kind?: string; keys: string[] }[] = [];
    for (let i = 0; i < 10; i++) {
      const b = nextIssue(unsent(notes), DAY);
      if (!b) break;
      seen.push({ kind: b.kind, keys: b.keys });
      notes = markSent(notes, b.keys, 100 + i);
    }
    expect(seen).toEqual([
      { kind: 'feedback', keys: [fb1.key, fb2.key] },
      { kind: 'source', keys: [src1.key] },
      { kind: 'topic', keys: [top1.key] },
      { kind: 'source', keys: [src2.key] },
    ]);
    expect(unsent(notes)).toEqual([]);
    expect(nextIssue([], DAY)).toBeNull();
  });

  it('nur Source-Notizen: kein leeres Sammel-Issue', () => {
    const b = nextIssue([src1], DAY)!;
    expect(b.kind).toBe('source');
    expect(new URL(b.url).searchParams.get('labels')).toBe('source');
  });
});
