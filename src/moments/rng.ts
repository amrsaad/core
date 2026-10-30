// Zufall der Momente-Mischung und der Antwortreihenfolge. Test-Hook: ?seed=7 macht beides deterministisch
// (wird in sessionStorage gemerkt). Ohne Seed gilt Math.random.
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(): () => number {
  try {
    const p = new URLSearchParams(location.search).get('seed') ?? sessionStorage.getItem('core-seed');
    if (p !== null && p !== '' && !Number.isNaN(Number(p))) {
      sessionStorage.setItem('core-seed', p);
      return mulberry32(Number(p));
    }
  } catch {
    /* kein location in Tests */
  }
  return Math.random;
}
