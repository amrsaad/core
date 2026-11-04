/**
 * Umbrüche (Brief 06): Handy unter 768, Tablet 768 bis 1180, Desktop ab 1181 px.
 * Die Zahlen stehen auch in den Media-Queries von tokens.css und index.css (Media-Queries lesen keine Variablen).
 * tests/design-tokens.test.ts hält CSS und diese Datei gleich.
 */
export const BP_TABLET = 768;
export const BP_DESKTOP = 1181;

export type Layout = 'phone' | 'tablet' | 'desktop';

export const layoutOf = (width: number): Layout => (width >= BP_DESKTOP ? 'desktop' : width >= BP_TABLET ? 'tablet' : 'phone');

/** Die vier Prüfbreiten des Layout-Gates (Entscheidung 43): Handy, Tablet, Desktop, großer Desktop */
export const GATE_VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '834', width: 834, height: 1194 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
] as const;
