import { describe, expect, it } from 'vitest';
import {
  addFrames, atRest, commitVelocity, COMMIT_FRACTION, COMMIT_VELOCITY, dragY, FRAME_SAMPLE_MAX, frameSample, frameStats, hzOf, lostFrames, release, rubber,
  SPRING_BACK, SPRING_COMMIT, stepSpring, Velocity, type SpringState,
} from '../src/moments/swipe';

const H = 800;
/** Feder in 60-Hz-Schritten bis zur Ruhe, liefert Weg und Zeit */
function run(start: SpringState, sp = SPRING_COMMIT, dt = 1 / 60) {
  let s = start;
  const xs = [s.x];
  let t = 0;
  while (!atRest(s) && t < 5) {
    s = stepSpring(s, dt, sp);
    xs.push(s.x);
    t += dt;
  }
  return { xs, t, s };
}

describe('Wischübergang (Auftrag 29.10.2026)', () => {
  it('Schwellen: 25 Prozent der Höhe oder 0,4 px/ms', () => {
    expect(COMMIT_FRACTION).toBe(0.25);
    expect(COMMIT_VELOCITY).toBe(0.4);
  });

  describe('Loslassen', () => {
    it('Strecke allein: ab 25 Prozent weiter, darunter bleibt', () => {
      expect(release(-0.25 * H, 0, H, true, true)).toBe('next');
      expect(release(-0.249 * H, 0, H, true, true)).toBe('stay');
      expect(release(0.25 * H, 0, H, true, true)).toBe('prev');
      expect(release(0.2 * H, 0, H, true, true)).toBe('stay');
    });
    it('Tempo allein: ab 0,4 px/ms über kurze Strecke weiter', () => {
      expect(release(-60, -0.4, H, true, true)).toBe('next');
      expect(release(-60, -0.39, H, true, true)).toBe('stay');
      expect(release(60, 0.5, H, true, true)).toBe('prev');
    });
    it('Zittern blättert nie: unter 10 px zählt auch hohes Tempo nicht', () => {
      expect(release(-9, -3, H, true, true)).toBe('stay');
      expect(release(-10, -3, H, true, true)).toBe('next');
    });
    it('Tempo gegen die Zugrichtung hält den Moment, auch über 25 Prozent', () => {
      expect(release(-0.5 * H, 0.5, H, true, true)).toBe('stay');
      expect(release(0.5 * H, -0.5, H, true, true)).toBe('stay');
      // schwaches Gegentempo ändert nichts
      expect(release(-0.5 * H, 0.2, H, true, true)).toBe('next');
    });
    it('Ohne Nachbarn bleibt der Moment', () => {
      expect(release(-0.6 * H, -2, H, false, true)).toBe('stay');
      expect(release(0.6 * H, 2, H, true, false)).toBe('stay');
    });
    it('Stillstand ohne Weg und Tempo bleibt', () => {
      expect(release(0, 0, H, true, true)).toBe('stay');
    });
  });

  describe('Gummiband', () => {
    it('wächst mit dem Zug, strebt gegen die Höhe, nie darüber', () => {
      expect(rubber(0, H)).toBe(0);
      expect(rubber(100, H)).toBeGreaterThan(0);
      expect(rubber(100, H)).toBeLessThan(100);
      expect(rubber(400, H)).toBeGreaterThan(rubber(100, H));
      expect(rubber(1e6, H)).toBeLessThan(H);
      expect(rubber(-100, H)).toBe(-rubber(100, H));
    });
    it('Apple-Formel mit 0,55', () => {
      expect(rubber(200, 800)).toBeCloseTo((1 - 1 / ((200 * 0.55) / 800 + 1)) * 800, 9);
    });
    it('am Anfang und Ende nur Gummiband, dazwischen 1:1 (höchstens eine Höhe)', () => {
      expect(dragY(-123, H, true, true)).toBe(-123);
      expect(dragY(150, H, true, true)).toBe(150);
      expect(dragY(-2000, H, true, true)).toBe(-H);
      expect(dragY(150, H, true, false)).toBe(rubber(150, H));
      expect(dragY(-150, H, false, true)).toBe(rubber(-150, H));
      expect(dragY(0, H, false, false)).toBe(0);
    });
  });

  describe('Tempo des Fingers', () => {
    it('aus den letzten 100 ms, nach oben negativ', () => {
      const v = new Velocity();
      for (let i = 0; i <= 10; i++) v.push(1000 + i * 16, 600 - i * 24);
      expect(v.at(1000 + 10 * 16)).toBeCloseTo(-1.5, 6);
    });
    it('alte Punkte zählen nicht: erst schnell, dann 100 ms langsam', () => {
      const v = new Velocity();
      v.push(0, 600); v.push(16, 500); v.push(32, 400);
      for (let i = 1; i <= 7; i++) v.push(32 + i * 16, 400 - i);
      expect(Math.abs(v.at(32 + 7 * 16))).toBeLessThan(0.1);
    });
    it('Finger stand vor dem Loslassen still: Tempo 0', () => {
      const v = new Velocity();
      v.push(0, 600); v.push(16, 500); v.push(32, 400);
      expect(v.at(32 + 81)).toBe(0);
      expect(v.at(32 + 79)).not.toBe(0);
    });
    it('ein Punkt und Reset geben 0', () => {
      const v = new Velocity();
      v.push(0, 5);
      expect(v.at(1)).toBe(0);
      v.push(16, 50);
      v.reset();
      expect(v.at(20)).toBe(0);
    });
  });

  describe('Feder', () => {
    it('kritisch gedämpft: nie über das Ziel, kommt zur Ruhe, keine feste Dauer', () => {
      const a = run({ x: 600, v: 0 }, SPRING_COMMIT, 1 / 240);
      expect(Math.min(...a.xs)).toBeGreaterThanOrEqual(-1e-9);
      expect(atRest(a.s)).toBe(true);
      // dichter dran heißt kürzer, mehr Anfangstempo heißt kürzer: Dauer folgt dem Zustand
      const b = run({ x: 150, v: 0 }, SPRING_COMMIT, 1 / 240);
      const c = run({ x: 600, v: -3000 }, SPRING_COMMIT, 1 / 240);
      expect(b.t).toBeLessThan(a.t);
      expect(c.t).toBeLessThan(a.t);
    });
    it('Geschwindigkeitsübernahme: das Tempo des Fingers ist der Start der Feder', () => {
      const dt = 1 / 120;
      const ohne = 400 - stepSpring({ x: 400, v: 0 }, dt, SPRING_COMMIT).x;
      const mit = 400 - stepSpring({ x: 400, v: -2000 }, dt, SPRING_COMMIT).x;
      // mit Tempo geht die Seite vom ersten Frame an weiter, ohne Tempo setzt sie langsam an
      expect(mit).toBeGreaterThan(ohne + 10);
      expect(stepSpring({ x: 400, v: -2000 }, dt, SPRING_COMMIT).v).toBeLessThan(-2000);
    });
    it('Ergebnis hängt nicht von der Schrittweite ab (geschlossene Lösung)', () => {
      const one = stepSpring({ x: 500, v: -800 }, 0.032, SPRING_COMMIT);
      let two: SpringState = { x: 500, v: -800 };
      two = stepSpring(two, 0.016, SPRING_COMMIT);
      two = stepSpring(two, 0.016, SPRING_COMMIT);
      expect(two.x).toBeCloseTo(one.x, 6);
      expect(two.v).toBeCloseTo(one.v, 4);
      const b1 = stepSpring({ x: 90, v: 300 }, 0.032, SPRING_BACK);
      let b2: SpringState = { x: 90, v: 300 };
      b2 = stepSpring(b2, 0.016, SPRING_BACK);
      b2 = stepSpring(b2, 0.016, SPRING_BACK);
      expect(b2.x).toBeCloseTo(b1.x, 6);
    });
    it('Zurückfedern darf leicht nachschwingen und kommt dennoch zur Ruhe', () => {
      const r = run({ x: 120, v: 0 }, SPRING_BACK);
      expect(Math.min(...r.xs)).toBeLessThan(0);
      expect(Math.min(...r.xs)).toBeGreaterThan(-30);
      expect(atRest(r.s)).toBe(true);
    });
    it('Stocken: ein Schritt über 50 ms springt nicht', () => {
      const a = stepSpring({ x: 500, v: 0 }, 0.05, SPRING_COMMIT);
      const b = stepSpring({ x: 500, v: 0 }, 2, SPRING_COMMIT);
      expect(b).toEqual(a);
      expect(stepSpring({ x: 5, v: 1 }, -1, SPRING_COMMIT)).toEqual({ x: 5, v: 1 });
    });
    it('Übernahme begrenzt: so schnell der Finger, die Seite schießt nie über das Ziel', () => {
      // x = Abstand zum Ziel (Position minus Ziel). Seite 300 px vor dem Ziel, Finger flitzt mit 20000 px/s zum Ziel
      const v0 = commitVelocity(300, -20000);
      const r = run({ x: 300, v: v0 });
      expect(Math.min(...r.xs)).toBeGreaterThanOrEqual(-0.5);
      // moderates Tempo bleibt unverändert, Tempo weg vom Ziel auch
      expect(commitVelocity(300, -800)).toBe(-800);
      expect(commitVelocity(300, 500)).toBe(500);
      expect(commitVelocity(0, -500)).toBe(0);
    });
    it('Antwortzeit unter einer halben Sekunde bei einer vollen Seite', () => {
      const r = run({ x: 700, v: 0 });
      expect(r.t).toBeLessThan(0.6);
      expect(r.t).toBeGreaterThan(0.2);
    });
  });

  describe('Verlorene Frames', () => {
    const at60 = (n: number, gaps: Record<number, number> = {}) => Array.from({ length: n }, (_, i) => gaps[i] ?? 16.67);
    it('Takt: 60 oder 120 Hz aus der Mitte der Abstände', () => {
      expect(hzOf(at60(50))).toBe(60);
      expect(hzOf(Array.from({ length: 50 }, () => 8.33))).toBe(120);
      expect(hzOf([])).toBe(60);
    });
    it('verloren = round(Abstand / Takt) - 1, nie negativ', () => {
      expect(lostFrames(at60(10), 60)).toBe(0);
      expect(lostFrames([16.67, 33.3, 50, 16.67], 60)).toBe(1 + 2);
      expect(lostFrames([10, 12], 60)).toBe(0);
      expect(lostFrames([24], 60)).toBe(0);
      expect(lostFrames([26], 60)).toBe(1);
    });
    it('Stichprobe und Summe über alle Wische', () => {
      const a = frameSample(at60(100, { 5: 50 }), 1);
      expect(a).toEqual({ frames: 100, lost: 2, hz: 60, at: 1 });
      const b = frameSample(at60(100), 2);
      const st = frameStats([a, b]);
      expect(st.n).toBe(2);
      expect(st.frames).toBe(200);
      expect(st.lost).toBe(2);
      expect(st.lostPct).toBe(1);
      expect(st.worstPct).toBe(2);
      expect(st.hz).toBe(60);
      expect(frameStats(undefined)).toEqual({ n: 0, frames: 0, lost: 0, lostPct: null, worstPct: null, hz: null });
    });
    it('die letzten 60 Stichproben bleiben', () => {
      let l: ReturnType<typeof addFrames> = [];
      for (let i = 0; i < FRAME_SAMPLE_MAX + 5; i++) l = addFrames(l, { frames: 10, lost: 0, hz: 60, at: i });
      expect(l.length).toBe(FRAME_SAMPLE_MAX);
      expect(l[0].at).toBe(5);
    });
  });
});
