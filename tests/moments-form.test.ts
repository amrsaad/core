import { describe, expect, it } from 'vitest';
import { emptyFormLine, filterPool, FORMS, momentText, textEndReached } from '../src/moments/form';

describe('Formwahl (Runde 1, Punkt 3)', () => {
  it('drei Stellungen in fester Reihenfolge', () => expect(FORMS).toEqual(['video', 'audio', 'text']));
  it('Text ist der Ausschnitt, Zeilenumbrüche bleiben', () => {
    expect(momentText({ excerpt: ' Satz eins.\nSatz zwei. ', cues: [[0, 'x']] })).toBe('Satz eins.\nSatz zwei.');
  });
  it('ohne Ausschnitt die Untertitel als Fließtext', () => {
    expect(momentText({ cues: [[0, 'Eins,'], [2, ' zwei  drei.']] })).toBe('Eins, zwei drei.');
    expect(momentText({})).toBe('');
  });
  it('gesehen erst am Textende', () => {
    expect(textEndReached(0, 600, 1800)).toBe(false);
    expect(textEndReached(1200, 600, 1800)).toBe(true);
    expect(textEndReached(0, 600, 500)).toBe(true);
  });
  const pool = [{ id: 'a' }, { id: 'b', audio: true }, { id: 'c', audio: false }, { id: 'd', audio: true }];
  const ids = (f: 'video' | 'audio' | 'text') => filterPool(pool, f).map((m) => m.id);
  it('Video zeigt nur Momente ohne audio', () => expect(ids('video')).toEqual(['a', 'c']));
  it('Audio zeigt nur Podcast-Momente', () => expect(ids('audio')).toEqual(['b', 'd']));
  it('Text zeigt alle Momente', () => expect(ids('text')).toEqual(['a', 'b', 'c', 'd']));
  it('leerer Filter hat eine eigene Zeile', () => {
    expect(filterPool([{ audio: true }], 'video')).toEqual([]);
    expect(emptyFormLine('video')).toBe('No video moments yet');
    expect(emptyFormLine('audio')).toBe('No audio moments yet');
  });
});
