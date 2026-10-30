import { describe, expect, it } from 'vitest';
import { applyQuota, conclusionExcerpt, headlineFromTitle } from '../pipeline/cards';
import { parseHighlights } from '../pipeline/fetch/inbox';
import { parseAtom } from '../pipeline/fetch/arxiv';
import { htmlToText, numbers, sentences } from '../pipeline/text';
import type { Card } from '../src/types';

describe('Kartenbildung', () => {
  it('nimmt den Conclusion-Abschnitt als Excerpt', () => {
    const t = htmlToText('<h4>Methods</h4>We did 2 things.<h4>Conclusions</h4>Drug A was superior to B (P = .01). Further trials are needed.');
    expect(conclusionExcerpt(t)).toBe('Drug A was superior to B (P = .01). Further trials are needed.');
  });

  it('nimmt sonst den letzten Satz', () => {
    expect(conclusionExcerpt('We studied eyes in detail for a long time. Treatment improved vision in most eyes over two years of follow-up.')).toMatch(/Treatment improved/);
  });

  it('kürzt lange Titel auf Haupttitel', () => {
    expect(headlineFromTitle('Efficacy of faricimab in neovascular AMD: a systematic review and meta-analysis of randomized controlled trials across all regions')).toBe('Efficacy of faricimab in neovascular AMD');
  });

  it('nimmt nie einen reinen Studientyp als Headline', () => {
    expect(headlineFromTitle('Trabeculectomy versus glaucoma drainage devices in uveitic glaucoma patients across many centres worldwide: A Systematic Review and Meta-Analysis')).toBeNull();
    expect(headlineFromTitle('A Systematic Review and Meta-Analysis')).toBeNull();
  });

  it('nimmt keine Förder- oder Registrierungsnotiz als Excerpt', () => {
    const t = htmlToText('<h4>Conclusions</h4>Creatine improved sprint performance in trained adults over time. <h4>Funding</h4>This study was funded by X.');
    expect(conclusionExcerpt(t)).toBe('Creatine improved sprint performance in trained adults over time.');
    expect(conclusionExcerpt('We reviewed sixty trials on hydration in athletes. Systematic review registration: PROSPERO CRD42023456789.')).toBeNull();
  });

  it('verwirft inhaltsleere Schlusssätze', () => {
    expect(conclusionExcerpt('We propose a model of aqueous regulation in detail here. We conclude by specifying the experiments that would confirm or refute it.')).toBeNull();
  });

  it('trennt Sätze nicht an Dezimalzahlen oder e.g.', () => {
    expect(sentences('IOP fell 3.5 mmHg, e.g. in POAG. Next sentence here.')).toHaveLength(2);
  });

  it('Zahlen-Regex', () => {
    expect(numbers('32 % und 1,5 sowie 12')).toEqual(['32%', '1.5', '12']);
  });

  it('Quote nach Zielverteilung', () => {
    const mk = (area: Card['area'], i: number) => ({ id: `${area}${i}`, area, topic: `${area}${i % 3}` }) as Card;
    const cards = [...Array.from({ length: 100 }, (_, i) => mk('brain', i)), ...Array.from({ length: 30 }, (_, i) => mk('body', i)), ...Array.from({ length: 20 }, (_, i) => mk('beat', i))];
    const out = applyQuota(cards, { brain: 0.55, body: 0.25, beat: 0.2 });
    expect(out.filter((c) => c.area === 'beat')).toHaveLength(20);
    expect(out.filter((c) => c.area === 'brain')).toHaveLength(55);
  });

  it('liest Buch-Highlights', () => {
    const md = '> Wer zuerst eine Zahl nennt, setzt den Anker.\n\nQuelle: Never Split the Difference, Chris Voss, Kapitel 7\nTopic: verhandlung\n';
    expect(parseHighlights(md)).toEqual([{ quote: 'Wer zuerst eine Zahl nennt, setzt den Anker.', title: 'Never Split the Difference', author: 'Chris Voss', chapter: 'Kapitel 7', topic: 'verhandlung' }]);
  });

  it('parst arXiv-Atom', () => {
    const xml = '<feed><entry><id>http://arxiv.org/abs/2510.01234v2</id><published>2025-10-01T00:00:00Z</published><title>A  Title</title><summary> Text &amp; more. </summary></entry></feed>';
    expect(parseAtom(xml)[0]).toMatchObject({ id: '2510.01234', title: 'A Title', summary: 'Text & more.', abs: 'https://arxiv.org/abs/2510.01234' });
  });
});

describe('Beat-Auszug', () => {
  it('kürzt al-Muyassar wörtlich am arabischen Komma', async () => {
    const { clausePrefix } = await import('../pipeline/cards');
    const t = `${'كلمة '.repeat(50)}، ${'نص '.repeat(80)}`;
    const p = clausePrefix(t, 400);
    expect(p.endsWith('،')).toBe(true);
    expect(t.includes(p)).toBe(true);
  });
});
