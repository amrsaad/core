import { describe, expect, it } from 'vitest';
import { FIT_LEVELS, FIT_MAX, RECALL_SWIPE_PX, RECALL_TOP_MIN, RECALL_TOP_MIN_DONE, pickRecallFit, recallSwipe, recallTop, recallTopDone } from '../src/moments/recallfit';

describe('Abrufkarte: Stufenwahl (Runde 28)', () => {
  it('vier Stufen, 0 bis 3', () => {
    expect(FIT_MAX).toBe(3);
    expect(FIT_LEVELS).toBe(4);
  });
  it('passt schon Stufe 0 (vor und nach der Antwort), bleibt es', () => {
    expect(pickRecallFit([400, 380, 350, 330], [520, 500, 470, 440], 600)).toBe(0);
  });
  it('wählt die kleinste Stufe, bei der beide Zustände passen', () => {
    // vor der Antwort passt schon Stufe 0, nach der Antwort erst Stufe 2
    expect(pickRecallFit([400, 380, 350, 330], [640, 610, 580, 540], 600)).toBe(2);
    // umgekehrt zählt der größere der beiden Werte
    expect(pickRecallFit([620, 580, 540, 500], [400, 380, 350, 330], 600)).toBe(1);
  });
  it('Mindestabstand oben: 16 px vor der Antwort, 8 px nach der Antwort, ein halber Pixel Toleranz für Rundung', () => {
    expect(RECALL_TOP_MIN).toBe(16);
    expect(RECALL_TOP_MIN_DONE).toBe(8);
    expect(pickRecallFit([584.5, 500], [500, 500], 600)).toBe(0);
    expect(pickRecallFit([585, 500], [500, 500], 600)).toBe(1);
    expect(pickRecallFit([500, 500], [592.5, 500], 600)).toBe(0);
    expect(pickRecallFit([500, 500], [593, 500], 600)).toBe(1);
  });
  it('passt keine Stufe, gilt die letzte', () => {
    expect(pickRecallFit([900, 800, 700, 650], [990, 900, 800, 750], 400)).toBe(3);
  });
  it('nach der Antwort nie eine kleinere Stufe als vorher (from), from wird begrenzt', () => {
    expect(pickRecallFit([300, 290, 280, 270], [300, 290, 280, 270], 500, 2)).toBe(2);
    expect(pickRecallFit([300, 290], [300, 290], 500, 9)).toBe(1);
    expect(pickRecallFit([300, 290], [300, 290], 500, -2)).toBe(0);
    expect(pickRecallFit([], [], 500)).toBe(0);
  });
  it('die Fläche darf je Stufe eine andere Höhe haben', () => {
    expect(pickRecallFit([500, 480, 470, 450], [500, 480, 470, 450], [330, 330, 330, 520])).toBe(3);
  });
  it('390x793 mit normalem Inhalt gilt Stufe 0', () => {
    // Fläche bei 793 px mit Dynamic Island und Home-Balken: 793 - 99 (Kopf) - 42 (unten) = 652. Block vor und nach der Antwort aus Messungen je Stufe (Frage 2 Zeilen, Antworten 1 bis 2 Zeilen, Erklärung 2 Zeilen)
    expect(pickRecallFit([478, 422, 378, 358], [621, 559, 507, 487], 652)).toBe(0);
  });
  it('390x793 mit dem Inhalt aus dem Nutzer-Screenshot (Frage 4 Zeilen bei Stufe 0, Erklärung 160 Zeichen) gilt Stufe 1', () => {
    expect(pickRecallFit([506, 474, 401, 381], [670, 632, 551, 531], 652)).toBe(1);
  });
});

describe('Abrufkarte: Lage des Blocks (Runde 28)', () => {
  it('40 Prozent des freien Platzes oben, 60 Prozent unten', () => {
    const top = recallTop(600, 400);
    expect(top).toBe(80);
    expect(600 - 400 - top).toBe(120);
  });
  it('mindestens 16 px oben, auch wenn 40 Prozent weniger wären', () => {
    expect(recallTop(600, 560)).toBe(16);
    expect(recallTop(600, 590)).toBe(10); // weniger freier Platz als 16: der ganze Rest
    expect(recallTop(600, 700)).toBe(0);
  });
  it('nach der Antwort bleibt die Oberkante, wenn der Block nach unten Platz hat', () => {
    expect(recallTopDone(80, 600, 500)).toBe(80);
    expect(recallTopDone(80, 600, 520)).toBe(80);
  });
  it('braucht der Block nach der Antwort mehr, rückt er genau so weit nach oben, wie nötig', () => {
    expect(recallTopDone(80, 600, 560)).toBe(40);
    expect(recallTopDone(80, 600, 700)).toBe(0);
  });
});

describe('Abrufkarte: Wisch (Runde 23)', () => {
  it('unbeantwortet wechselt ein Wisch nach oben nie die Karte', () => {
    expect(recallSwipe(false, -200)).toBe('blocked');
    expect(recallSwipe(false, -RECALL_SWIPE_PX - 1)).toBe('blocked');
  });
  it('nach der Antwort schließt ein Wisch nach oben', () => {
    expect(recallSwipe(true, -200)).toBe('close');
  });
  it('kurz oder nach unten: nichts', () => {
    expect(recallSwipe(true, -RECALL_SWIPE_PX)).toBe('none');
    expect(recallSwipe(false, -20)).toBe('none');
    expect(recallSwipe(true, 150)).toBe('none');
  });
});
