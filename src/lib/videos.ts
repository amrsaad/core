import type { VideoPool } from '../videoTypes';

export async function loadPool(): Promise<VideoPool> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}videos/pool.json`, { cache: 'no-cache' });
    if (!res.ok) return { updatedAt: '', videos: [] };
    return (await res.json()) as VideoPool;
  } catch {
    return { updatedAt: '', videos: [] };
  }
}
