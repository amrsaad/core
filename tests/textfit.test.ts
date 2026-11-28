import { describe, expect, it } from 'vitest';
import { cleanText, cutText, fitCut, isTruncated, MAX_EMPTY, PHONE_TEXT_STEPS, phoneFitLine, pickCutStep, pickPhoneStep, pickStep, sentenceEnds, TEXT_STEPS, versePieces } from '../src/moments/textfit';

// Brief 18 (Issues 41 und 43): Regeln für Text auf einem Bildschirm und arabische Verse, ohne DOM.
describe('textfit: Leerzeichen nach Doppelpunkt im arabischen Text (Runde 53)', () => {
  it('ergänzt das Leerzeichen nach : und ؛ vor einem arabischen Buchstaben (die zwei Beispiele vom Gerät)', () => {
    expect(cleanText('الخسار مراتب متعددة متفاوتة:قد يكون خسارًا')).toBe('الخسار مراتب متعددة متفاوتة: قد يكون خسارًا');
    expect(cleanText('ونمجِّدك بكل صفات:الإيمان والعمل')).toBe('ونمجِّدك بكل صفات: الإيمان والعمل');
    expect(cleanText('قال؛فعل ذلك')).toBe('قال؛ فعل ذلك');
  });
  it('gilt auch innerhalb von { } Versklammern, ohne den Wortlaut zu ändern', () => {
    expect(cleanText('قال:{وَالْعَصْرِ:إِنَّ}')).toBe('قال:{وَالْعَصْرِ: إِنَّ}');
  });
  it('lässt Versangaben, Uhrzeiten, vorhandene Leerzeichen und lateinischen Text unberührt', () => {
    expect(cleanText('سورة العصر 103:2 تفسير')).toBe('سورة العصر 103:2 تفسير');
    expect(cleanText('في الساعة 10:30 صباحا')).toBe('في الساعة 10:30 صباحا');
    expect(cleanText('قال: قد')).toBe('قال: قد');
    expect(cleanText('a:b')).toBe('a:b');
    expect(cleanText('Time 10:30 and a:b; c')).toBe('Time 10:30 and a:b; c');
    expect(cleanText('قال:abc')).toBe('قال:abc');
  });
  it('ändert nur Leerraum: ohne die ergänzten Leerzeichen ist der Text gleich', () => {
    const t = 'أ:ب؛ج:د {هـ:و}';
    expect(cleanText(t).replace(/ /g, '')).toBe(t.replace(/ /g, ''));
  });
});
describe('textfit: Escapes aus der Pipeline', () => {
  it('Backslash-Anführungszeichen werden normale Anführungszeichen', () => {
    expect(cleanText('قال: \\" المشقة تجلب التيسير \\" وهذا')).toBe('قال: " المشقة تجلب التيسير " وهذا');
    expect(cleanText("it\\'s")).toBe("it's");
  });
  it('Text ohne Escapes bleibt gleich', () => {
    expect(cleanText('Plain "quoted" text')).toBe('Plain "quoted" text');
  });
});

describe('textfit: Verse in { }', () => {
  it('trennt Vers und Erklärtext, zusammengesetzt wieder der Text', () => {
    const t = 'قال تعالى {إِنَّ مَعَ الْعُسْرِ يُسْرًا} أي بعد الشدة فرج.';
    const p = versePieces(t);
    expect(p.map((x) => x.verse)).toEqual([false, true, false]);
    expect(p[1].text).toBe('{إِنَّ مَعَ الْعُسْرِ يُسْرًا}');
    expect(p.map((x) => x.text).join('')).toBe(t);
  });
  it('ohne Klammern ein Stück, Vers am Anfang oder Ende ohne leere Stücke', () => {
    expect(versePieces('nur Text')).toEqual([{ text: 'nur Text', verse: false }]);
    expect(versePieces('{a} b {c}').map((x) => x.verse)).toEqual([true, false, true]);
  });
});

describe('textfit: Satzenden', () => {
  it('findet Satzzeichen vor Leerraum, Zeilenumbruch und Textende', () => {
    const t = 'First one. Second one!\nThird line? Fourth ends here.';
    const ends = sentenceEnds(t);
    expect(ends).toEqual([10, 22, 34, t.length]);
  });
  it('arabisches Fragezeichen und schließendes Anführungszeichen gehören zum Satz', () => {
    const t = 'هل هذا صحيح؟ نعم "قال." ثم';
    const ends = sentenceEnds(t);
    expect(ends[0]).toBe('هل هذا صحيح؟'.length);
    expect(ends[1]).toBe('هل هذا صحيح؟ نعم "قال."'.length);
  });
  it('ein Punkt mitten im Wort (3.5 mm) ist kein Satzende', () => {
    expect(sentenceEnds('About 3.5 mm wide. Done.')).toEqual([18, 24]);
  });
});

describe('textfit: Schnitt am Satzende', () => {
  it('nimmt die größte Grenze, die noch passt', () => {
    expect(fitCut([10, 22, 34, 50], (e) => e <= 30)).toBe(22);
    expect(fitCut([10, 22], () => true)).toBe(22);
  });
  it('passt keine Grenze, gibt es keinen Schnitt (Notnagel Zeilenzahl)', () => {
    expect(fitCut([10, 22], () => false)).toBeNull();
    expect(fitCut([], () => true)).toBeNull();
  });
  it('gekürzter Text endet ohne Leerraum, ohne Schnitt bleibt alles', () => {
    expect(cutText('First one. Second one!', 10)).toBe('First one.');
    expect(cutText('First one.\nSecond', 10)).toBe('First one.');
    expect(cutText('all of it', null)).toBe('all of it');
  });
  it('drei Stufen, gekürzt heißt Schnitt oder Notnagel', () => {
    expect(TEXT_STEPS).toBe(3);
    expect(isTruncated({ step: 2, cut: 40, clamp: false })).toBe(true);
    expect(isTruncated({ step: 2, cut: null, clamp: true })).toBe(true);
    expect(isTruncated({ step: 1, cut: null, clamp: false })).toBe(false);
  });
});

// Issue 53: die größte Stufe, die passt, nie eine kleinere mit Leerraum darunter
describe('textfit: Wahl der Stufe (Issue 53)', () => {
  it('größte passende Stufe von groß nach klein, keine passt heißt null', () => {
    expect(pickStep([true, true, true])).toBe(0);
    expect(pickStep([false, true, true])).toBe(1);
    expect(pickStep([false, false, true])).toBe(2);
    expect(pickStep([false, false, false])).toBeNull();
  });
  it('Schnitt: kleinste Stufe zeigt am meisten Text und gewinnt, solange höchstens 20 Prozent leer bleiben', () => {
    expect(MAX_EMPTY).toBe(0.2);
    expect(pickCutStep([10, 12, 15], 400)).toBe(2);
    expect(pickCutStep([90, 70, 80], 400)).toBe(2);
  });
  it('Schnitt: lässt die kleinste Stufe zu viel leer, die größte Stufe innerhalb der Grenze', () => {
    // 40 Prozent Leerraum in der kleinsten Stufe (der Befund), Stufe 0 bleibt innerhalb der 20 Prozent
    expect(pickCutStep([60, 100, 160], 400)).toBe(0);
    expect(pickCutStep([120, 70, 160], 400)).toBe(1);
  });
  it('Schnitt: hält keine die Grenze, die mit dem kleinsten Leerraum, ohne Satzende (Infinity) zählt nicht', () => {
    expect(pickCutStep([200, 120, 160], 400)).toBe(1);
    expect(pickCutStep([Infinity, Infinity, Infinity], 400)).toBe(2);
    expect(pickCutStep([Infinity, 30, Infinity], 400)).toBe(1);
    expect(pickCutStep([], 400)).toBe(0);
  });
});

// Runde 48: Stufenwahl der Text-Einpassung am Handy
describe('textfit: pickPhoneStep (Handy)', () => {
  it('nimmt die größte passende Stufe, ohne Scrollen', () => {
    expect(pickPhoneStep([true, true, true, true, true])).toEqual({ step: 0, scroll: false });
    expect(pickPhoneStep([false, false, true, true, true])).toEqual({ step: 2, scroll: false });
    expect(pickPhoneStep([false, false, false, false, true])).toEqual({ step: 4, scroll: false });
  });
  it('passt keine Stufe, bleibt die kleinste und der Bereich scrollt (letzter Ausweg)', () => {
    expect(pickPhoneStep([false, false, false, false, false])).toEqual({ step: 4, scroll: true });
  });
  it('leere Liste ist Stufe 0 ohne Scrollen nicht vorgesehen, aber ohne Fehler', () => {
    expect(pickPhoneStep([])).toEqual({ step: 0, scroll: true });
  });
  it('Stufenzahl und Diagzeile', () => {
    expect(PHONE_TEXT_STEPS).toBe(5);
    expect(phoneFitLine('abc:1', 3, false)).toBe('text: fit abc:1 step=3 scroll=no');
    expect(phoneFitLine('abc:1', 4, true)).toBe('text: fit abc:1 step=4 scroll=yes');
  });
});
