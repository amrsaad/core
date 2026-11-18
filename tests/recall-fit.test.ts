import { describe, expect, it } from 'vitest';
import { FIT_ASK_MAX, FIT_DONE_MAX, RECALL_SWIPE_PX, ellipsizeWords, fitLevels, fitOverflow, pickRecallFit, recallSwipe } from '../src/moments/recallfit';

describe('Abrufkarte: Stufenwahl (Runde 23)', () => {
  it('passt schon Stufe 0, bleibt es', () => {
    expect(pickRecallFit([400, 380, 350, 330, 310, 290], 450)).toBe(0);
  });
  it('wählt die kleinste Stufe, die in die Fläche passt', () => {
    expect(pickRecallFit([520, 480, 450, 430, 400, 370], 440)).toBe(3);
    expect(pickRecallFit([520, 480, 450, 430, 400, 370], 370)).toBe(5);
  });
  it('gleich hoch zählt als passend, ein halber Pixel Toleranz für Rundung', () => {
    expect(pickRecallFit([500, 440], 440)).toBe(1);
    expect(pickRecallFit([500, 440.4], 440)).toBe(1);
  });
  it('passt keine Stufe, gilt die letzte', () => {
    expect(pickRecallFit([900, 800, 700, 650, 600, 560], 400)).toBe(5);
  });
  it('nach der Antwort nie eine kleinere Stufe als vorher (from)', () => {
    expect(pickRecallFit([300, 290, 280, 270, 260, 250], 500, 3)).toBe(3);
    expect(pickRecallFit([700, 690, 680, 670, 260, 250], 500, 3)).toBe(4);
  });
  it('from außerhalb des Bereichs wird begrenzt', () => {
    expect(pickRecallFit([300, 290], 500, 9)).toBe(1);
    expect(pickRecallFit([300, 290], 500, -2)).toBe(0);
    expect(pickRecallFit([], 500)).toBe(0);
  });
  it('die Fläche darf je Stufe eine andere Höhe haben (Stufe 5 im Sheet reicht höher)', () => {
    expect(pickRecallFit([500, 480, 470, 450, 430, 420], [330, 330, 330, 330, 330, 520])).toBe(5);
    expect(pickRecallFit([500, 480], [10])).toBe(1);
  });
  it('Überstand der gewählten Stufe', () => {
    expect(fitOverflow([500, 450], 440, 1)).toBe(10);
    expect(fitOverflow([500, 430], 440, 1)).toBe(0);
    expect(fitOverflow([500, 450], [440, 400], 1)).toBe(50);
  });
  it('vor der Antwort Stufen 0 bis 5, nach der Antwort zusätzlich Stufe 6 (Kennzeichnung und Hook weg)', () => {
    expect(FIT_ASK_MAX).toBe(5);
    expect(FIT_DONE_MAX).toBe(6);
    expect(fitLevels(false)).toBe(6);
    expect(fitLevels(true)).toBe(7);
  });
  it('vor der Antwort gilt bei zu wenig Platz Stufe 5, nach der Antwort Stufe 6', () => {
    expect(pickRecallFit([900, 800, 700, 650, 600, 560], 400)).toBe(5);
    expect(pickRecallFit([900, 800, 700, 650, 600, 560, 500], 400)).toBe(6);
  });
});

describe('Abrufkarte: Wisch (Runde 23)', () => {
  it('unbeantwortet wechselt kein Wisch, auch ein langer nicht', () => {
    expect(recallSwipe(false, -81)).toBe('blocked');
    expect(recallSwipe(false, -400)).toBe('blocked');
  });
  it('beantwortet schließt ein Wisch nach oben wie bei jedem Moment', () => {
    expect(recallSwipe(true, -81)).toBe('close');
    expect(recallSwipe(true, -400)).toBe('close');
  });
  it('kurze Wische und Wische nach unten tun nichts', () => {
    expect(recallSwipe(true, -RECALL_SWIPE_PX)).toBe('none');
    expect(recallSwipe(false, -RECALL_SWIPE_PX)).toBe('none');
    expect(recallSwipe(true, -20)).toBe('none');
    expect(recallSwipe(false, 300)).toBe('none');
    expect(recallSwipe(true, 0)).toBe('none');
  });
});

describe('Hook mit Auslassung am Wortende (Runde 23)', () => {
  // Nachbildung einer Zeile: höchstens 30 Zeichen
  const fits = (t: string) => t.length <= 30;
  it('passt der Text, bleibt er unverändert', () => {
    expect(ellipsizeWords('Short hook here', fits)).toBe('Short hook here');
  });
  it('schneidet nur an Wortgrenzen und endet mit …', () => {
    const out = ellipsizeWords('Check lens status before the next injection and note it', fits);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(30);
    const body = out.slice(0, -1);
    expect('Check lens status before the next injection and note it'.startsWith(body)).toBe(true);
    expect('Check lens status before the next injection and note it'.charAt(body.length)).toBe(' ');
  });
  it('nimmt so viele Wörter wie passen', () => {
    expect(ellipsizeWords('aaaa bbbb cccc dddd eeee ffff gggg hhhh', fits)).toBe('aaaa bbbb cccc dddd eeee ffff…');
  });
  it('Satzzeichen vor der Auslassung entfallen', () => {
    expect(ellipsizeWords('Alpha beta gamma, delta epsilon zeta eta theta', (t) => t.length <= 17)).toBe('Alpha beta gamma…');
  });
  it('arabisch: nur an Leerzeichen', () => {
    const t = 'تفسير السعدي إن مع العسر يسرا وما يتصل به';
    const out = ellipsizeWords(t, (x) => x.length <= 20);
    expect(out.endsWith('…')).toBe(true);
    const body = out.slice(0, -1);
    expect(t.startsWith(body)).toBe(true);
    expect(t.charAt(body.length)).toBe(' ');
  });
  it('ein einzelnes Wort, das allein nicht passt, bleibt mit … stehen', () => {
    expect(ellipsizeWords('Supercalifragilisticexpialidocious word', (t) => t.length <= 10)).toBe('Supercalifragilisticexpialidocious…');
  });
});
