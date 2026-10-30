import { useEffect, useState } from 'react';
import { DESKTOP_QUERY } from './desktop';

/** true ab 900 px Breite. Folgt dem Fenster, auch wenn es sich verändert. */
export function useDesktop(): boolean {
  const [desk, setDesk] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => setDesk(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, []);
  return desk;
}
