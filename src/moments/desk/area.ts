import type { Area } from '../../types';

export { AREA_LABEL } from '../../lib/labels';
/** Bereichsfarben der festen Medienfläche (--c-*-dk): bleiben auf dem dunklen Grund lesbar, auch wenn die Stimmung hell ist */
export const AREA_DK: Record<Area, string> = { beat: 'var(--c-beat-dk)', body: 'var(--c-body-dk)', brain: 'var(--c-brain-dk)' };
