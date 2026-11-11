import { describe, expect, it } from 'vitest';
import { originOf } from '../src/moments/RecallCard';
import type { Moment } from '../src/moments/types';

const mom = (o: Partial<Moment>): Moment => ({ id: 'a:1', videoId: 'v', start: 0, end: 30, channel: 'TED', videoTitle: 'T', area: 'brain', topic: 't', hook: 'Why sleep resets memory', kind: 'story', createdAt: '', form: 'audio', ...o });

describe('Abrufkarte zeigt Hook und Quelle des Ursprungs (Issue 42)', () => {
  it('englischer Hook links nach rechts, Quelle aus dem Moment', () => {
    const o = originOf(mom({ author: 'Matt Walker', ref: 'Ep 12', license: 'CC BY' }));
    expect(o.hook).toBe('Why sleep resets memory');
    expect(o.dir).toBe('ltr');
    expect(o.source).toContain('Matt Walker');
    expect(o.source).toContain('Ep 12');
  });
  it('arabischer Hook läuft rechtsläufig', () => {
    expect(originOf(mom({ hook: 'لماذا ننسى ما نقرأ' })).dir).toBe('rtl');
  });
});
