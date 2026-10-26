import { describe, expect, it } from 'vitest';
import { FORMS, momentText, textEndReached } from '../src/moments/form';

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
});
