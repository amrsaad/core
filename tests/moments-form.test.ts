import { describe, expect, it } from 'vitest';
import { emptyFormLine, endButtonLabel, endLine, END_SUB, filterPool, formOf, FORMS, momentText, otherForms, textEndReached, unseenCount } from '../src/moments/form';

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
  type P = { id: string; audio?: boolean; form?: 'video' | 'audio' | 'text' };
  // ohne Feld form: audio true heißt audio, sonst video. Mit Feld gilt das Feld.
  const pool: P[] = [{ id: 'a' }, { id: 'b', audio: true }, { id: 'c', audio: false }, { id: 'd', audio: true }, { id: 'e', form: 'text' }, { id: 'f', form: 'video', audio: true }, { id: 'g', form: 'audio' }];
  const ids = (f: 'video' | 'audio' | 'text') => filterPool(pool, f).map((m) => m.id);
  it('Fallback ohne Feld form', () => {
    expect(formOf({})).toBe('video');
    expect(formOf({ audio: true })).toBe('audio');
    expect(formOf({ audio: false })).toBe('video');
  });
  it('Video: form video, ohne Feld alles ohne audio', () => expect(ids('video')).toEqual(['a', 'c', 'f']));
  it('Audio: form audio, ohne Feld audio true', () => expect(ids('audio')).toEqual(['b', 'd', 'g']));
  it('Text: nur form text', () => expect(ids('text')).toEqual(['e']));
  it('Feld form schlägt audio', () => expect(formOf({ form: 'video', audio: true })).toBe('video'));
  it('leerer Filter hat eine eigene Zeile', () => {
    expect(filterPool([{ audio: true }], 'video')).toEqual([]);
    expect(filterPool([{}], 'text')).toEqual([]);
    expect(emptyFormLine('video')).toBe('No video moments yet');
    expect(emptyFormLine('audio')).toBe('No audio moments yet');
    expect(emptyFormLine('text')).toBe('Text sources coming');
  });
});

describe('Endseite (Auftrag 29.10.2026)', () => {
  const mk = (id: string, form: 'video' | 'audio' | 'text', channel = 'K') => ({ id, channel, form });
  it('Sätze und Knöpfe', () => {
    expect(endLine('video')).toBe("You've seen every video moment.");
    expect(endLine('audio')).toBe("You've seen every audio moment.");
    expect(END_SUB).toBe('New ones arrive daily.');
    expect(otherForms('video')).toEqual(['audio', 'text']);
    expect(otherForms('text')).toEqual(['video', 'audio']);
    expect(endButtonLabel('audio', 412)).toBe('Audio, 412 new');
    expect(endButtonLabel('text', 230)).toBe('Text, 230 new');
  });
  it('ungesehen: nur die Form, nicht gesehen, nicht stummgeschaltet', () => {
    const pool = [mk('a', 'audio'), mk('b', 'audio'), mk('c', 'audio', 'M'), mk('d', 'text'), mk('e', 'video')];
    expect(unseenCount(pool, 'audio', {}, {})).toBe(3);
    expect(unseenCount(pool, 'audio', { a: 1 }, {})).toBe(2);
    expect(unseenCount(pool, 'audio', { a: 1 }, { M: 'x' })).toBe(1);
    expect(unseenCount(pool, 'text', {}, {})).toBe(1);
    expect(unseenCount(pool, 'video', { e: 5 }, {})).toBe(0);
  });
});
