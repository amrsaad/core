import { describe, expect, it } from 'vitest';
import { fullVideoUrl } from '../src/moments/types';

describe('fullVideoUrl', () => {
  it('nutzt die Podcast- oder Stream-Adresse, wenn vorhanden', () => {
    expect(fullVideoUrl({ videoId: 'pod-abc123', start: 10, url: 'https://soundcloud.com/x/y' })).toBe('https://soundcloud.com/x/y');
  });
  it('nutzt sourceUrl bei Text-Momenten', () => {
    expect(fullVideoUrl({ videoId: 'txt-abc123', start: 0, sourceUrl: 'https://example.org/a' })).toBe('https://example.org/a');
  });
  it('baut YouTube nur bei echter YouTube-ID', () => {
    expect(fullVideoUrl({ videoId: 'dQw4w9WgXcQ', start: 42.7 })).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42');
  });
  it('liefert nichts für Text- oder Podcast-IDs ohne Adresse, nie einen falschen YouTube-Link', () => {
    expect(fullVideoUrl({ videoId: 'txt-abc123', start: 0 })).toBeUndefined();
    expect(fullVideoUrl({ videoId: 'pod-abc123:1', start: 0 })).toBeUndefined();
    expect(fullVideoUrl({ videoId: 'cyb-y1x5ec1wk8', start: 0 })).toBeUndefined();
  });
});
