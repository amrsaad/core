import type { Area } from './types';

export interface Channel {
  name: string;
  query: string;
  area: Area;
  topic: string;
  lang: string;
  channelId: string | null;
  status?: 'active' | 'unresolved' | 'inactive';
  /** Wie die ID gefunden wurde (Nachvollziehbarkeit) */
  resolvedBy?: string;
  resolvedTitle?: string;
  verified?: boolean;
  note?: string;
  lastShort?: string;
}

export interface Video {
  id: string;
  channelId: string;
  channelName: string;
  area: Area;
  topic: string;
  lang: string;
  title: string;
  published: string | null;
  thumb: string;
}

export interface VideoPool {
  updatedAt: string;
  videos: Video[];
}
