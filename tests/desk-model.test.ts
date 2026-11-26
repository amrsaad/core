import { describe, expect, it } from 'vitest';
import { clipLen, coverLetter, groupTop, scrolledToEnd, fracAtPointer, fracOf, hookSize, inClip, keyHints, lyricLines, openLabel, queuedAfter, seekBy, seekPos, upNext, QUEUE_SHOWN, SEEK_S } from '../src/moments/desk/model';
import { deskKey, HELP_ROWS, type DeskCtx, type KeyIn } from '../src/moments/desktop';
import type { Moment } from '../src/moments/types';

const mom = (i: number, area: 'brain' | 'body' | 'beat' = 'brain'): Moment => ({ id: `t${i}:1`, videoId: `t${i}`, start: 100, end: 160, channel: 'c', videoTitle: 'v', area, topic: 'x', hook: `h${i}`, kind: 'regel', createdAt: '' });

describe('Zeitleiste der Mac-Ansicht', () => {
  it('Anteil und Klemmen', () => {
    expect(fracOf(130, 100, 160)).toBe(0.5);
    expect(fracOf(90, 100, 160)).toBe(0);
    expect(fracOf(200, 100, 160)).toBe(1);
    expect(fracOf(NaN, 100, 160)).toBe(0);
    expect(fracOf(5, 10, 10)).toBe(0);
  });
  it('Sprung auf einen Anteil bleibt im Ausschnitt, Ende eine Sekunde davor', () => {
    expect(seekPos(0, 100, 160)).toBe(100);
    expect(seekPos(0.5, 100, 160)).toBe(130);
    expect(seekPos(1, 100, 160)).toBe(159);
    expect(seekPos(-3, 100, 160)).toBe(100);
    expect(seekPos(9, 100, 160)).toBe(159);
    expect(seekPos(0.9, 100, 100.5)).toBe(100);
  });
  it('Sprung um 10 Sekunden klemmt an beiden Enden', () => {
    expect(SEEK_S).toBe(10);
    expect(seekBy(120, 10, 100, 160)).toBe(130);
    expect(seekBy(120, -10, 100, 160)).toBe(110);
    expect(seekBy(105, -10, 100, 160)).toBe(100);
    expect(seekBy(155, 10, 100, 160)).toBe(159);
    expect(seekBy(NaN, 10, 100, 160)).toBe(110);
  });
  it('Zeigerposition und Zeitanzeige', () => {
    expect(fracAtPointer(150, 100, 200)).toBe(0.25);
    expect(fracAtPointer(50, 100, 200)).toBe(0);
    expect(fracAtPointer(900, 100, 200)).toBe(1);
    expect(fracAtPointer(5, 0, 0)).toBe(0);
    expect(clipLen(mom(1))).toBe(60);
    expect(inClip(0.5, mom(1))).toBe(30);
    expect(inClip(2, mom(1))).toBe(60);
  });
});

describe('Warteschlange', () => {
  const q = Array.from({ length: 10 }, (_, i) => mom(i));
  it('laufender Moment zuerst, dahinter die nächsten, höchstens QUEUE_SHOWN', () => {
    const rows = upNext(q, 2);
    expect(rows).toHaveLength(QUEUE_SHOWN);
    expect(rows[0]).toMatchObject({ index: 2, current: true, hook: 'h2' });
    expect(rows[1]).toMatchObject({ index: 3, current: false });
  });
  it('am Ende nichts erfunden', () => {
    expect(upNext(q, 9)).toHaveLength(1);
    expect(upNext(q, 10)).toHaveLength(0);
    expect(upNext([], 0)).toHaveLength(0);
    expect(queuedAfter(q, 2)).toBe(7);
    expect(queuedAfter(q, 12)).toBe(0);
  });
});

describe('Anzeige', () => {
  it('Untertitelfeld aus den Cues', () => {
    const cues: [number, string][] = [[0, ' a '], [2, 'b'], [4, 'c']];
    expect(lyricLines(cues, 1)).toEqual({ prev: 'a', cur: 'b', next: 'c' });
    expect(lyricLines(cues, 0)).toEqual({ prev: '', cur: 'a', next: 'b' });
    expect(lyricLines(cues, 2)).toEqual({ prev: 'b', cur: 'c', next: '' });
    expect(lyricLines(cues, 3)).toEqual({ prev: '', cur: '', next: '' });
    expect(lyricLines(cues, -1)).toEqual({ prev: '', cur: '', next: '' });
    expect(lyricLines(cues, -2)).toEqual({ prev: '', cur: '', next: '' });
    expect(lyricLines(undefined, 0)).toEqual({ prev: '', cur: '', next: '' });
    expect(lyricLines([[0, 'only']], 0)).toEqual({ prev: '', cur: 'only', next: '' });
  });
  it('Cover-Platzhalter: Anfangsbuchstabe des Kanals', () => {
    expect(coverLetter('Kanal beat (Dr. Test 0)')).toBe('K');
    expect(coverLetter('  élan vital')).toBe('É');
    expect(coverLetter('"7 Tage"')).toBe('7');
    expect(coverLetter('القناة')).toBe('ا');
    expect(coverLetter('')).toBe('\u00b7');
    expect(coverLetter('--- ')).toBe('\u00b7');
  });
  it('Auslauf unten entfällt am Ende und ohne Scrollweg', () => {
    expect(scrolledToEnd(0, 500, 2000)).toBe(false);
    expect(scrolledToEnd(1499, 500, 2000)).toBe(true);
    expect(scrolledToEnd(1000, 500, 2000)).toBe(false);
    expect(scrolledToEnd(0, 500, 500)).toBe(true);
    expect(scrolledToEnd(0, 500, 501)).toBe(true);
  });
  it('Mediengruppe mittig, nie über dem Mindestabstand', () => {
    expect(groupTop(800, 600, 40)).toBe(100);
    expect(groupTop(800, 790, 40)).toBe(40);
    expect(groupTop(800, 900, 40)).toBe(40);
    expect(groupTop(0, 100, 40)).toBe(40);
    expect(groupTop(800, 0, 40)).toBe(40);
  });
  it('Hook wird nur kleiner gesetzt, nie gekürzt', () => {
    expect([hookSize('a'.repeat(80)), hookSize('a'.repeat(81)), hookSize('a'.repeat(150)), hookSize('a'.repeat(151))]).toEqual(['l', 'm', 'm', 's']);
  });
  it('Beschriftungen und Tastaturhilfe je Reiter', () => {
    expect([openLabel('audio'), openLabel('video'), openLabel('text')]).toEqual(['Open full episode', 'Open full video', 'Open source']);
    expect(keyHints('text', false, false).map((r) => r.keys)).toEqual(['↓ ↑', '1 2 3']);
    expect(keyHints('video', true, true).some((r) => r.keys === '→ ←')).toBe(true);
    expect(keyHints('audio', true, false).some((r) => r.keys === '→ ←')).toBe(false);
    expect(keyHints('video', false, true).some((r) => r.keys === 'C')).toBe(false);
    for (const r of [...keyHints('video', true, true), ...keyHints('text', false, false)]) expect(/[–—]/.test(r.label + r.keys)).toBe(false);
  });
});

describe('Tasten der Mac-Ansicht', () => {
  const base: DeskCtx = { typing: false, help: false, sheet: false, note: false, recall: null };
  const k = (key: string, o: Partial<KeyIn> = {}): KeyIn => ({ key, code: '', shift: false, ctrl: false, meta: false, alt: false, ...o });
  const act = (key: string, ctx: Partial<DeskCtx> = {}) => deskKey({ ...base, ...ctx }, k(key));
  it('Pfeile rechts und links springen, T teilt, V ist Vollbild, F bleibt die Rückmeldung', () => {
    expect([act('ArrowRight'), act('ArrowLeft'), act('t'), act('v'), act('f'), act('c')]).toEqual(['seekFwd', 'seekBack', 'share', 'fullscreen', 'note', 'caption']);
  });
  it('keine Kürzel bei Eingabefeld, Abrufkarte, Rückmeldung oder offenem Blatt', () => {
    for (const key of ['ArrowRight', 'ArrowLeft', 't', 'v']) {
      expect(act(key, { typing: true })).toBeNull();
      expect(act(key, { recall: 'open' })).toBeNull();
      expect(act(key, { note: true })).toBeNull();
      expect(act(key, { sheet: true })).toBeNull();
      expect(act(key, { help: true })).toBeNull();
    }
  });
  it('Cmd und Alt mit Pfeilen gehören dem Browser (Zurück, Vor)', () => {
    expect(deskKey(base, k('ArrowLeft', { meta: true }))).toBeNull();
    expect(deskKey(base, k('ArrowRight', { alt: true }))).toBeNull();
  });
  it('jede neue Taste steht in der Übersicht, ohne Gedankenstriche', () => {
    const all = HELP_ROWS.map((r) => `${r.keys} ${r.text}`).join(' | ');
    for (const x of ['Right or Left', 'T ', 'V ', 'Captions']) expect(all).toContain(x);
  });
});
