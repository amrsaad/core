// Issue 15: Untertitel im Audio-Reiter laufen mit dem Ton. Die angezeigte Cue folgt der Elementzeit, bei 2x innerhalb 0,3 s.
import { describe, expect, it } from 'vitest';
import { CueClock, cueIndexAt, MAX_EXTRAPOLATE_S } from '../src/moments/cueClock';

const cues: [number, string][] = Array.from({ length: 40 }, (_, i) => [i * 0.5, `cue ${i}`]);

/** Nachbau eines Elements: Zeit läuft mit playbackRate, timeupdate alle 250 ms Wanduhr, die Anzeige liest alle 16 ms (requestAnimationFrame) */
function simulate(rate: number, seconds: number, opts: { timeupdateMs?: number; stallFrom?: number; stallTo?: number } = {}) {
  const tuMs = opts.timeupdateMs ?? 250;
  const clock = new CueClock();
  let worst = 0;
  let worstIdxGap = 0;
  const base = 978.64; // Quellzeit des Moments, nicht null
  clock.sample(base, 0, rate, true);
  for (let ms = 0; ms <= seconds * 1000; ms += 16) {
    const stalled = opts.stallFrom !== undefined && ms >= opts.stallFrom && ms < (opts.stallTo ?? 0);
    // Elementzeit: bleibt bei einem Hänger stehen
    const elapsed = stalled ? opts.stallFrom! : ms;
    const el = base + (stalled ? (opts.stallFrom! / 1000) * rate : (ms / 1000) * rate) - (opts.stallTo !== undefined && ms >= opts.stallTo ? ((opts.stallTo - opts.stallFrom!) / 1000) * rate : 0);
    void elapsed;
    if (ms % tuMs < 16 && !stalled) clock.sample(el, ms, rate, true);
    const shown = clock.now(ms);
    worst = Math.max(worst, Math.abs(shown - el));
    const iShown = cueIndexAt(cues, shown - base);
    const iEl = cueIndexAt(cues, el - base);
    worstIdxGap = Math.max(worstIdxGap, Math.abs(iShown - iEl));
  }
  return { worst, worstIdxGap };
}

describe('CueClock', () => {
  it('bei 2x liegt die angezeigte Zeit zu jedem Zeitpunkt innerhalb 0,3 s der Elementzeit', () => {
    const r = simulate(2, 12);
    expect(r.worst).toBeLessThanOrEqual(0.3);
  });
  it('bei 1.5x und 1x ebenso', () => {
    expect(simulate(1.5, 12).worst).toBeLessThanOrEqual(0.3);
    expect(simulate(1, 12).worst).toBeLessThanOrEqual(0.3);
  });
  it('die angezeigte Cue weicht bei 2x höchstens um eine Cue von der der Elementzeit ab (Cues im Abstand 0,5 s)', () => {
    expect(simulate(2, 12).worstIdxGap).toBeLessThanOrEqual(1);
  });
  it('ohne timeupdate bleibt die Abweichung begrenzt: nach MAX_EXTRAPOLATE_S wird nicht weitergerechnet', () => {
    const c = new CueClock();
    c.sample(100, 0, 2, true);
    expect(c.now(10_000)).toBeCloseTo(100 + MAX_EXTRAPOLATE_S * 2, 5);
  });
  it('steht das Element (waiting, pause), steht die Zeit', () => {
    const c = new CueClock();
    c.sample(100, 0, 2, true);
    c.sample(100.4, 200, 2, false);
    expect(c.now(5000)).toBe(100.4);
  });
  it('beim Spurwechsel übernimmt die Uhr die Zeit und springt nicht auf null', () => {
    const c = new CueClock();
    c.sample(990.2, 1000, 2, true);
    c.hold(990.2, 1100);
    expect(c.now(1500)).toBe(990.2);
    // Das neue Element meldet seine Stelle an derselben Position, die Uhr läuft weiter
    c.sample(990.3, 1700, 2, true);
    expect(c.now(1800)).toBeCloseTo(990.5, 3);
  });
  it('nie aus Date.now: die Uhr kennt nur die übergebenen Zeitmarken', () => {
    const c = new CueClock();
    c.sample(50, 1000, 1, true);
    const a = c.now(1100);
    const spy = Date.now;
    Date.now = () => {
      throw new Error('Date.now gelesen');
    };
    try {
      expect(c.now(1100)).toBe(a);
    } finally {
      Date.now = spy;
    }
  });
});

describe('cueIndexAt', () => {
  it('-1 vor der ersten Cue, danach die letzte mit t <= rel + Vorlauf', () => {
    expect(cueIndexAt([[1, 'a'], [2, 'b']], 0.5)).toBe(-1);
    expect(cueIndexAt([[1, 'a'], [2, 'b']], 0.95)).toBe(0);
    expect(cueIndexAt([[1, 'a'], [2, 'b']], 2.2)).toBe(1);
    expect(cueIndexAt(undefined, 3)).toBe(-1);
  });
});
