import type { Card, CardFile, CardIndex } from '../types';

const base = import.meta.env.BASE_URL;

export interface Library {
  cards: Card[];
  index: CardIndex;
}

export async function loadLibrary(): Promise<Library> {
  const index = (await (await fetch(`${base}cards/index.json`, { cache: 'no-cache' })).json()) as CardIndex;
  const files = await Promise.all(
    index.files.map(async (f) => {
      try {
        return (await (await fetch(`${base}cards/${f.name}`)).json()) as CardFile;
      } catch {
        return { date: '', cards: [] } as CardFile;
      }
    }),
  );
  const byId = new Map<string, Card>();
  for (const f of files) for (const c of f.cards) byId.set(c.id, c);
  return { cards: [...byId.values()], index };
}
