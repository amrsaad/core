import { useRef } from 'react';

interface Handlers {
  onTap?: () => void;
  onDoubleTap?: () => void;
  onLongPress?: () => void;
}

const DOUBLE_MS = 280;
const LONG_MS = 520;
const MOVE_PX = 10;

/** Tipp, Doppeltipp und langes Drücken ohne Swipe-Library. Scrollen bricht die Geste ab. */
export function useGestures({ onTap, onDoubleTap, onLongPress }: Handlers) {
  const s = useRef({ x: 0, y: 0, long: 0, tap: 0, lastUp: 0, fired: false, moved: false });

  return {
    onPointerDown(e: React.PointerEvent) {
      const r = s.current;
      r.x = e.clientX;
      r.y = e.clientY;
      r.fired = false;
      r.moved = false;
      window.clearTimeout(r.long);
      r.long = window.setTimeout(() => {
        r.fired = true;
        onLongPress?.();
      }, LONG_MS);
    },
    onPointerMove(e: React.PointerEvent) {
      const r = s.current;
      if (Math.abs(e.clientX - r.x) > MOVE_PX || Math.abs(e.clientY - r.y) > MOVE_PX) {
        r.moved = true;
        window.clearTimeout(r.long);
      }
    },
    onPointerUp() {
      const r = s.current;
      window.clearTimeout(r.long);
      if (r.fired || r.moved) return;
      const t = Date.now();
      if (t - r.lastUp < DOUBLE_MS) {
        window.clearTimeout(r.tap);
        r.lastUp = 0;
        onDoubleTap?.();
        return;
      }
      r.lastUp = t;
      r.tap = window.setTimeout(() => onTap?.(), DOUBLE_MS);
    },
    onPointerCancel() {
      window.clearTimeout(s.current.long);
    },
    onContextMenu(e: React.MouseEvent) {
      e.preventDefault();
    },
  };
}
