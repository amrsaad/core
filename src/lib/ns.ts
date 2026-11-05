// Kanal-Trennung (Entscheidung 56, Brief 21). Die Vorschau unter /core/preview/ liegt auf derselben Origin wie die echte App unter /core/.
// localStorage, IndexedDB und Cache Storage gelten pro Origin, nicht pro Pfad. Ohne eigene Namen würde die Vorschau den Stand der echten App lesen und überschreiben.
// Auf dem Hauptkanal bleibt jeder Name exakt wie vor Brief 21. Nur der Vorschau-Kanal bekommt eigene Namen.

/** Basis-Pfad des Builds. Hauptkanal: /core/, Vorschau: /core/preview/ (CORE_BASE beim Build) */
export const BASE: string = import.meta.env.BASE_URL;

export const IS_PREVIEW = BASE !== '/core/';

/** Für die Diagnose-Kopfzeile */
export const CHANNEL: 'prod' | 'preview' = IS_PREVIEW ? 'preview' : 'prod';

/** Präfix aller localStorage-Schlüssel mit Punkt: core.queue.v1.x oder corepv.queue.v1.x */
export const NS = IS_PREVIEW ? 'corepv' : 'core';

/** localStorage-Schlüssel mit Punkt, z. B. lsKey('queue.v1') gibt core.queue.v1 */
export const lsKey = (rest: string): string => `${NS}.${rest}`;

/** Namen mit Bindestrich (IndexedDB, Cache Storage, Schlüssel ohne Punkt): core-key bleibt core-key, in der Vorschau core-key-pv */
export const dashName = (name: string): string => (IS_PREVIEW ? `${name}-pv` : name);

/** Datei im Remote (core-content/state): die Vorschau schreibt neben die echte Datei, nie hinein */
export const remoteName = (path: string): string => (IS_PREVIEW ? path.replace(/\.enc$/, '-preview.enc') : path);
