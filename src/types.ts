export type Area = 'beat' | 'body' | 'brain';
export type CardType = 'fact' | 'fresh' | 'verse' | 'apply' | 'recall';

export interface Card {
  id: string; // stabil, z.B. "pmid:39123456"
  area: Area;
  topic: string; // z.B. "glaukom", "retina", "ki-regulierung", "kraft"
  type: CardType;
  headline: string; // Kernaussage, plain, <= 90 Zeichen
  body?: string; // <= 280 Zeichen
  forYou?: string; // "Was das für dich ändert", nur aus Enrichment
  recall?: { q: string; a: string };
  reflection?: string; // nur Beat
  arabic?: string; // nur Beat, Originaltext
  translation?: string; // nur Beat: vollständige Übersetzung, wörtlich (Headline ist ggf. gekürzt)
  source: {
    id: string;
    title: string;
    publisher: string; // Journal, "Quran.com", "Wikipedia"
    year?: number;
    url: string;
    excerpt: string; // wörtlich
  };
  createdAt: string; // ISO
}

/** Eine Datei unter public/cards/ */
export interface CardFile {
  date: string;
  cards: Card[];
}

export interface CardIndex {
  updatedAt: string;
  files: { name: string; count: number }[];
  total: number;
}

export interface Interests {
  areas: Record<Area, number>;
  topics: Record<Area, string[]>;
  dailyRoundLimit: number;
}
