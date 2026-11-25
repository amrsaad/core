// Runde 41: Geräteaufnahme 25.11. 07:37 (Pause-Ansicht, "slow net, showing still"): der ganze Video-Bildschirm war gleichmäßig (89, 91, 94) grau, nur der Streifen unten
// (10, 14, 18) nicht. Genau das ergibt eine reinweiße Fläche mit Deckkraft 0,32 über --stage (Kanalwerte 10, 14, 18): 0,32 * 255 + 0,68 * (10, 14, 18) = (88,4; 91,1; 93,8).
// Mehr als .vambient mit Deckkraft 0,32 gibt es dafür nicht im Code. Der Ambient-Canvas zeigte also ein weißes Bild. Warum, ist aus dem Protokoll nicht zu sehen
// (vermutet: ein weißes oder leeres Vorschaubild von der Quelle, oder WebKit zeichnet ein verworfenes Bild weiß). Die Deckelung macht die Folge harmlos, egal woher das Weiß kommt.

/** Schalter: false = Ambient wie bis Runde 40 (keine Deckelung) */
export const AMBIENT_CAP = true;
/** Höchster Kanalwert, den der Ambient-Canvas zeigen darf (0 bis 255). Ein dunkles Vorschaubild bleibt unverändert, ein weißes wird auf diesen Grauwert gedeckelt. */
export const AMBIENT_MAX = 96;
/** Deckkraft der Ambient-Fläche, muss feed.css (.vambient) entsprechen */
export const AMBIENT_OPACITY = 0.32;

/** Hellster Kanalwert, den der Bildschirm durch Ambient annehmen kann: Deckkraft mal Canvas-Wert plus Rest vom Hintergrund (stage = Kanalwert von --stage) */
export function ambientPeak(stage: number, opacity = AMBIENT_OPACITY, max = AMBIENT_CAP ? AMBIENT_MAX : 255): number {
  return Math.round(opacity * max + (1 - opacity) * stage);
}
