import { describe, expect, it } from 'vitest';
import { applyDoc, canon, mergeDocs, stampChanges, toDoc, tsKey } from '../src/lib/sync/merge';
import { emptyState } from '../src/lib/state';
import { DAY_MS, type RecallState } from '../src/moments/recall';
import { canShowRecall, enqueue, onReturn, onSwipe, QUEUE_MAX, requeueOpen, type QueueEntry } from '../src/moments/recallqueue';
import { AudioDeck, type DeckClip, type DeckEl } from '../src/video/audioDeck';

const T = 1_000_000_000_000;
const e = (id: string, review = false, dueAt = T): QueueEntry => ({ id, review, dueAt });
const bg = { active: true, visible: false, note: false, sheet: false };
const fg = { active: true, visible: true, note: false, sheet: false };

describe('Abrufkarten-Warteschlange (Pfeiler 19)', () => {
  it('Karten nur bei Vordergrund und sichtbarem Feed', () => {
    expect(canShowRecall(fg)).toBe(true);
    expect(canShowRecall(bg)).toBe(false);
    expect(canShowRecall({ ...fg, active: false })).toBe(false); // Settings oder Saved
    expect(canShowRecall({ ...fg, note: true })).toBe(false); // Feedback-Blatt
    expect(canShowRecall({ ...fg, sheet: true })).toBe(false); // Seitenblatt, Übersicht
  });

  it('füllt sich im Hintergrund und zeigt dort nie eine Karte', () => {
    let q: QueueEntry[] = [];
    let r: RecallState = {};
    for (const [i, id] of ['a', 'b', 'c'].entries()) {
      const s = onSwipe(q, r, { id, review: false }, false, T + i);
      expect(s.show).toBeNull();
      q = s.queue;
      r = s.recall;
    }
    expect(q.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(q.map((x) => x.dueAt)).toEqual([T, T + 1, T + 2]);
    expect(r).toEqual({});
  });

  it('leert sich eine Karte pro Wisch, die älteste zuerst, bis sie leer ist', () => {
    let q = [e('a'), e('b'), e('c')];
    // Rückkehr: eine Karte sofort
    const ret = onReturn(q, true);
    expect(ret.show?.id).toBe('a');
    q = ret.queue;
    // danach je eine pro Wisch, auch ohne neue fällige Karte
    const s1 = onSwipe(q, {}, null, true, T);
    expect(s1.show?.id).toBe('b');
    expect(s1.fromQueue).toBe(true);
    const s2 = onSwipe(s1.queue, s1.recall, null, true, T);
    expect(s2.show?.id).toBe('c');
    const s3 = onSwipe(s2.queue, s2.recall, null, true, T);
    expect(s3.show).toBeNull();
    expect(s3.queue).toEqual([]);
  });

  it('Rückkehr ohne Vordergrund oder bei leerer Warteschlange zeigt nichts', () => {
    expect(onReturn([e('a')], false).show).toBeNull();
    expect(onReturn([], true).show).toBeNull();
  });

  it('im Vordergrund mit Warteschlange: eine Karte pro Wisch, die neue reiht sich hinten ein', () => {
    const s = onSwipe([e('a'), e('b')], {}, { id: 'n', review: true }, true, T + 5);
    expect(s.show?.id).toBe('a');
    expect(s.queue.map((x) => x.id)).toEqual(['b', 'n']);
  });

  it('im Vordergrund ohne Warteschlange: die neue Karte erscheint sofort', () => {
    const s = onSwipe([], {}, { id: 'n', review: false }, true, T);
    expect(s.show?.id).toBe('n');
    expect(s.fromQueue).toBe(false);
    expect(s.queue).toEqual([]);
  });

  it('der vierte Eintrag verschiebt den ältesten um einen Tag, nie verworfen', () => {
    expect(QUEUE_MAX).toBe(3);
    const recall: RecallState = { a: { id: 'a', due: T - 5 * DAY_MS, results: [{ at: T - 9 * DAY_MS, got: false }] } };
    const q0 = [e('a', true, T - 3600_000), e('b', false, T - 1800_000), e('c', false, T - 900_000)];
    const s = onSwipe(q0, recall, { id: 'd', review: false }, false, T);
    expect(s.queue.map((x) => x.id)).toEqual(['b', 'c', 'd']);
    // a bleibt in der Wiedervorlage, Fälligkeit dueAt plus 1 Tag, Ergebnisse bleiben
    expect(s.recall.a.due).toBe(T - 3600_000 + DAY_MS);
    expect(s.recall.a.results).toHaveLength(1);
  });

  it('der vierte Eintrag einer neuen Karte (ohne Wiedervorlage) wird eine Wiedervorlage morgen', () => {
    const q0 = [e('a', false, T), e('b'), e('c')];
    const s = enqueue(q0, {}, e('d', false, T + 10));
    expect(s.queue.map((x) => x.id)).toEqual(['b', 'c', 'd']);
    expect(s.recall.a).toEqual({ id: 'a', due: T + DAY_MS, results: [] });
  });

  it('zweimal dieselbe Karte landet nur einmal in der Warteschlange', () => {
    const s = enqueue([e('a')], {}, e('a', true, T + 1));
    expect(s.queue).toHaveLength(1);
  });

  it('die Warteschlange wandert per Sync, der jüngere Stand gewinnt, Leeren zählt', () => {
    const base = emptyState();
    const a = stampChanges(base, { ...base, recallQueue: [e('a'), e('b')] }, 100);
    expect(a.syncTs?.[tsKey.recallQueue]).toBe(100);
    const b = stampChanges(a, { ...a, recallQueue: [] }, 200);
    expect(b.syncTs?.[tsKey.recallQueue]).toBe(200);
    const merged = mergeDocs(toDoc(a), toDoc(b));
    expect(merged.state.recallQueue).toEqual([]);
    // Reihenfolge egal
    expect(canon(mergeDocs(toDoc(b), toDoc(a)))).toBe(canon(merged));
    const other = applyDoc(a, merged);
    expect(other.recallQueue).toEqual([]);
    // ein Gerät ohne Warteschlange behält die des anderen
    expect(mergeDocs(toDoc(a), toDoc(base)).state.recallQueue).toEqual([e('a'), e('b')]);
  });
});

describe('Abrufkarte im Auto-Weiter des Audio-Reiters (Issue 11)', () => {
  it('Karte fällig, Seite hidden, Ende des Ausschnitts: recallQueue plus 1, das Deck spielt den nächsten Moment, keine Karte', () => {
    // Nachbau des Elements wie in audio-deck.test.ts
    const listeners = new Map<string, (() => void)[]>();
    const calls: string[] = [];
    let src = '';
    const el = {
      get src() { return src; },
      set src(v: string) { src = v; calls.push(`src:${v}`); },
      currentTime: 0, paused: true, ended: false, readyState: 0, duration: 600, muted: false, playbackRate: 1, defaultPlaybackRate: 1,
      removeAttribute() { src = ''; },
      addEventListener(t: string, f: () => void) { listeners.set(t, [...(listeners.get(t) ?? []), f]); },
      emit(t: string) { for (const f of listeners.get(t) ?? []) f(); },
      play() { calls.push('play'); this.paused = false; this.emit('playing'); return Promise.resolve(); },
      pause() { if (!this.paused) { this.paused = true; this.emit('pause'); } },
      load() { calls.push('load'); this.currentTime = 0; },
    };
    const deck = new AudioDeck({ local: () => undefined, dropLocal: () => {}, make: () => el as unknown as DeckEl, hidden: () => true });
    const clip = (id: string): DeckClip => ({ key: `${id}|0|4`, id, url: `https://pod.test/${id}.mp3`, start: 0, end: 4 });
    const sink = { state: () => {}, error: () => {} };
    deck.load(clip('a'), sink, { play: true, muted: false });
    deck.arm(clip('b'));
    // Die App entscheidet im onAdvance wie beim Wisch: Karte im Hintergrund nie zeigen, nur einreihen
    let queue: QueueEntry[] = [];
    let shown: QueueEntry | null = null;
    deck.onAdvance = () => {
      const step = onSwipe(queue, {}, { id: 'a', review: false }, canShowRecall(bg), T);
      queue = step.queue;
      shown = step.show;
    };
    el.currentTime = 4;
    el.emit('timeupdate');
    expect(queue.map((x) => x.id)).toEqual(['a']);
    expect(shown).toBeNull();
    expect(deck.clip?.id).toBe('b');
    expect(el.paused).toBe(false);
    expect(calls.filter((c) => c.startsWith('src:'))).toEqual(['src:https://pod.test/a.mp3', 'src:https://pod.test/b.mp3']);
    expect(calls.lastIndexOf('play')).toBeGreaterThan(calls.indexOf('src:https://pod.test/b.mp3'));
  });

  it('offene Karte beim Wechsel in den Hintergrund: zurück in die Warteschlange, vor allem anderen nicht verloren', () => {
    const r = requeueOpen([e('x', false, T + 5)], {}, e('open', false, T));
    expect(r.queue.map((x) => x.id)).toEqual(['open', 'x']);
    // Schon enthalten: nicht doppelt
    expect(requeueOpen([e('open', false, T)], {}, e('open', false, T)).queue).toHaveLength(1);
  });

  it('voll: der älteste wird um einen Tag verschoben, nie verworfen', () => {
    const q = [e('a', false, T + 1), e('b', false, T + 2), e('c', false, T + 3)];
    const r = requeueOpen(q, {}, e('open', false, T));
    expect(r.queue).toHaveLength(QUEUE_MAX);
    expect(r.queue.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(r.recall.open?.due).toBe(T + DAY_MS);
  });
});
