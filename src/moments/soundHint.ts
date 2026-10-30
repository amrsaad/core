// Hinweis "Ton aus" (Issue 13, Punkt 1): hängt nur vom Zustand des spielenden Elements ab, nie von einem Berührungs-Flag.
// Regel: sichtbar genau dann, wenn das spielende Element muted ist oder play() mit NotAllowedError abgelehnt wurde.
// Die Ereignisse volumechange, playing und pause am Element treiben den Zustand (reduceSound), die Anzeige liest nur hintVisible.

export interface SoundObs {
  /** Element ist stumm (muted oder Lautstärke 0) */
  muted: boolean;
  /** Element spielt gerade (Ereignis playing kam, seitdem keine Pause) */
  playing: boolean;
  /** play() wurde mit NotAllowedError abgelehnt und seitdem hat nichts gespielt */
  refused: boolean;
}

export const SOUND_NONE: SoundObs = { muted: false, playing: false, refused: false };

export type SoundEvent = 'volumechange' | 'playing' | 'pause' | 'refused';

export const hintVisible = (o: SoundObs): boolean => o.refused || (o.playing && o.muted);

/** Nur, was der Hinweis vom Element braucht (HTMLMediaElement erfüllt es, im Test steht ein Nachbau) */
export interface SoundEl {
  muted: boolean;
  volume?: number;
  paused: boolean;
}

export const isSilent = (el: SoundEl): boolean => el.muted || el.volume === 0;

export function reduceSound(prev: SoundObs, ev: SoundEvent, el: SoundEl): SoundObs {
  const muted = isSilent(el);
  switch (ev) {
    case 'playing':
      return { muted, playing: true, refused: false };
    case 'pause':
      return { muted, playing: !el.paused, refused: prev.refused };
    case 'volumechange':
      return { ...prev, muted };
    case 'refused':
      return { muted, playing: false, refused: true };
  }
}

export const sameSound = (a: SoundObs, b: SoundObs): boolean => a.muted === b.muted && a.playing === b.playing && a.refused === b.refused;
