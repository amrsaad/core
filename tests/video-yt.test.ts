import { describe, expect, it } from 'vitest';
import { channelHits, channelIdFromPage, nameMatches, parseFeed, shortsTabIds } from '../pipeline/video/yt';

describe('YouTube-Parser', () => {
  it('liest channelId aus canonical oder externalId', () => {
    expect(channelIdFromPage('<link rel="canonical" href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv">')).toBe('UCabcdefghijklmnopqrstuv');
    expect(channelIdFromPage('..."externalId":"UCzyxwvutsrqponmlkjihgfe"...')).toBe('UCzyxwvutsrqponmlkjihgfe');
    expect(channelIdFromPage('nichts')).toBeNull();
  });

  it('liest Kanal-Treffer mit Badge und Handle', () => {
    const html = '"channelRenderer":{"channelId":"UCaaaaaaaaaaaaaaaaaaaaaa","title":{"simpleText":"Fake Fireship"},"x":1}' +
      '"channelRenderer":{"channelId":"UCbbbbbbbbbbbbbbbbbbbbbb","title":{"simpleText":"Fireship"},"canonicalBaseUrl":"/@Fireship","ownerBadges":[{"style":"BADGE_STYLE_TYPE_VERIFIED"}]}';
    const hits = channelHits(html);
    expect(hits).toHaveLength(2);
    expect(hits[0].verified).toBe(false);
    expect(hits[1]).toMatchObject({ channelId: 'UCbbbbbbbbbbbbbbbbbbbbbb', verified: true, handle: '@Fireship' });
  });

  it('Namensabgleich', () => {
    expect(nameMatches('Nouman Ali Khan / Bayyinah', 'Nouman Ali Khan')).toBe(true);
    expect(nameMatches('Ahmad Al Shugairi/أحمد الشقيري', 'أحمد الشقيري')).toBe(true);
    expect(nameMatches('Fireship', 'Beyond Fireship')).toBe(true);
    expect(nameMatches('Anthropic', 'Claude Tutorials')).toBe(false);
  });

  it('parst Atom-Feed', () => {
    const xml = '<feed><entry><yt:videoId>abcdefghijk</yt:videoId><title>Tipp &amp; Trick</title><published>2026-10-01T10:00:00+00:00</published><media:thumbnail url="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" width="480"/></entry></feed>';
    expect(parseFeed(xml)).toEqual([{ id: 'abcdefghijk', title: 'Tipp & Trick', published: '2026-10-01T10:00:00+00:00', thumb: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' }]);
  });

  it('liest IDs aus dem Shorts-Tab', () => {
    expect(shortsTabIds('"reelWatchEndpoint":{"videoId":"aaaaaaaaaaa"} "url":"/shorts/bbbbbbbbbbb" "url":"/shorts/aaaaaaaaaaa"')).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  });
});
