import { describe, expect, it } from 'vitest';
import { notesRow } from '../src/moments/notesrow';

describe('Notiz-Blase hat im Audio- und Text-Reiter eine eigene Reihe (Issue 49)', () => {
  it('Audio und Text reservieren die Reihe, solange die Blase steht', () => {
    expect(notesRow(true, 'audio', true, 2)).toBe(true);
    expect(notesRow(true, 'text', true, 1)).toBe(true);
  });
  it('Video bleibt bei der eigenen Regel, ohne Blase oder ohne Notizen keine Reihe', () => {
    expect(notesRow(true, 'video', true, 2)).toBe(false);
    expect(notesRow(false, 'audio', true, 2)).toBe(false);
    expect(notesRow(true, 'text', true, 0)).toBe(false);
    expect(notesRow(true, 'audio', false, 2)).toBe(false);
  });
});
