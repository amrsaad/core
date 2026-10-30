import { useEffect, useState } from 'react';
import { browserPreloader } from './preloader';

/** Stand des Offline-Vorrats (Anzahl Momente, Bytes) für Settings, aktualisiert sich beim Laden und Verdrängen */
export function usePreloadStats(): { n: number; bytes: number } {
  const pre = browserPreloader();
  const [s, set] = useState(() => pre?.stats() ?? { n: 0, bytes: 0 });
  useEffect(() => {
    if (!pre) return;
    let live = true;
    const read = () => live && set(pre.stats());
    void pre.whenReady().then(read);
    const off = pre.subscribe(read);
    return () => {
      live = false;
      off();
    };
  }, [pre]);
  return s;
}
