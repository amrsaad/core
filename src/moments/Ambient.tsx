import { useEffect, useRef, useState } from 'react';

// Größe des Bildes, das gezeichnet wird. Die Fläche skaliert es weich auf Bildschirmgröße, das ist der Weichzeichner.
const W = 24;
const H = 42;

/**
 * Ambient hinter der Karte (Brief 06, Block 4): das Vorschaubild weich und dunkel.
 * Kein `filter: blur(48px)`: Auf einer Fläche in Bildschirmgröße rechnet WebKit ohne GPU (CI-Runner, Linux) den Blur bei jedem Frame neu.
 * Gemessen: 3 bis 12 Hz im Leerlauf statt 63 Hz, 94 % verlorene Frames beim Wischen statt 9 %. Das Bild wird hier einmal in zwei Stufen
 * auf 24 mal 42 Pixel verkleinert (jede Stufe mittelt) und von der Fläche (CSS, `.vambient`) weich hochskaliert. Abdunkeln macht die Deckkraft in CSS.
 */
export function Ambient({ src }: { src: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Ein Bild, das ohne Netz nicht kam, wird bei der Rückkehr noch einmal geholt (wie Cover, Issue 9)
  const [k, setK] = useState(0);
  const failed = useRef(false);
  useEffect(() => {
    const on = () => {
      if (!failed.current) return;
      failed.current = false;
      setK((x) => x + 1);
    };
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [src]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !src) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let dead = false;
    failed.current = false;
    const img = new Image();
    img.onload = () => {
      if (dead || !img.naturalWidth) return;
      const fit = (iw: number, ih: number, w: number, h: number) => {
        const s = Math.max(w / iw, h / ih);
        return { dw: iw * s, dh: ih * s, dx: (w - iw * s) / 2, dy: (h - ih * s) / 2 };
      };
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // Stufe 1: auf das Vierfache der Zielgröße (Seitenverhältnis wie die Fläche, Ausschnitt mittig)
      const mid = document.createElement('canvas');
      mid.width = W * 4;
      mid.height = H * 4;
      const mc = mid.getContext('2d');
      if (!mc) return;
      mc.imageSmoothingEnabled = true;
      mc.imageSmoothingQuality = 'high';
      const a = fit(img.naturalWidth, img.naturalHeight, mid.width, mid.height);
      mc.drawImage(img, a.dx, a.dy, a.dw, a.dh);
      // Stufe 2: auf die Zielgröße
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(mid, 0, 0, W, H);
    };
    img.onerror = () => { failed.current = true; };
    img.src = src;
    return () => { dead = true; };
  }, [src, k]);
  return <canvas ref={ref} className="vambient" width={W} height={H} aria-hidden="true" />;
}
