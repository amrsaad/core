import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BP_DESKTOP, BP_TABLET } from '../src/design/breakpoints';

// Entscheidung 22 und 43, Brief 06: Werte nur aus tokens.css, Kontrast AA je Stimmung, Umbrüche in CSS und TS gleich.
const css = readFileSync('src/design/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Blöcke mit Selektor und Deklarationen. Verschachtelt wird nur eine Ebene (@media) aufgelöst. */
type Rule = { sel: string; media: string; decl: Record<string, string> };
function rules(): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  const walk = (src: string, media: string) => {
    const re = /([^{}]+)\{/g;
    let m: RegExpExecArray | null;
    let pos = 0;
    while ((m = re.exec(src.slice(pos)))) {
      const sel = m[1].trim();
      const start = pos + m.index + m[0].length;
      let depth = 1;
      let j = start;
      while (depth && j < src.length) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      const body = src.slice(start, j - 1);
      if (sel.startsWith('@media')) walk(body, sel);
      else if (!sel.startsWith('@')) {
        const decl: Record<string, string> = {};
        for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decl[d[1]] = d[2].trim();
        out.push({ sel, media, decl });
      }
      pos = j;
      re.lastIndex = 0;
      i++;
      if (i > 500) break;
    }
  };
  walk(css, '');
  return out;
}
const R = rules();

/** Palette für Stimmung und Schema: neutral beginnt bei :root, danach überschreibt die Stimmung */
function palette(mood: string | null, light: boolean): Record<string, string> {
  const pick = (r: Rule) => (r.media === '' || (light && r.media.includes('light'))) as boolean;
  const base: Record<string, string> = {};
  for (const r of R.filter((x) => x.sel === ':root' && pick(x))) Object.assign(base, r.decl);
  if (mood) for (const r of R.filter((x) => x.sel === `[data-mood='${mood}']` && pick(x))) Object.assign(base, r.decl);
  return base;
}

function lin(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function rgb(v: string): [number, number, number, number] {
  const h = v.match(/^#([0-9a-f]{6})$/i);
  if (h) return [parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4), 16), 1];
  const r = v.match(/^rgba?\(([^)]+)\)$/);
  if (r) {
    const p = r[1].split(',').map((x) => parseFloat(x));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  throw new Error(`no color: ${v}`);
}
function over(fg: string, bg: string): [number, number, number] {
  const [r, g, b, a] = rgb(fg);
  const [br, bg2, bb] = rgb(bg);
  return [r * a + br * (1 - a), g * a + bg2 * (1 - a), b * a + bb * (1 - a)];
}
const L = (c: [number, number, number]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
export function contrast(fg: string, bg: string): number {
  const a = L(over(fg, bg));
  const b = L(rgb(bg).slice(0, 3) as [number, number, number]);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const MOODS: Array<[string | null, boolean]> = [
  [null, false], [null, true], ['beat', false], ['body', false], ['brain', false], ['brain', true],
];

describe('tokens: Kontrast AA je Stimmung', () => {
  for (const [mood, light] of MOODS) {
    const name = `${mood ?? 'neutral'} ${light ? 'hell' : 'dunkel'}`;
    const p = palette(mood, light);
    // Text auf Fläche: 4.5 für Fließtext, Bedienelemente und Hinweise ebenso (kleiner Text). Muted und soft sind Meta-Text.
    const pairs: Array<[string, string, string, number]> = [
      ['--text', '--bg', 'Text auf Hintergrund', 4.5],
      ['--text', '--surface', 'Text auf Fläche', 4.5],
      ['--body', '--bg', 'Fließtext auf Hintergrund', 4.5],
      ['--body', '--surface', 'Fließtext auf Fläche', 4.5],
      ['--muted', '--bg', 'Meta auf Hintergrund', 4.5],
      ['--muted', '--surface', 'Meta auf Fläche', 4.5],
      ['--soft', '--bg', 'Hinweis auf Hintergrund', 4.5],
      ['--accent', '--bg', 'Akzent auf Hintergrund', 4.5],
      ['--kicker', '--bg', 'Kicker auf Hintergrund', 4.5],
      ['--on-accent', '--accent', 'Text auf Akzent', 4.5],
    ];
    for (const [fg, bg, label, min] of pairs) {
      it(`${name}: ${label} (${fg} auf ${bg}) mindestens ${min}`, () => {
        expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(min);
      });
    }
  }
  it('Bereichsfarben bleiben auf Schwarz lesbar (Punkt am Kanal, Zähler)', () => {
    const p = palette(null, false);
    for (const c of ['--c-beat', '--c-body', '--c-brain']) expect(contrast(p[c], '#000000')).toBeGreaterThanOrEqual(4.5);
  });
  it('Medienfläche: weißer Text auf Schleier', () => {
    const p = palette(null, false);
    expect(contrast(p['--on-media'], '#000000')).toBeGreaterThanOrEqual(7);
    expect(contrast(p['--on-media-muted'], p['--media-shade'].replace(/^rgba.*$/, '#000000'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('tokens: Umbrüche', () => {
  it('Zahlen in tokens.css und breakpoints.ts sind gleich', () => {
    const raw = readFileSync('src/design/tokens.css', 'utf8');
    expect(raw).toContain(`@media (min-width: ${BP_TABLET}px)`);
    expect(raw).toContain(`@media (min-width: ${BP_DESKTOP}px)`);
    expect(BP_DESKTOP).toBe(1181);
  });
  it('Mindestgröße der Berührfläche ist 44 px', () => {
    expect(palette(null, false)['--hit']).toBe('44px');
  });
  it('Überblendung der Stimmung 400 ms', () => {
    expect(palette(null, false)['--dur-mood']).toBe('400ms');
  });
});

/**
 * Lint: kein Farbliteral außerhalb von tokens.css.
 * Neue Komponenten und Screens (src/components, src/design) dürfen keins haben.
 * Alter Code ist gedeckelt (Ratsche): die Zahl pro Datei darf nicht steigen. Jeder Block von Brief 06 senkt sie, am Ende steht der Rest nur noch in den Dateien mit Begründung.
 */
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(f) ? [p] : [];
  });
}
// Stand bei Start von Brief 06 (04.11.2026). Nur senken.
const CAP: Record<string, number> = {
  'src/App.tsx': 0,
  'src/index.css': 41,
  'src/moments/MomentFeed.tsx': 4,
  'src/moments/MomentModal.tsx': 1,
  'src/moments/NoteSheet.tsx': 0,
  'src/video/VideoFeed.tsx': 11,
  'src/video/ytApi.ts': 1,
  'src/video/VideoModal.tsx': 1,
  'src/screens/SyncCard.tsx': 0,
  'src/screens/SavedTabs.tsx': 1,
};
describe('lint: Farbliterale', () => {
  const all = files('src').map((f) => relative('.', f));
  it('nur tokens.css darf Literale haben, alter Code nur bis zur Deckelung', () => {
    const over: string[] = [];
    for (const f of all) {
      if (f === 'src/design/tokens.css') continue;
      const n = (readFileSync(f, 'utf8').match(LITERAL) ?? []).length;
      const cap = CAP[f] ?? 0;
      if (n > cap) over.push(`${f}: ${n} Literale, erlaubt ${cap}`);
    }
    expect(over).toEqual([]);
  });
  it('src/components und src/design (außer tokens.css) haben keine Literale', () => {
    for (const f of all.filter((x) => x.startsWith('src/components/') || (x.startsWith('src/design/') && x !== 'src/design/tokens.css'))) {
      expect(readFileSync(f, 'utf8').match(LITERAL) ?? [], f).toEqual([]);
    }
  });
});
