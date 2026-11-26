import { useEffect, useState } from 'react';
import { BP_TABLET } from '../../design/breakpoints';
import { phoneEnabled } from './flags';

/** Media-Query des Handys: unter 768 px Breite (Hochformat). Querformat am Handy und Tablet behalten die bisherige Ansicht. */
export const PHONE_QUERY = `(max-width: ${BP_TABLET - 1}px)`;

/** true, wenn der Schalter an ist und das Fenster schmaler als BP_TABLET. Folgt dem Fenster. Der Schalter wird einmal je Seite gelesen. */
export function usePhone(): boolean {
  const [on] = useState(phoneEnabled);
  const [narrow, setNarrow] = useState(() => on && typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    if (!on) return;
    const mq = window.matchMedia(PHONE_QUERY);
    const f = () => setNarrow(mq.matches);
    mq.addEventListener('change', f);
    f();
    return () => mq.removeEventListener('change', f);
  }, [on]);
  return on && narrow;
}
