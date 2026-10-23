import { createEmptyCard, fsrs, Rating, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import type { Card } from '../types';
import type { SavedItem } from './state';

const scheduler = fsrs({ enable_fuzz: false });

export { Rating };
export const GRADES: { label: string; rating: Grade }[] = [
  { label: 'Nochmal', rating: Rating.Again },
  { label: 'Schwer', rating: Rating.Hard },
  { label: 'Gut', rating: Rating.Good },
  { label: 'Leicht', rating: Rating.Easy },
];

function toJson(c: FsrsCard): Record<string, unknown> {
  return { ...c, due: c.due.toISOString(), last_review: c.last_review?.toISOString() };
}

function fromJson(o: Record<string, unknown>): FsrsCard {
  return { ...(o as unknown as FsrsCard), due: new Date(o.due as string), last_review: o.last_review ? new Date(o.last_review as string) : undefined };
}

export function newSaved(card: Card, now: Date): SavedItem {
  // Erste Wiederholung am Folgetag: gespeichert heißt "einmal gesehen und für gut befunden"
  const first = scheduler.next(createEmptyCard(now), now, Rating.Good).card;
  return { card, savedAt: now.toISOString(), fsrs: toJson(first) };
}

export function review(item: SavedItem, rating: Grade, now: Date): SavedItem {
  const next = scheduler.next(fromJson(item.fsrs), now, rating).card;
  return { ...item, fsrs: toJson(next) };
}

export function dueDate(item: SavedItem): Date {
  return new Date(item.fsrs.due as string);
}

export function isDue(item: SavedItem, now: Date): boolean {
  return dueDate(item).getTime() <= now.getTime();
}

/** Behalten = mindestens einmal wiederholt und zuletzt nicht vergessen */
export function isRetained(item: SavedItem): boolean {
  return Number(item.fsrs.reps ?? 0) >= 2 && Number(item.fsrs.state) === 2;
}
