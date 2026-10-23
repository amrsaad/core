import { describe, expect, it } from 'vitest';
import type { Card } from '../src/types';
import type { RawRecord } from '../pipeline/raw';
import { checkCard, validateCards } from '../pipeline/validate';

const abstract =
  '<h4>Purpose</h4>To compare outcomes.<h4>Results</h4>IOP fell by 32% at 12 months.<h4>Conclusions</h4>The MicroShunt lowered IOP by 32% at 12 months with fewer interventions.';

function raw(over: Partial<RawRecord> = {}): RawRecord {
  return {
    sourceId: 'pmid:1',
    source: 'europepmc',
    area: 'brain',
    topic: 'glaukom',
    url: 'https://europepmc.org/article/MED/1',
    urlStatus: 200,
    api: { url: 'https://www.ebi.ac.uk/x', status: 200 },
    title: 'MicroShunt versus trabeculectomy',
    publisher: 'Ophthalmology',
    year: 2026,
    content: { title: 'MicroShunt versus trabeculectomy', abstract },
    fetchedAt: '2026-10-23T00:00:00Z',
    ...over,
  };
}

function card(over: Partial<Card> = {}, src: Partial<Card['source']> = {}): Card {
  return {
    id: 'pmid:1',
    area: 'brain',
    topic: 'glaukom',
    type: 'fresh',
    headline: 'MicroShunt senkt den IOD um 32% nach 12 Monaten',
    source: {
      id: 'pmid:1',
      title: 'MicroShunt versus trabeculectomy',
      publisher: 'Ophthalmology',
      year: 2026,
      url: 'https://europepmc.org/article/MED/1',
      excerpt: 'The MicroShunt lowered IOP by 32% at 12 months   with fewer interventions.',
      ...src,
    },
    createdAt: '2026-10-23T00:00:00Z',
    ...over,
  };
}

const none = new Set<string>();

describe('Verifikations-Gate', () => {
  it('lässt eine korrekte Karte durch (Whitespace-normalisiert)', () => {
    expect(checkCard(card(), raw(), none)).toBeNull();
  });

  it('Regel 1: URL ohne HTTP 200 fliegt raus', () => {
    expect(checkCard(card(), raw({ urlStatus: 404 }), none)?.rule).toBe(1);
    expect(checkCard(card({}, { url: '' }), raw(), none)?.rule).toBe(1);
    expect(checkCard(card(), undefined, none)?.rule).toBe(1);
  });

  it('Regel 2: Excerpt, der kein exakter Substring ist, fliegt raus', () => {
    const r = checkCard(card({}, { excerpt: 'The MicroShunt clearly lowered IOP by 32% at 12 months.' }), raw(), none);
    expect(r?.rule).toBe(2);
  });

  it('Regel 3: Zahl, die nicht im Excerpt steht, fliegt raus', () => {
    expect(checkCard(card({ headline: 'MicroShunt senkt den IOD um 45%' }), raw(), none)?.rule).toBe(3);
    expect(checkCard(card({ forYou: 'Bei 3 von 4 Patienten weniger Tropfen.' }), raw(), none)?.rule).toBe(3);
    // Zahl steht im Abstract, aber nicht im Excerpt: trotzdem raus
    const ex = 'The MicroShunt lowered IOP with fewer interventions.';
    expect(checkCard(card({ headline: 'MicroShunt senkt IOD nach 12 Monaten' }, { excerpt: ex }), raw({ content: { abstract: ex } }), none)?.rule).toBe(3);
  });

  it('Regel 3: Dezimalkomma und Dezimalpunkt gelten als gleich', () => {
    const ex = 'Mean deviation improved by 1.5 dB.';
    expect(checkCard(card({ headline: 'MD besser um 1,5 dB' }, { excerpt: ex }), raw({ content: { abstract: ex } }), none)).toBeNull();
  });

  it('Regel 4: Längenlimits', () => {
    expect(checkCard(card({ headline: 'x'.repeat(91) }), raw(), none)?.rule).toBe(4);
    expect(checkCard(card({ body: 'y'.repeat(281) }), raw(), none)?.rule).toBe(4);
  });

  const tafsir = 'Allah ist der Lebendige. Er schläft nicht und ihn überkommt kein Schlummer.';
  const verseRaw = raw({
    sourceId: 'quran:2:255',
    source: 'quran',
    area: 'beat',
    topic: 'koran',
    url: 'https://quran.com/2/255',
    content: { arabic: 'ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ', translation: 'Allah, kein Gott ist da außer Ihm<sup foot_note="1">1</sup>, dem Lebendigen.', tafsir_muyassar: tafsir, tafsir_ibnkathir: 'This is the Ayat Al-Kursi.' },
  });
  const verse = (over: Partial<Card> = {}) =>
    card(
      { id: 'quran:2:255', area: 'beat', topic: 'koran', type: 'verse', headline: 'Allah, kein Gott ist da außer Ihm, dem Lebendigen.', arabic: 'ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ', reflection: 'Was nimmst du heute aus diesem Vers mit?', ...over },
      { id: 'quran:2:255', url: 'https://quran.com/2/255', excerpt: tafsir },
    );

  it('Regel 5: Beat-Karte mit wörtlichem Tafsir besteht', () => {
    expect(checkCard(verse({ body: 'This is the Ayat Al-Kursi.' }), verseRaw, none)).toBeNull();
  });

  it('Regel 5: Beat mit frei formuliertem Auslegungstext fliegt raus', () => {
    expect(checkCard(verse({ body: 'Dieser Vers lehrt uns, dass Gott immer wacht.' }), verseRaw, none)?.rule).toBe(5);
    expect(checkCard(verse({ forYou: 'Nimm dir heute Zeit für Stille.' }), verseRaw, none)?.rule).toBe(5);
  });

  it('Regel 5: Reflexion muss eine Frage sein', () => {
    expect(checkCard(verse({ reflection: 'Denk darüber nach.' }), verseRaw, none)?.rule).toBe(5);
  });

  it('Regel 2: arabischer Text muss wörtlich sein', () => {
    expect(checkCard(verse({ arabic: 'نص آخر' }), verseRaw, none)?.rule).toBe(2);
  });

  it('Regel 6: Duplikat über source.id', () => {
    expect(checkCard(card(), raw(), new Set(['pmid:1']))?.rule).toBe(6);
    const res = validateCards([card(), card()], new Map([['pmid:1', raw()]]));
    expect(res.accepted).toHaveLength(1);
    expect(res.rejected[0].rule).toBe(6);
  });
});
