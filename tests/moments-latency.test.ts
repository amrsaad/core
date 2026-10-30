import { describe, expect, it } from 'vitest';
import { addSample, LATENCY_MAX, LATENCY_TARGET_MS, latencyStats } from '../src/moments/latency';

const s = (ms: number, buffered = true) => ({ ms, buffered, at: 0 });

describe('Wisch bis erstes Bild (Runde 1, Punkt 1)', () => {
  it('Ziel ist 300 ms bei gepuffertem Moment', () => expect(LATENCY_TARGET_MS).toBe(300));
  it('hält nur die letzten Messungen', () => {
    let l = addSample(undefined, s(1));
    for (let i = 2; i <= LATENCY_MAX + 10; i++) l = addSample(l, s(i));
    expect(l).toHaveLength(LATENCY_MAX);
    expect(l[0].ms).toBe(11);
  });
  it('trennt gepuffert und nicht gepuffert', () => {
    const l = [s(100), s(200), s(250), s(400), s(900, false)];
    const b = latencyStats(l, true);
    expect(b.n).toBe(4);
    expect(b.median).toBe(200);
    expect(b.p90).toBe(400);
    expect(b.underTarget).toBe(0.75);
    expect(latencyStats(l, false)).toEqual({ n: 1, median: 900, p90: 900, underTarget: 0 });
  });
  it('leer ergibt keine Zahl statt 0', () => expect(latencyStats([], true)).toEqual({ n: 0, median: null, p90: null, underTarget: null }));
});
