import { describe, expect, it } from 'vitest';
import { ASK_BASE, ASK_ENCODED_MAX, ASK_MAX, askPrompt, askUrl, clip, EXCERPT_MAX, markAsked } from '../src/moments/ask';
import { validateMoments } from '../src/moments/contract';
import { deskKey, HELP_ROWS, type DeskCtx } from '../src/moments/desktop';
import { signal } from '../src/moments/learn';
import { SIGNAL } from '../src/moments/mix';
import { emptyState } from '../src/lib/state';
import { applyDoc, emptyDoc, mergeDocs, stampChanges, syncedChanged, toDoc, tsKey, type SyncDoc } from '../src/lib/sync/merge';
import { buildAliasIndex, migrateDoc } from '../src/moments/aliases';
import type { Moment } from '../src/moments/types';

const base: Moment = {
  id: 'abc123xyz_A:754',
  videoId: 'abc123xyz_A',
  start: 754,
  end: 800,
  channel: 'Sigma Nutrition (Prof. Grant Tinsley)',
  videoTitle: 'Protein timing',
  area: 'body',
  topic: 'protein',
  hook: 'Protein timing barely matters',
  kind: 'regel',
  excerpt: 'First sentence.\nSecond sentence.',
  context: 'Two sentences of context. They name a term.',
  createdAt: '2026-10-20T00:00:00Z',
};

const q = (url: string) => url.slice(ASK_BASE.length);

describe('Ask: Prompt', () => {
  it('baut die Zeilen in fester Reihenfolge und endet mit "My question: "', () => {
    expect(askPrompt(base)).toBe(
      [
        'Core moment from Sigma Nutrition (Prof. Grant Tinsley), Protein timing, at 12:34.',
        'Hook: Protein timing barely matters',
        'Excerpt: First sentence. Second sentence.',
        'Context: Two sentences of context. They name a term.',
        'Source: https://www.youtube.com/watch?v=abc123xyz_A&t=754',
        '',
        'My question: ',
      ].join('\n'),
    );
  });

  it('fehlende Felder entfallen, die Zeilen davor und danach bleiben', () => {
    const m: Moment = { ...base, context: undefined, excerpt: undefined, videoTitle: '', videoId: 'pod-123', hls: 'https://x.test/a.m3u8', form: 'audio' };
    expect(askPrompt(m)).toBe('Core moment from Sigma Nutrition (Prof. Grant Tinsley), at 12:34.\nHook: Protein timing barely matters\n\nMy question: ');
  });

  it('ohne Ausschnitt dienen die Untertitel als Ausschnitt, leerer Kontext zählt als fehlend', () => {
    const p = askPrompt({ ...base, excerpt: undefined, context: '   ', cues: [[0, 'Line one,'], [2, 'line two.']] });
    expect(p).toContain('\nExcerpt: Line one, line two.\n');
    expect(p).not.toContain('Context:');
  });

  it('Text-Momente haben keine Stelle, die Quelle ist die sourceUrl', () => {
    const p = askPrompt({ ...base, form: 'text', videoId: 'txt-1', start: 0, end: 0, sourceUrl: 'https://example.org/a', videoTitle: 'Article' });
    expect(p.split('\n')[0]).toBe('Core moment from Sigma Nutrition (Prof. Grant Tinsley), Article.');
    expect(p).toContain('\nSource: https://example.org/a\n');
  });

  it('Stunden stehen als h:mm:ss', () => {
    expect(askPrompt({ ...base, start: 3723 }).split('\n')[0]).toContain('at 1:02:03.');
  });

  it('der Ausschnitt ist auf 600 Zeichen gekürzt, mit Auslassungspunkt, ohne Zeilenumbruch', () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join('\n');
    const line = askPrompt({ ...base, excerpt: long }).split('\n').find((l) => l.startsWith('Excerpt: '))!;
    const ex = line.slice('Excerpt: '.length);
    expect(Array.from(ex).length).toBeLessThanOrEqual(EXCERPT_MAX);
    expect(ex.endsWith('…')).toBe(true);
    expect(ex).not.toContain('\n');
  });

  it('bleibt auch bei übergroßen Feldern unter 1500 Zeichen, Hook und Ende bleiben', () => {
    const w = (n: number) => Array.from({ length: n }, (_, i) => `term${i}`).join(' ');
    const m: Moment = { ...base, hook: w(60), videoTitle: w(40), excerpt: w(400), context: w(300) };
    const p = askPrompt(m);
    expect(p.length).toBeLessThan(ASK_MAX);
    expect(encodeURIComponent(p).length).toBeLessThanOrEqual(ASK_ENCODED_MAX);
    expect(p).toContain(`Hook: ${w(60)}`);
    expect(p.endsWith('\n\nMy question: ')).toBe(true);
  });

  it('Arabisch: Prompt unter 1500 Zeichen und die Adresse bleibt kurz genug', () => {
    const ar = 'وما من قلب إلا وهو بين إصبعين من أصابع الرحمن '.repeat(60);
    const m: Moment = { ...base, excerpt: ar, context: ar };
    const p = askPrompt(m);
    expect(p.length).toBeLessThan(ASK_MAX);
    expect(q(askUrl(m)).length).toBeLessThanOrEqual(ASK_ENCODED_MAX);
    // Der Ausschnitt ist der Kern: er bleibt voll (600 Zeichen), zuerst schrumpft der Kontext
    const ex = p.split('\n').find((l) => l.startsWith('Excerpt: '))!;
    expect(Array.from(ex.slice('Excerpt: '.length)).length).toBeGreaterThan(EXCERPT_MAX - 5);
    expect(p).toContain('\nContext: وما من قلب');
    expect(p.endsWith('My question: ')).toBe(true);
  });

  it('kürzt nie mitten in einem Zeichenpaar', () => {
    const c = clip('😀'.repeat(20), 7);
    expect(Array.from(c).length).toBeLessThanOrEqual(7);
    expect(c).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(clip('short', 10)).toBe('short');
    expect(clip('abc', 0)).toBe('');
  });
});

describe('Ask: Adresse', () => {
  it('beginnt mit claude.ai/new?q= und enthält den Prompt vollständig codiert', () => {
    const m: Moment = { ...base, hook: 'Q&A #1: 100% + more? "yes"', excerpt: 'a=b & c#d' };
    const url = askUrl(m);
    expect(url.startsWith('https://claude.ai/new?q=')).toBe(true);
    const query = q(url);
    expect(query).not.toMatch(/[\s&#"+]/);
    expect(decodeURIComponent(query)).toBe(askPrompt(m));
    expect(new URL(url).searchParams.get('q')).toBe(askPrompt(m));
  });

  it('der Hook steht in der Adresse', () => {
    expect(decodeURIComponent(q(askUrl(base)))).toContain('Hook: Protein timing barely matters');
  });
});

describe('Ask: Lernsignal und Zustand', () => {
  const now = 1_800_000_000_000;
  it('der erste Ask zählt wie More (1,3) und setzt askedAt, das Herz bleibt unberührt', () => {
    expect(SIGNAL.more).toBe(1.3);
    const s0 = emptyState();
    const s1 = markAsked(s0, base, 5_000, now);
    expect(s1.momentAsked).toEqual({ [base.id]: 5_000 });
    expect(s1.momentWeights).toEqual(signal(s0.momentWeights, base, SIGNAL.more, now));
    expect(s1.momentWeights).not.toEqual(s0.momentWeights);
    expect(s1.momentLiked).toBeUndefined();
  });

  it('jeder weitere Ask setzt nur die Zeit neu, die Gewichte ändern sich nicht noch einmal', () => {
    const s1 = markAsked(emptyState(), base, 5_000, now);
    const s2 = markAsked(s1, base, 9_000, now + 1);
    expect(s2.momentAsked).toEqual({ [base.id]: 9_000 });
    expect(s2.momentWeights).toBe(s1.momentWeights);
  });

  it('ein anderer Moment bekommt sein eigenes Signal', () => {
    const s1 = markAsked(emptyState(), base, 5_000, now);
    const other: Moment = { ...base, id: 'zzz123xyz_B:10', videoId: 'zzz123xyz_B' };
    const s2 = markAsked(s1, other, 6_000, now);
    expect(Object.keys(s2.momentAsked!).sort()).toEqual([base.id, other.id].sort());
    expect(s2.momentWeights).not.toEqual(s1.momentWeights);
  });
});

describe('Context: Vertrag', () => {
  const run = (extra: object) => validateMoments([{ ...base, hls: undefined, ...extra }]);
  it('ein Text bleibt erhalten', () => {
    expect(run({}).moments[0].context).toBe(base.context);
  });
  it('fehlt das Feld, bleibt der Moment gültig und ohne Feld', () => {
    const r = run({ context: undefined });
    expect(r.skipped).toBe(0);
    expect('context' in r.moments[0] && r.moments[0].context !== undefined).toBe(false);
  });
  it('ein Feld mit falschem Typ wird entfernt, der Moment bleibt', () => {
    const r = run({ context: 42 });
    expect(r.skipped).toBe(0);
    expect(r.moments[0].context).toBeUndefined();
  });
});

describe('Ask: Taste A', () => {
  const ctx: DeskCtx = { typing: false, help: false, sheet: false, note: false, recall: null };
  const k = (key: string) => ({ key, code: `Key${key.toUpperCase()}`, shift: false, ctrl: false, meta: false, alt: false });
  it('A fragt im Feed und bei offenem Blatt, nicht beim Tippen und nicht bei der Abrufkarte', () => {
    expect(deskKey(ctx, k('a'))).toBe('ask');
    expect(deskKey({ ...ctx, note: true }, k('a'))).toBe('ask');
    expect(deskKey({ ...ctx, note: true, typing: true }, k('a'))).toBeNull();
    expect(deskKey({ ...ctx, recall: 'open' }, k('a'))).toBeNull();
    expect(deskKey(ctx, { ...k('a'), ctrl: true })).toBeNull();
  });
  it('die Übersicht nennt die Taste', () => {
    expect(HELP_ROWS.some((r) => r.keys === 'A' && /Ask/.test(r.text))).toBe(true);
  });
});

describe('askedAt: Sync', () => {
  const doc = (state: Partial<SyncDoc['state']> = {}, ts: Record<string, number> = {}): SyncDoc => {
    const d = emptyDoc();
    return { ...d, state: { ...d.state, ...state }, ts };
  };

  it('Zusammenführen: beide Seiten bringen etwas mit, die spätere Zeit gewinnt, in beide Richtungen', () => {
    const a = doc({ momentAsked: { m1: 100, m2: 50 } }, { [tsKey.asked('m1')]: 100, [tsKey.asked('m2')]: 50 });
    const b = doc({ momentAsked: { m1: 200, m3: 70 } }, { [tsKey.asked('m1')]: 200, [tsKey.asked('m3')]: 70 });
    const expected = { m1: 200, m2: 50, m3: 70 };
    expect(mergeDocs(a, b).state.momentAsked).toEqual(expected);
    expect(mergeDocs(b, a).state.momentAsked).toEqual(expected);
  });

  it('alter Stand ohne das Feld verliert nichts', () => {
    const old = doc();
    delete (old.state as Partial<SyncDoc['state']>).momentAsked;
    const a = doc({ momentAsked: { m1: 100 } }, { [tsKey.asked('m1')]: 100 });
    expect(mergeDocs(a, old).state.momentAsked).toEqual({ m1: 100 });
    expect(mergeDocs(old, a).state.momentAsked).toEqual({ m1: 100 });
  });

  it('Zustand zu Dokument und zurück, Zeitstempel wird gesetzt, Änderung wird erkannt', () => {
    const s0 = emptyState();
    const s1 = markAsked(s0, base, 5_000, 6_000);
    expect(syncedChanged(s0, s1)).toBe(true);
    const stamped = stampChanges(s0, s1, 7_000);
    expect(stamped.syncTs?.[tsKey.asked(base.id)]).toBe(7_000);
    const d = toDoc(stamped);
    expect(d.state.momentAsked).toEqual({ [base.id]: 5_000 });
    const s2 = applyDoc(emptyState(), d);
    expect(s2.momentAsked).toEqual({ [base.id]: 5_000 });
  });

  it('neue ID nach Neueinordnung: askedAt zieht mit um (Alias)', () => {
    const OLD = 'pod-x-1:614.5';
    const NEW = 'pod-x-1:586.49';
    const fresh: Moment = { ...base, id: NEW, videoId: 'pod-x-1', start: 586.49, aliases: [OLD], form: 'audio', hls: 'https://x.test/a.mp3' };
    const d = doc({ momentAsked: { [OLD]: 900 } }, { [tsKey.asked(OLD)]: 900 });
    const m = migrateDoc(d, buildAliasIndex([fresh]));
    expect(m.state.momentAsked).toEqual({ [NEW]: 900 });
    expect(m.ts[tsKey.asked(NEW)]).toBe(900);
    expect(m.ts[tsKey.asked(OLD)]).toBeUndefined();
  });
});
