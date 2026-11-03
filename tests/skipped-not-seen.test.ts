// Brief 09, Entscheidung 45: Übersprungen ist nicht gesehen, Vorrat vor Netz.
import { describe, expect, it } from 'vitest';
import { PLAYED_MIN_MS, PlayTracker } from '../src/moments/played';
import { emptyState, repair45, type AppState } from '../src/lib/state';
import { applyDoc, canon, emptyDoc, mergeDocs, syncedChanged, toDoc, type SyncDoc, type SyncState } from '../src/lib/sync/merge';
import { blockedCount, unseenCount, waitingLine, endLine } from '../src/moments/form';
import { pruneAndHeal } from '../src/moments/queue';
import { startOrder, HEADS } from '../src/moments/startHead';
import { lockNextPlan } from '../src/moments/lockScreen';
import { connPoor, POOR_DOWNLINK } from '../src/moments/context';
import { FIRST_FRAME_POOR_MS, isPoorNet } from '../src/moments/preload';
import type { Area } from '../src/types';
import type { Moment } from '../src/moments/types';

const mom = (id: string, o: Partial<Moment> = {}): Moment => ({ id, videoId: 'v' + id, start: 10, end: 60, channel: 'c' + id, videoTitle: 'T', area: 'brain', topic: 't' + id, hook: 'H' + id, kind: 'story', createdAt: '', form: 'video', ...o });
const area = (id: string, a: Area, o: Partial<Moment> = {}) => mom(id, { area: a, ...o });

describe('Schritt 1: gesehen erst nach einer Sekunde Spielzeit', () => {
  it('ein Moment, der nie gespielt hat, zählt nicht (Hänge-Überwachung, 12 s Warten)', () => {
    let t = 0;
    const p = new PlayTracker(() => t);
    t = 12_000;
    expect(p.enough('a')).toBe(false);
    expect(p.any('a')).toBe(false);
  });
  it('unter einer Sekunde reicht nicht, ab einer Sekunde ja', () => {
    let t = 0;
    const p = new PlayTracker(() => t);
    p.set('a', true);
    t = PLAYED_MIN_MS - 1;
    expect(p.enough('a')).toBe(false);
    expect(p.any('a')).toBe(true);
    t = PLAYED_MIN_MS;
    expect(p.enough('a')).toBe(true);
  });
  it('Warten und Pause zählen nicht, nur PLAYING', () => {
    let t = 0;
    const p = new PlayTracker(() => t);
    p.set('a', true);
    t = 600;
    p.set('a', false); // gepuffert oder pausiert
    t = 20_000;
    expect(p.ms('a')).toBe(600);
    p.set('a', true);
    t = 20_500;
    expect(p.enough('a')).toBe(true);
  });
  it('jeder Moment hat seine eigene Zeit', () => {
    let t = 0;
    const p = new PlayTracker(() => t);
    p.set('a', true);
    t = 2000;
    p.set('a', false);
    expect(p.enough('a')).toBe(true);
    expect(p.enough('b')).toBe(false);
  });
});

const T0 = new Date('2026-11-03T10:00:00').getTime();
const withLog = (): AppState => {
  const s = emptyState();
  s.momentLog = [
    { id: 'played', day: '2026-11-01', ended: false, watched: 14 },
    { id: 'ended', day: '2026-11-01', ended: true, watched: 40 },
    { id: 'hung', day: '2026-11-02', ended: false, watched: 13 },
    { id: 'zero', day: '2026-11-02', ended: false, watched: 0 },
  ];
  s.momentSeen = { played: T0, ended: T0, hung: T0, zero: T0, nolog: T0, rej: T0, old: new Date('2026-10-01T10:00:00').getTime() };
  s.momentRejected = { rej: T0 };
  s.diag = [{ t: T0, d: 'dev', l: 'watchdog hung' }, { t: T0, d: 'dev', l: 'skipped (not seen) ended' }];
  return s;
};

describe('Schritt 2: einmalige Reparatur', () => {
  it('löscht Einträge ohne gespielte Sekunden und die der Hänge-Überwachung, setzt Tombstones', () => {
    const r = repair45(withLog(), 5000);
    expect(new Set(r.removed)).toEqual(new Set(['zero', 'nolog', 'hung']));
    expect(Object.keys(r.state.momentSeen).sort()).toEqual(['ended', 'old', 'played', 'rej']);
    expect(r.state.momentUnseen).toEqual({ zero: 5000, nolog: 5000, hung: 5000 });
  });
  it('lässt abgelehnte, bis zum Ende gelaufene und ältere Einträge als das Protokoll stehen', () => {
    const r = repair45(withLog(), 5000);
    for (const id of ['rej', 'ended', 'old', 'played']) expect(r.state.momentSeen[id]).toBeDefined();
  });
  it('leeres Protokoll: nichts wird gelöscht', () => {
    const s = withLog();
    s.momentLog = [];
    expect(repair45(s, 1).removed).toEqual([]);
  });
  it('nichts zu löschen: derselbe Zustand zurück', () => {
    const s = emptyState();
    s.momentLog = [{ id: 'a', day: '2026-11-01', ended: true, watched: 30 }];
    s.momentSeen = { a: T0 };
    const r = repair45(s, 1);
    expect(r.state).toBe(s);
  });
});

const doc = (state: Partial<SyncState>): SyncDoc => {
  const d = emptyDoc();
  return { ...d, state: { ...d.state, ...state } };
};

describe('Schritt 2: der Sync holt gelöschte Einträge nicht zurück', () => {
  it('Eintrag vom anderen Gerät, nicht jünger als die Löschung, kommt nicht zurück', () => {
    const repaired = doc({ momentSeen: { keep: 50 }, momentUnseen: { x: 200 } });
    const other = doc({ momentSeen: { x: 100, keep: 60 } });
    const m = mergeDocs(repaired, other);
    expect(m.state.momentSeen).toEqual({ keep: 50 });
    expect(m.state.momentUnseen).toEqual({ x: 200 });
  });
  it('echtes späteres Ansehen (jünger als die Löschung) bleibt', () => {
    const m = mergeDocs(doc({ momentSeen: { x: 300 }, momentUnseen: { x: 200 } }), doc({}));
    expect(m.state.momentSeen).toEqual({ x: 300 });
  });
  it('vertauschbar und wiederholbar', () => {
    const a = doc({ momentSeen: { x: 100, y: 5 }, momentUnseen: { y: 9 } });
    const b = doc({ momentSeen: { x: 120 }, momentUnseen: { x: 150, y: 3 } });
    expect(canon(mergeDocs(a, b))).toBe(canon(mergeDocs(b, a)));
    const ab = mergeDocs(a, b);
    expect(canon(mergeDocs(ab, ab))).toBe(canon(ab));
    expect(canon(mergeDocs(ab, a))).toBe(canon(ab));
  });
  it('ohne momentUnseen bleibt das Dokument unverändert (kein neues Feld)', () => {
    const m = mergeDocs(doc({ momentSeen: { a: 1 } }), doc({ momentSeen: { b: 2 } }));
    expect('momentUnseen' in m.state).toBe(false);
  });
  it('Zustand und Dokument: Tombstone wandert hin und zurück, Rückholen vom anderen Gerät greift nicht', () => {
    const s = { ...emptyState(), momentSeen: { keep: 5 }, momentUnseen: { x: 200 } };
    const d = toDoc(s);
    expect(d.state.momentUnseen).toEqual({ x: 200 });
    const remote = doc({ momentSeen: { x: 100, keep: 5 } });
    const next = applyDoc(s, mergeDocs(d, remote));
    expect(next.momentSeen).toEqual({ keep: 5 });
    expect(syncedChanged(s, { ...s, momentUnseen: { x: 200, z: 1 } })).toBe(true);
  });
});

describe('Schritt 3: Leer-Seite wartet aufs Netz', () => {
  const pool = [mom('1'), mom('2'), mom('3', { form: 'audio', audio: true }), mom('4')];
  it('gesperrte Momente zählen als ungesehen und werden als gesperrt gezählt', () => {
    expect(unseenCount(pool, 'video', {}, {})).toBe(3);
    expect(blockedCount(pool, 'video', {}, {}, new Set(['v1', 'v2', 'v4']))).toBe(3);
    expect(blockedCount(pool, 'video', { '1': 1 }, {}, new Set(['v1', 'v2']))).toBe(1);
    expect(blockedCount(pool, 'audio', {}, {}, new Set(['v1', 'v2']))).toBe(0);
  });
  it('Text für Video und Audio', () => {
    expect(waitingLine('video', 14)).toBe("Waiting for network. 14 videos ready when it's back.");
    expect(waitingLine('video', 1)).toBe("Waiting for network. 1 video ready when it's back.");
    expect(waitingLine('audio', 6)).toBe("Waiting for network. 6 audio moments ready when it's back.");
    expect(endLine('video')).toBe("You've seen every video moment.");
  });
});

describe('Schritt 4: Bereichsregel nach dem Aussortieren', () => {
  const ids = (q: Moment[]) => q.map((m) => m.id);
  it('fehlt idx+1 und stünde derselbe Bereich daneben, rückt der nächste mit anderem Bereich nach', () => {
    // Brain(cur) Beat(bad) Brain Beat Body: ohne Heilung stehen zwei Brain hintereinander
    const q = [area('c', 'brain'), area('b1', 'beat', { videoId: 'bad' }), area('r1', 'brain'), area('r2', 'beat'), area('r3', 'body')];
    const out = pruneAndHeal(q, 0, (m) => m.videoId === 'bad');
    expect(ids(out)).toEqual(['c', 'r2', 'r1', 'r3']);
    for (let i = 1; i < out.length; i++) expect(out[i].area).not.toBe(out[i - 1].area);
  });
  it('der Ersatz unterscheidet sich vom Vorgänger und vom Nachfolger', () => {
    const q = [area('c', 'beat'), area('x', 'brain', { videoId: 'bad' }), area('r1', 'beat'), area('r2', 'beat'), area('r3', 'brain'), area('r4', 'body')];
    const out = pruneAndHeal(q, 0, (m) => m.videoId === 'bad');
    expect(out[1].area).not.toBe('beat');
    expect(out[2].area).not.toBe(out[1].area);
  });
  it('Beat dominiert (Issue 34): nie zwei Beat nebeneinander, solange Brain oder Body da ist', () => {
    const q = [area('c', 'beat'), area('b0', 'brain', { videoId: 'bad' }), area('b1', 'beat'), area('b2', 'beat'), area('n1', 'brain'), area('n2', 'body'), area('b3', 'beat')];
    const out = pruneAndHeal(q, 0, (m) => m.videoId === 'bad');
    expect(out[1].area).not.toBe('beat');
    expect(out[2].area).not.toBe(out[1].area);
  });
  it('fehlt weiter hinten einer (nicht idx+1 oder idx+2): nur herausnehmen, nichts umstellen', () => {
    const q = [area('c', 'brain'), area('a', 'beat'), area('b', 'body'), area('d', 'brain', { videoId: 'bad' }), area('e', 'brain')];
    expect(ids(pruneAndHeal(q, 0, (m) => m.videoId === 'bad'))).toEqual(['c', 'a', 'b', 'e']);
  });
  it('gibt es keinen anderen Bereich, bleibt die Reihenfolge', () => {
    const q = [area('c', 'brain'), area('x', 'brain', { videoId: 'bad' }), area('r1', 'brain'), area('r2', 'brain')];
    expect(ids(pruneAndHeal(q, 0, (m) => m.videoId === 'bad'))).toEqual(['c', 'r1', 'r2']);
  });
  it('nichts entfernt: gleiche Folge', () => {
    const q = [area('c', 'brain'), area('a', 'beat'), area('b', 'brain')];
    expect(ids(pruneAndHeal(q, 0, () => false))).toEqual(['c', 'a', 'b']);
  });
});

describe('Schritt 5: Vorrat vor Netz', () => {
  const au = (i: number) => mom('m' + i, { form: 'audio', audio: true });
  const q = [au(0), au(1), au(2), au(3), au(4), au(5), au(6)];
  const held = (...ids: string[]) => (m: { id: string }) => ids.includes(m.id);
  it('sechs Köpfe statt drei', () => expect(HEADS).toBe(6));
  it('startOrder: kein Kopf passt, aber der Vorrat hat einen zulässigen Moment: der kommt zuerst, nie "none"', () => {
    const r = startOrder(q, held('m6'), [], [q[6]]);
    expect(r.how).toBe('reserve');
    expect(r.queue[0].id).toBe('m6');
    expect(startOrder(q, held(), [], []).how).toBe('none');
  });
  it('Next sichtbar: der nächste liegt im Vorrat, nichts ändert sich', () => {
    const r = lockNextPlan(q, 0, held('m1'), false);
    expect(r.how).toBe('held');
    expect(r.queue.map((m) => m.id)).toEqual(q.map((m) => m.id));
  });
  it('Next: nächster nicht im Vorrat, einer der nächsten drei schon: der wird vorgezogen', () => {
    const r = lockNextPlan(q, 0, held('m3'), false);
    expect(r.how).toBe('pulled');
    expect(r.id).toBe('m3');
    expect(r.queue.map((m) => m.id)).toEqual(['m0', 'm3', 'm1', 'm2', 'm4', 'm5', 'm6']);
  });
  it('sichtbar: ein Vorrats-Moment außerhalb der nächsten drei zählt nicht, Netzstart', () => {
    const r = lockNextPlan(q, 0, held('m5'), false);
    expect(r.how).toBe('net');
    expect(r.id).toBe('m1');
  });
  it('verdeckt: der Vorrats-Moment kommt aus dem ganzen Rest', () => {
    const r = lockNextPlan(q, 0, held('m5'), true);
    expect(r.how).toBe('pulled');
    expect(r.queue[1].id).toBe('m5');
    expect(r.queue).toHaveLength(q.length);
  });
  it('verdeckt und nichts im Vorrat: net (der Feed startet dann nichts)', () => {
    expect(lockNextPlan(q, 0, held(), true).how).toBe('net');
    expect(lockNextPlan([au(0)], 0, held(), true).how).toBe('none');
  });
});

describe('Schritt 6: schlechtes Netz früh erkennen', () => {
  it('effectiveType 2g, slow-2g, 3g und downlink unter 1,5 gelten sofort als schlecht', () => {
    for (const effectiveType of ['slow-2g', '2g', '3g']) expect(connPoor({ effectiveType })).toBe(true);
    expect(connPoor({ effectiveType: '4g', downlink: POOR_DOWNLINK - 0.1 })).toBe(true);
    expect(connPoor({ effectiveType: '4g', downlink: 10 })).toBe(false);
    expect(connPoor({ downlink: 0 })).toBe(false);
  });
  it('ohne navigator.connection (iOS Safari): kein Urteil', () => expect(connPoor(undefined)).toBe(false));
  it('ein einziger Start über 4 s genügt, nicht erst drei langsame', () => {
    expect(isPoorNet([{ k: 'start', ms: FIRST_FRAME_POOR_MS + 1 }], true)).toBe(true);
    expect(isPoorNet([{ k: 'start', ms: FIRST_FRAME_POOR_MS }], true)).toBe(false);
    expect(isPoorNet([{ k: 'start', ms: 2500 }], true)).toBe(false);
  });
  it('ein frischer schneller Abruf beendet den Zustand wieder', () => {
    expect(isPoorNet([{ k: 'start', ms: 9000 }, { k: 'probe', ms: 200 }], true)).toBe(false);
  });
});
