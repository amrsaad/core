import { describe, expect, it } from 'vitest';
import { buildAliasIndex, migrateDoc, migrateState, NO_ALIASES } from '../src/moments/aliases';
import { validateMoments } from '../src/moments/contract';
import { emptyState, type AppState } from '../src/lib/state';
import { applyDoc, canon, mergeDocs, toDoc } from '../src/lib/sync/merge';
import type { Moment } from '../src/moments/types';

const OLD = 'pod-barbell-medicine-pod-46a79b36:614.5';
const NEW = 'pod-barbell-medicine-pod-46a79b36:586.49';
const OTHER = 'ted-41105:114.1';

const mk = (id: string, start: number, extra: Partial<Moment> = {}): Moment => ({
  id,
  videoId: id.split(':')[0],
  start,
  end: start + 44,
  channel: 'Barbell Medicine Podcast',
  videoTitle: 't',
  area: 'body',
  topic: 'ernaehrung',
  hook: 'h',
  kind: 'regel',
  form: 'audio',
  hls: 'https://example.org/a.mp3',
  createdAt: '2026-10-25T00:00:00Z',
  ...extra,
});

/** Pool nach der Neueinordnung: der Moment hat den neuen Start und nennt die alte ID als alias */
const fresh = mk(NEW, 586.49, { aliases: [OLD], cues: [[0.04, 'And the way I frame it to patients']] });
const other = mk(OTHER, 114.1, { videoId: 'ted-41105' });
const pool = [fresh, other];
const idx = buildAliasIndex(pool);

/** Alter Stand eines Geräts: Save mit Abbild vom alten Start, dazu Gesehen, Protokoll, Herz, Abrufplan und Notiz unter der alten ID */
function oldState(): AppState {
  const stale = mk(OLD, 614.5, { cues: [[0, 'stale cue at the old position']] });
  return {
    ...emptyState(),
    momentSeen: { [OLD]: 1000, [OTHER]: 2000 },
    momentLog: [
      { id: OLD, day: '2026-10-28', ended: false, watched: 12 },
      { id: OLD, day: '2026-10-29', ended: true, watched: 40 },
      { id: OTHER, day: '2026-10-29', ended: true, watched: 30 },
    ],
    savedMoments: { [OLD]: { moment: stale, savedAt: '2026-10-28T10:00:00Z' }, [OTHER]: { moment: other, savedAt: '2026-10-28T11:00:00Z' } },
    momentLiked: { [OLD]: 500 },
    recall: { [OLD]: { id: OLD, due: 9_000, results: [{ at: 1_000, got: true }] } },
    feedbackNotes: [{ key: `${OLD}#1700`, id: OLD, hook: 'h', chips: ['Weak'], text: 'x', tab: 'audio', commit: 'abc', at: 1700, sent: 1800 }],
    syncTs: { [`saved:${OLD}`]: 5_000, [`liked:${OLD}`]: 6_000, [`saved:${OTHER}`]: 4_000 },
  };
}

describe('Alias-Index', () => {
  it('baut alteId zu aktueller ID, ignoriert Alias, der selbst eine aktuelle ID ist, und doppelte Aliase', () => {
    expect(idx.map).toEqual({ [OLD]: NEW });
    const clash = buildAliasIndex([mk('a:1', 1), mk('a:2', 2, { aliases: ['a:1', 'a:0'] }), mk('a:3', 3, { aliases: ['a:0'] })]);
    expect(clash.map).toEqual({ 'a:0': 'a:2' });
  });

  it('der Vertrag behält gültige aliases und entfernt falsch typisierte', () => {
    const ok = validateMoments([{ ...fresh }, { ...other, aliases: [1, 2] }]);
    expect(ok.moments[0].aliases).toEqual([OLD]);
    expect(ok.moments[1].aliases).toBeUndefined();
  });
});

describe('Zustand mit alter ID wird umgestellt', () => {
  const s = migrateState(oldState(), idx);

  it('Gesehen, Protokoll, Herz, Abrufplan und Notiz tragen die neue ID', () => {
    expect(s.momentSeen).toEqual({ [NEW]: 1000, [OTHER]: 2000 });
    expect(s.momentLog.map((e) => e.id).sort()).toEqual([NEW, NEW, OTHER].sort());
    expect(s.momentLiked).toEqual({ [NEW]: 500 });
    expect(s.recall?.[OLD]).toBeUndefined();
    expect(s.recall?.[NEW]).toEqual({ id: NEW, due: 9_000, results: [{ at: 1_000, got: true }] });
    expect(s.feedbackNotes?.[0]).toMatchObject({ key: `${NEW}#1700`, id: NEW, sent: 1800 });
  });

  it('der Save zeigt den aktuellen Moment aus dem Pool (neuer Start, neue Untertitel), savedAt bleibt', () => {
    expect(Object.keys(s.savedMoments).sort()).toEqual([NEW, OTHER].sort());
    expect(s.savedMoments[NEW].moment).toEqual(fresh);
    expect(s.savedMoments[NEW].moment.start).toBe(586.49);
    expect(s.savedMoments[NEW].savedAt).toBe('2026-10-28T10:00:00Z');
    expect(s.savedMoments[OTHER]).toEqual(oldState().savedMoments[OTHER]);
  });

  it('Zeitstempel wandern mit, die alten Schlüssel fallen weg', () => {
    expect(s.syncTs).toEqual({ [`saved:${NEW}`]: 5_000, [`liked:${NEW}`]: 6_000, [`saved:${OTHER}`]: 4_000 });
  });

  it('läuft zweimal gleich: derselbe Verweis, nichts ändert sich', () => {
    expect(migrateState(s, idx)).toBe(s);
  });

  it('beide IDs mit verschiedenem Zeitstempel: der jüngere Eintrag gewinnt (wie im Sync), der Zeitstempel liegt auf der neuen ID', () => {
    const both: AppState = {
      ...emptyState(),
      savedMoments: {
        [OLD]: { moment: mk(OLD, 614.5), savedAt: '2026-10-28T10:00:00Z' },
        [NEW]: { moment: fresh, savedAt: '2026-10-29T09:00:00Z', done: true },
      },
      syncTs: { [`saved:${OLD}`]: 5_000, [`saved:${NEW}`]: 8_000 },
    };
    const m = migrateState(both, idx);
    expect(m.savedMoments[NEW]).toMatchObject({ savedAt: '2026-10-29T09:00:00Z', done: true });
    expect(m.syncTs).toEqual({ [`saved:${NEW}`]: 8_000 });
  });

  it('Entfernen unter der alten ID (jüngerer Zeitstempel ohne Eintrag) entfernt auch den Eintrag unter der neuen ID', () => {
    const s0: AppState = { ...emptyState(), savedMoments: { [NEW]: { moment: fresh, savedAt: '2026-10-29T09:00:00Z' } }, syncTs: { [`saved:${NEW}`]: 4_000, [`saved:${OLD}`]: 7_000 } };
    const m = migrateState(s0, idx);
    expect(m.savedMoments[NEW]).toBeUndefined();
    expect(m.syncTs).toEqual({ [`saved:${NEW}`]: 7_000 });
  });

  it('ohne Aliase im Pool ändert sich nichts', () => {
    const o = oldState();
    expect(migrateState(o, NO_ALIASES)).toBe(o);
    expect(migrateState(o, buildAliasIndex([other]))).toBe(o);
  });

  it('beide IDs im Stand mit gleichem Zeitstempel (altes und neues Gerät gemischt): zusammengeführt, früheres savedAt, früheres Gesehen, done bleibt', () => {
    const both: AppState = {
      ...oldState(),
      momentSeen: { [OLD]: 1000, [NEW]: 800 },
      syncTs: {},
      savedMoments: {
        [OLD]: { moment: mk(OLD, 614.5), savedAt: '2026-10-28T10:00:00Z' },
        [NEW]: { moment: fresh, savedAt: '2026-10-29T09:00:00Z', done: true },
      },
    };
    const m = migrateState(both, idx);
    expect(m.momentSeen[NEW]).toBe(800);
    expect(m.savedMoments[NEW]).toMatchObject({ savedAt: '2026-10-28T10:00:00Z', done: true });
    expect(m.savedMoments[OLD]).toBeUndefined();
  });
});

describe('Sync mit einem Gerät, das noch alte IDs hat', () => {
  it('ein jüngeres Entfernen am neuen Gerät wird vom alten Stand nicht zurückgebracht', () => {
    // Gerät B (alt): Save unter OLD, Zeitstempel 5000. Gerät A (migriert): hat den Save später entfernt (Zeitstempel 9000 auf dem neuen Schlüssel).
    const b = oldState();
    const a: AppState = { ...emptyState(), syncTs: { [`saved:${NEW}`]: 9_000 } };
    const merged = mergeDocs(toDoc(a), migrateDoc(toDoc(b), idx));
    expect(merged.state.savedMoments[NEW]).toBeUndefined();
    expect(Object.keys(merged.state.savedMoments)).toEqual([OTHER]);
  });

  it('ein jüngerer Save am alten Gerät gewinnt gegen ein älteres Entfernen am neuen', () => {
    const b: AppState = { ...oldState(), syncTs: { [`saved:${OLD}`]: 12_000 } };
    const a: AppState = { ...emptyState(), syncTs: { [`saved:${NEW}`]: 9_000 } };
    const merged = mergeDocs(toDoc(a), migrateDoc(toDoc(b), idx));
    expect(merged.state.savedMoments[NEW].moment.start).toBe(586.49);
  });

  it('Reihenfolge egal: zwei umgestellte Dokumente führen zum gleichen Ergebnis, und danach ist nichts mehr umzustellen', () => {
    const x = migrateDoc(toDoc(oldState()), idx);
    const y = migrateDoc(toDoc({ ...oldState(), momentSeen: { [OLD]: 700 }, momentLiked: { [OLD]: 900 }, syncTs: { [`liked:${OLD}`]: 7_000 } }), idx);
    expect(canon(mergeDocs(x, y))).toBe(canon(mergeDocs(y, x)));
    const m = mergeDocs(x, y);
    expect(migrateDoc(m, idx)).toBe(m);
    expect(m.state.momentSeen[NEW]).toBe(700);
    expect(m.state.momentLiked[NEW]).toBe(900);
  });

  it('übernommen in den Zustand: applyDoc setzt die umgestellten Felder und die Zeitstempel', () => {
    const s = applyDoc(oldState(), migrateDoc(toDoc(oldState()), idx));
    expect(Object.keys(s.savedMoments).sort()).toEqual([NEW, OTHER].sort());
    expect(s.syncTs?.[`saved:${NEW}`]).toBe(5_000);
  });
});
