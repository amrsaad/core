import { describe, expect, it } from 'vitest';
import { STATUS_ORDER, STATUS_TEXT, statusOf, type StatusInput } from '../src/components/status';

const none: StatusInput = { offline: false, syncError: null, loading: false, background: false, muted: false };

describe('Status: ein Zustand, feste Rangfolge (Entscheidung 22E)', () => {
  it('ohne Anlass kein Zustand', () => expect(statusOf(none)).toBeNull());
  it('jeder Zustand allein', () => {
    expect(statusOf({ ...none, offline: true })).toBe('offline');
    expect(statusOf({ ...none, syncError: 'x' })).toBe('sync');
    expect(statusOf({ ...none, loading: true })).toBe('loading');
    // Brief 12: "Next is ready" nur zusammen mit Laden, allein bleibt es ohne Zustand
    expect(statusOf({ ...none, loading: true, nextReady: true })).toBe('next');
    expect(statusOf({ ...none, nextReady: true })).toBeNull();
    expect(statusOf({ ...none, background: true })).toBe('background');
    expect(statusOf({ ...none, muted: true })).toBe('muted');
  });
  it('Vorrang Offline, Sync-Fehler, Next is ready, Laden, Hintergrund, Stumm', () => {
    const all: StatusInput = { offline: true, syncError: 'x', loading: true, nextReady: true, background: true, muted: true };
    const seen: string[] = [];
    let cur = { ...all };
    for (let i = 0; i < 6; i++) {
      const k = statusOf(cur)!;
      seen.push(k);
      cur = { ...cur, offline: k === 'offline' ? false : cur.offline, syncError: k === 'sync' ? null : cur.syncError, nextReady: k === 'next' ? false : cur.nextReady, loading: k === 'loading' ? false : cur.loading, background: k === 'background' ? false : cur.background, muted: k === 'muted' ? false : cur.muted };
    }
    expect(seen).toEqual(STATUS_ORDER);
  });
  it('Texte ohne Gedankenstrich und ohne Semikolon', () => {
    for (const t of Object.values(STATUS_TEXT)) expect(t).not.toMatch(/[–—;]/);
  });
});
