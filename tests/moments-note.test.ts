import { describe, expect, it } from 'vitest';
import { CHIPS, deviceLine, enc, issueBody, issueUrl, noteEffect, TEXT_MAX, toggleChip, type NoteContext } from '../src/moments/note';

// Gleiche Prüfdaten in ios/CoreTests/Round1Tests.swift (testNote)
export const CTX: NoteContext = {
  id: 'abc123:100',
  videoId: 'abc123',
  start: 100,
  end: 160.4,
  channel: 'Sigma Nutrition (Prof. Grant Tinsley)',
  sourceUrl: 'https://www.youtube.com/watch?v=abc123&t=100',
  area: 'Body',
  tab: 'Video',
  speed: 1.5,
  device: 'iPhone, iOS 18.1',
  commit: '4ed41a7',
  hook: "Don't compare body fat across devices (100% rule)!",
};

describe('Rückmeldung (Aufgabe 5)', () => {
  it('sieben Chips in fester Reihenfolge', () => {
    expect([...CHIPS]).toEqual(['Known', 'Boring', 'Wrong', 'Bad cut', 'Bad audio', 'Bad captions', 'Great']);
  });
  it('Chips schalten mehrfach um, Reihenfolge bleibt die der Liste', () => {
    let c = toggleChip([], 'Great');
    c = toggleChip(c, 'Known');
    expect(c).toEqual(['Known', 'Great']);
    c = toggleChip(c, 'Great');
    expect(c).toEqual(['Known']);
  });
  it('Wrong und Known wirken wie das Menü, Wrong geht vor Known, andere Chips wirken nicht', () => {
    expect(noteEffect(['Known'])).toBe('kenne');
    expect(noteEffect(['Known', 'Wrong'])).toBe('falsch');
    expect(noteEffect(['Boring', 'Bad cut', 'Great'])).toBeNull();
    expect(noteEffect([])).toBeNull();
  });
  it('Text der Issue: alle Felder, Chips, Freitext', () => {
    expect(issueBody(CTX, ['Known', 'Bad cut'], '  Cut is two seconds late.  ')).toBe(
      [
        'Moment: abc123:100',
        'Video: abc123',
        'Start: 100 s',
        'End: 160 s',
        'Source: Sigma Nutrition (Prof. Grant Tinsley), https://www.youtube.com/watch?v=abc123&t=100',
        'Area: Body',
        'Tab: Video',
        'Speed: 1.5x',
        'Device: iPhone, iOS 18.1',
        'App: 4ed41a7',
        'Chips: Known, Bad cut',
        '',
        'Cut is two seconds late.',
      ].join('\n'),
    );
    expect(issueBody({ ...CTX, speed: 1 }, [], '')).toContain('Speed: 1x');
    expect(issueBody(CTX, [], '')).toContain('Chips: none');
    expect(issueBody(CTX, [], 'x'.repeat(TEXT_MAX + 50)).split('\n').pop()!.length).toBe(TEXT_MAX);
  });
  it('Adresse: github.com/amrsaad/core-content/issues/new mit title, body und Label feedback', () => {
    const u = issueUrl(CTX, ['Known', 'Bad cut'], 'Cut is two seconds late.');
    expect(u.startsWith('https://github.com/amrsaad/core-content/issues/new?title=')).toBe(true);
    expect(u.endsWith('&labels=feedback')).toBe(true);
    const q = new URL(u).searchParams;
    expect(q.get('title')).toBe(CTX.hook);
    expect(q.get('labels')).toBe('feedback');
    expect(q.get('body')).toBe(issueBody(CTX, ['Known', 'Bad cut'], 'Cut is two seconds late.'));
    expect(u).toBe(
      'https://github.com/amrsaad/core-content/issues/new?title=Don%27t%20compare%20body%20fat%20across%20devices%20%28100%25%20rule%29%21&body=Moment%3A%20abc123%3A100%0AVideo%3A%20abc123%0AStart%3A%20100%20s%0AEnd%3A%20160%20s%0ASource%3A%20Sigma%20Nutrition%20%28Prof.%20Grant%20Tinsley%29%2C%20https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123%26t%3D100%0AArea%3A%20Body%0ATab%3A%20Video%0ASpeed%3A%201.5x%0ADevice%3A%20iPhone%2C%20iOS%2018.1%0AApp%3A%204ed41a7%0AChips%3A%20Known%2C%20Bad%20cut%0A%0ACut%20is%20two%20seconds%20late.&labels=feedback',
    );
    // keine unkodierten Sonderzeichen in der Adresse
    expect(u).not.toMatch(/[ '()!*"<>]/);
    expect(enc("a b&c=d+e'(f)!*")).toBe('a%20b%26c%3Dd%2Be%27%28f%29%21%2A');
  });
  it('Gerätezeile aus dem User-Agent', () => {
    expect(deviceLine('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('iPhone, iOS 17.5, Safari');
    expect(deviceLine('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36')).toBe('Android 14, Chrome');
  });
});
