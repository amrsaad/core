import { describe, expect, it } from 'vitest';
import { actionTap, contradictionTap, countList, dueDate, lastDigestLine, openActions, parseLatest, setTap, shortDate, tapKey, type DigestLatest } from '../src/moments/digest';

const counts = { action: 2, habit: 0, rule: 4, know: 9, research: 1, content: 1, script: 1, source: 1, contradiction: 0 };
const latest: DigestLatest = {
  v: 1,
  week: '2026-W44',
  generatedAt: '2026-10-29T17:19:16.000Z',
  saves: 13,
  counts,
  actions: [
    { id: 'm1', title: 'Record a short talk opening twice, once from the chest', metric: 'Both recordings exist', due: '2026-11-09', url: 'https://example.org/a' },
    { id: 'm2', title: 'Check the disclosure', metric: 'One yes or no answer', due: '2026-11-16', url: null },
  ],
  contradictions: [{ id: 'm3', otherId: 'm9', question: 'Which one holds?', a: 'New save', b: 'Old save' }],
};

describe('Wochenkarte (Core Digest)', () => {
  it('parseLatest übernimmt eine gültige Datei und füllt fehlende Zahlen mit 0', () => {
    expect(parseLatest(JSON.parse(JSON.stringify(latest)))).toEqual(latest);
    const p = parseLatest({ v: 1, week: '2026-W45', generatedAt: '2026-11-05T05:00:00Z', saves: 2, counts: { know: 2, rule: 'x' } });
    expect(p?.counts.know).toBe(2);
    expect(p?.counts.rule).toBe(0);
    expect(p?.actions).toEqual([]);
  });
  it('parseLatest lehnt Unbrauchbares ab, nimmt aber nur ganze Einträge', () => {
    for (const bad of [null, 5, {}, { v: 2, week: 'x', generatedAt: '2026-11-05T05:00:00Z' }, { v: 1, week: 'x', generatedAt: 'kein Datum' }, { v: 1, generatedAt: '2026-11-05T05:00:00Z' }]) expect(parseLatest(bad)).toBeNull();
    const p = parseLatest({ ...latest, actions: [{ id: 'ok', title: 't', metric: 'm', due: '2026-11-09' }, { id: 'kaputt' }, null], contradictions: [{ id: 'x' }] });
    expect(p?.actions.map((a) => a.id)).toEqual(['ok']);
    expect(p?.actions[0].url).toBeNull();
    expect(p?.contradictions).toEqual([]);
  });
  it('Zahlen je Art in fester Reihenfolge, nur größer 0', () => {
    expect(countList(latest).map((c) => `${c.kind} ${c.n}`)).toEqual(['action 2', 'rule 4', 'know 9', 'research 1', 'content 1', 'script 1', 'source 1']);
  });
  it('Taps: Done oder Drop für Actions, A oder B für Widersprüche, nichts anderes, Änderung möglich', () => {
    let t = setTap(undefined, tapKey.action('m1'), 'done', 100);
    expect(t).toEqual({ 'a:m1': { choice: 'done', at: 100 } });
    expect(setTap(t, tapKey.action('m1'), 'done', 200)).toBe(t);
    t = setTap(t, tapKey.action('m1'), 'drop', 300);
    expect(actionTap(t, 'm1')).toBe('drop');
    expect(t['a:m1'].at).toBe(300);
    expect(setTap(t, tapKey.action('m2'), 'a', 1)).toBe(t);
    expect(setTap(t, tapKey.contradiction('m3'), 'done', 1)).toBe(t);
    expect(setTap(t, 'x:m3', 'a', 1)).toBe(t);
    t = setTap(t, tapKey.contradiction('m3'), 'b', 400);
    expect(contradictionTap(t, 'm3')).toBe('b');
  });
  it('offene Actions: ohne Tap', () => {
    expect(openActions(latest, undefined)).toBe(2);
    expect(openActions(latest, { 'a:m1': { choice: 'done', at: 1 } })).toBe(1);
    expect(openActions(latest, { 'a:m1': { choice: 'drop', at: 1 }, 'a:m2': { choice: 'done', at: 1 }, 'c:m3': { choice: 'a', at: 1 } })).toBe(0);
    expect(openActions(undefined, undefined)).toBe(0);
  });
  it('Zeile in den Einstellungen', () => {
    const d = new Date(latest.generatedAt);
    const expectDate = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`;
    expect(shortDate(latest.generatedAt)).toBe(expectDate);
    expect(lastDigestLine(latest, undefined)).toBe(`Last digest: ${expectDate}, 2 actions open`);
    expect(lastDigestLine(latest, { 'a:m1': { choice: 'done', at: 1 } })).toBe(`Last digest: ${expectDate}, 1 action open`);
    expect(lastDigestLine(undefined, undefined)).toBe('Last digest: none yet');
    expect(dueDate('2026-11-09')).toBe('Nov 9');
    expect(dueDate('kein Datum')).toBe('kein Datum');
  });
});
