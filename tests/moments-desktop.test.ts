import { describe, expect, it } from 'vitest';
import { createWheel, deskHelpDue, deskKey, endsFast, HELP_ROWS, DESKTOP_MIN, DESKTOP_QUERY, wheelPx, WHEEL_PX, WHEEL_QUIET_MS, type DeskCtx, type KeyIn } from '../src/moments/desktop';

const base: DeskCtx = { typing: false, help: false, sheet: false, note: false, recall: null };
const k = (key: string, o: Partial<KeyIn> = {}): KeyIn => ({ key, code: o.code ?? '', shift: false, ctrl: false, meta: false, alt: false, ...o });
const act = (key: string, ctx: Partial<DeskCtx> = {}, o: Partial<KeyIn> = {}) => deskKey({ ...base, ...ctx }, k(key, o));

describe('Desktop-Modus, Schwelle', () => {
  it('900 px, nicht 899', () => {
    expect(DESKTOP_MIN).toBe(900);
    expect(DESKTOP_QUERY).toBe('(min-width: 900px)');
  });
});

describe('Tasten im Feed', () => {
  it('Pfeile oder J und K blättern', () => {
    expect(act('ArrowDown')).toBe('next');
    expect(act('j')).toBe('next');
    expect(act('J')).toBe('next');
    expect(act('ArrowUp')).toBe('prev');
    expect(act('k')).toBe('prev');
  });
  it('Leertaste ist Pause, auch über den Code', () => {
    expect(act(' ', {}, { code: 'Space' })).toBe('pause');
    expect(act('Spacebar', {}, { code: 'Space' })).toBe('pause');
  });
  it('M, L, S, O, F, C', () => {
    expect([act('m'), act('l'), act('s'), act('o'), act('f'), act('c')]).toEqual(['mute', 'like', 'save', 'source', 'note', 'caption']);
  });
  it('1 2 3 sind die Reiter', () => {
    expect([act('1'), act('2'), act('3')]).toEqual(['tab1', 'tab2', 'tab3']);
    expect(act('4')).toBeNull();
  });
  it('Shift+. an der Taste, auch wenn das Zeichen ein Doppelpunkt ist', () => {
    expect(act('>', {}, { shift: true, code: 'Period' })).toBe('fastOn');
    expect(act(':', {}, { shift: true, code: 'Period' })).toBe('fastOn');
    expect(act('.', {}, { code: 'Period' })).toBeNull();
  });
  it('Loslassen von . oder Shift beendet das 2x', () => {
    expect(endsFast({ key: '.', code: 'Period' })).toBe(true);
    expect(endsFast({ key: 'Shift', code: 'ShiftLeft' })).toBe(true);
    expect(endsFast({ key: 'j', code: 'KeyJ' })).toBe(false);
  });
  it('Medientasten steuern Pause, nächster und voriger Moment', () => {
    expect(act('MediaPlayPause')).toBe('pause');
    expect(act('MediaTrackNext')).toBe('next');
    expect(act('MediaTrackPrevious')).toBe('prev');
  });
  it('Esc und ? gehen immer durch', () => {
    expect(act('Escape')).toBe('close');
    expect(act('?', {}, { shift: true })).toBe('help');
  });
  it('Strg, Cmd und Alt gehören dem Browser', () => {
    for (const o of [{ ctrl: true }, { meta: true }, { alt: true }]) {
      expect(act('r', {}, o)).toBeNull();
      expect(act('1', {}, o)).toBeNull();
      expect(act('Escape', {}, o)).toBeNull();
    }
  });
});

describe('Tasten in anderen Zuständen', () => {
  it('Im Eingabefeld nur Esc, ? und alles andere bleibt Text', () => {
    for (const key of ['j', 'k', 'm', 'l', 's', 'o', 'f', 'c', '1', '?', ' ', 'Enter']) expect(act(key, { typing: true })).toBeNull();
    expect(act('Escape', { typing: true })).toBe('close');
  });
  it('Übersicht und Seitenblatt: nur Esc und ?', () => {
    for (const ctx of [{ help: true }, { sheet: true }]) {
      expect(act('j', ctx)).toBeNull();
      expect(act('m', ctx)).toBeNull();
      expect(act('1', ctx)).toBeNull();
      expect(act('Escape', ctx)).toBe('close');
      expect(act('?', ctx)).toBe('help');
    }
  });
  it('Rückmeldung: 1 bis 6 Chips, Enter Text, sonst nichts', () => {
    const c = { note: true };
    expect(['1', '2', '3', '4', '5', '6'].map((x) => act(x, c))).toEqual(['chip1', 'chip2', 'chip3', 'chip4', 'chip5', 'chip6']);
    expect(act('7', c)).toBeNull();
    expect(act('Enter', c)).toBe('noteText');
    for (const key of ['j', 'k', 'm', 'l', 's', 'o', 'f', 'c', ' ']) expect(act(key, c)).toBeNull();
    expect(act('Escape', c)).toBe('close');
  });
  it('Abrufkarte offen: 1 2 3 antworten, Enter wirkt noch nicht', () => {
    const c = { recall: 'open' as const };
    expect([act('1', c), act('2', c), act('3', c)]).toEqual(['pick1', 'pick2', 'pick3']);
    expect(act('4', c)).toBeNull();
    expect(act('Enter', c)).toBeNull();
    for (const key of ['j', 'k', 'ArrowDown', 'm', 'l', 's', 'f', 'c', ' ']) expect(act(key, c)).toBeNull();
    expect(act('Escape', c)).toBe('close');
  });
  it('Abrufkarte beantwortet: Enter ist Next, Ziffern zählen nicht mehr', () => {
    const c = { recall: 'answered' as const };
    expect(act('Enter', c)).toBe('recallNext');
    expect(act('1', c)).toBeNull();
    expect(act('j', c)).toBeNull();
    expect(act('Escape', c)).toBe('close');
  });
  it('Enter im Feed macht nichts', () => {
    expect(act('Enter')).toBeNull();
  });
});

describe('Übersicht', () => {
  it('erscheint genau einmal', () => {
    expect(deskHelpDue(undefined)).toBe(true);
    expect(deskHelpDue(false)).toBe(true);
    expect(deskHelpDue(true)).toBe(false);
  });
  it('nennt jede Taste', () => {
    const all = HELP_ROWS.map((r) => `${r.keys} ${r.text}`).join(' | ');
    for (const x of ['J', 'K', 'Space', 'M', 'Shift', 'L', 'S', 'O', 'F', '1 2 3', 'C', 'Esc', 'Enter', '?', 'Two fingers']) expect(all).toContain(x);
  });
  it('ohne Gedankenstrich', () => {
    expect(HELP_ROWS.every((r) => !/[–—]/.test(r.keys + r.text))).toBe(true);
  });
});

describe('Trackpad', () => {
  /** Wisch: Werte je 16 ms, wie ein Trackpad mit Nachlauf (klingt aus) */
  const swipe = (w: ReturnType<typeof createWheel>, t0: number, dy: number, dx = 0, edge?: { top: boolean; end: boolean }) => {
    const ramp = [6, 18, 34, 42, 40, 36, 30, 25, 20, 16, 12, 9, 6, 4, 3, 2, 1];
    const out: ReturnType<typeof w.feed>[] = [];
    ramp.forEach((v, i) => out.push(w.feed({ dx: dx * v, dy: dy * v, t: t0 + i * 16 }, edge)));
    return { out, end: t0 + ramp.length * 16 };
  };
  const acts = (o: { act: unknown }[]) => o.map((x) => x.act).filter(Boolean);

  it('ein Wisch nach unten ist genau ein nächster Moment, der Nachlauf zählt nicht', () => {
    const w = createWheel();
    const { out } = swipe(w, 1000, 1);
    expect(acts(out)).toEqual(['next']);
    expect(out.every((x) => x.consume)).toBe(true);
  });
  it('ein Wisch nach oben ist genau ein voriger Moment', () => {
    expect(acts(swipe(createWheel(), 1000, -1).out)).toEqual(['prev']);
  });
  it('nach einer Pause zählt der nächste Wisch wieder', () => {
    const w = createWheel();
    const a = swipe(w, 1000, 1);
    const b = swipe(w, a.end + WHEEL_QUIET_MS + 40, 1);
    expect(acts(a.out)).toEqual(['next']);
    expect(acts(b.out)).toEqual(['next']);
  });
  it('ein neuer Wisch im Nachlauf des alten zählt auch, ohne Pause', () => {
    const w = createWheel();
    const a = swipe(w, 1000, 1);
    // gleich anschließend, die Werte steigen wieder
    const b = swipe(w, a.end + 20, -1);
    expect(acts(a.out)).toEqual(['next']);
    expect(acts(b.out)).toEqual(['prev']);
  });
  it('zu kurze Wische zählen nicht', () => {
    const w = createWheel();
    const out = [10, 10, 10, 10, 10].map((dy, i) => w.feed({ dx: 0, dy, t: 1000 + i * 16 }));
    expect(WHEEL_PX).toBe(60);
    expect(acts(out)).toEqual([]);
  });
  it('Mausrad: eine Raste ist ein Schritt', () => {
    const w = createWheel();
    expect(w.feed({ dx: 0, dy: 100, t: 0 }).act).toBe('next');
    expect(w.feed({ dx: 0, dy: -100, t: 400 }).act).toBe('prev');
  });
  it('zwei Finger nach links öffnet die Rückmeldung, der Gegenzug nichts', () => {
    const left = swipe(createWheel(), 1000, 0, 1);
    expect(acts(left.out)).toEqual(['note']);
    const right = swipe(createWheel(), 1000, 0, -1);
    expect(acts(right.out)).toEqual([]);
    expect(right.out.every((x) => x.consume)).toBe(true);
  });
  it('überwiegend senkrecht gewinnt gegen leichtes Zittern zur Seite', () => {
    const w = createWheel();
    const { out } = swipe(w, 1000, 1, 0.2);
    expect(acts(out)).toEqual(['next']);
  });
  it('Text: mitten im Text scrollt der Text, kein Blättern, nichts wird verschluckt', () => {
    const w = createWheel();
    const { out } = swipe(w, 1000, 1, 0, { top: false, end: false });
    expect(acts(out)).toEqual([]);
    expect(out.every((x) => !x.consume)).toBe(true);
  });
  it('Text: Wisch, der am Textende beginnt, blättert', () => {
    expect(acts(swipe(createWheel(), 1000, 1, 0, { top: false, end: true }).out)).toEqual(['next']);
  });
  it('Text: Wisch nach unten am Textanfang blättert nicht zurück, nach oben schon', () => {
    expect(acts(swipe(createWheel(), 1000, 1, 0, { top: true, end: false }).out)).toEqual([]);
    expect(acts(swipe(createWheel(), 1000, -1, 0, { top: true, end: false }).out)).toEqual(['prev']);
  });
  it('Text: ein Wisch, der mitten im Text beginnt und am Ende ankommt, blättert nicht von selbst', () => {
    const w = createWheel();
    const a = swipe(w, 1000, 1, 0, { top: false, end: false });
    expect(acts(a.out)).toEqual([]);
    // ein zweiter, bewusster Wisch nach einer Pause am Ende blättert
    const b = swipe(w, a.end + WHEEL_QUIET_MS + 40, 1, 0, { top: false, end: true });
    expect(acts(b.out)).toEqual(['next']);
  });
  it('Zeilen und Seiten werden in Pixel umgerechnet', () => {
    expect(wheelPx({ deltaX: 0, deltaY: 100, deltaMode: 0 })).toEqual({ dx: 0, dy: 100 });
    expect(wheelPx({ deltaX: 1, deltaY: 4, deltaMode: 1 })).toEqual({ dx: 16, dy: 64 });
    expect(wheelPx({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 900)).toEqual({ dx: 0, dy: 900 });
  });
});
