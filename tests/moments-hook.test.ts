import { describe, expect, it } from 'vitest';
import { atTime, closesCaption, hookStep } from '../src/moments/hook';

describe('Hook und Caption (Aufgabe 4)', () => {
  it('bis drei Zeilen normal, bei mehr eine Stufe kleiner, nie gekürzt', () => {
    expect([1, 2, 3, 4, 7].map(hookStep)).toEqual([0, 0, 0, 1, 1]);
  });
  it('Stelle als Zeit', () => {
    expect([0, 5, 65, 100, 760, 3723].map(atTime)).toEqual(['0:00', '0:05', '1:05', '1:40', '12:40', '1:02:03']);
    expect(atTime(-4)).toBe('0:00');
  });
  it('Wischen nach unten klappt zu, aber nur wenn der Text oben steht', () => {
    expect(closesCaption(80, 0)).toBe(true);
    expect(closesCaption(80, 120)).toBe(false);
    expect(closesCaption(30, 0)).toBe(false);
    expect(closesCaption(-90, 0)).toBe(false);
  });
});
