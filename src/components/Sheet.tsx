import { useRef, type ReactNode, type SyntheticEvent } from 'react';
import { Icon } from './Icon';
import { closesSheet } from './sheetClose';

/**
 * Rahmen für alle Blätter von unten (More, Fokus, Share; Brief 17, Issue 39, Entscheidung 54).
 * Drei Wege zu: Wisch nach unten ab 80 px (an der Griffleiste immer, im Inhalt nur wenn er oben steht), Tipp auf den abgedunkelten Hintergrund,
 * Schließen-Knopf oben rechts (44 px). Oben bleibt unter der Statusleiste ein Streifen des Hintergrunds frei (max-height in sheets.css), den der Daumen trifft.
 * Zeigerereignisse enden hier, damit die Gesten-Ebene des Feeds darunter nichts davon sieht.
 */
export function Sheet({ testid, label, onClose, children }: { testid: string; label: string; onClose: () => void; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; top: number } | null>(null);
  const downOnBackdrop = useRef(false);
  /** Ein Schließen je Geste: Zeigerereignis und der Klick danach dürfen nicht beide zählen */
  const fired = useRef(false);
  const close = () => {
    if (fired.current) return;
    fired.current = true;
    onClose();
  };
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  const follow = (dy: number) => {
    const el = sheet.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
  };
  const rest = () => {
    const el = sheet.current;
    if (!el) return;
    el.style.transition = '';
    el.style.transform = '';
  };

  return (
    <div
      className="sheet-backdrop"
      data-testid={testid}
      onPointerDownCapture={() => {
        fired.current = false;
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        if (downOnBackdrop.current && e.target === e.currentTarget) close();
        downOnBackdrop.current = false;
      }}
      onClick={(e) => {
        // Ohne Zeigerereignisse davor (Tests, die nur click senden) zählt der Klick auf den Hintergrund
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={sheet}
        className="sheet"
        role="dialog"
        aria-label={label}
        onTouchStart={(e) => {
          fired.current = false;
          const bar = !!(e.target as HTMLElement).closest('.sheet-bar');
          drag.current = { y: e.touches[0].clientY, top: bar ? 0 : (body.current?.scrollTop ?? 0) };
        }}
        onTouchMove={(e) => {
          const d = drag.current;
          if (!d || d.top > 0) return;
          follow(e.touches[0].clientY - d.y);
        }}
        onTouchEnd={(e) => {
          const d = drag.current;
          drag.current = null;
          rest();
          if (d && closesSheet(e.changedTouches[0].clientY - d.y, d.top)) close();
        }}
        onTouchCancel={() => {
          drag.current = null;
          rest();
        }}
      >
        <div className="sheet-bar">
          <div className="sheet-grip" aria-hidden="true" />
          <button type="button" className="sheet-x" data-testid={`${testid}-close`} aria-label="Close" onPointerDown={stop} onPointerUp={stop} onClick={close}>
            <Icon name="x" size="var(--icon)" />
          </button>
        </div>
        <div className="sheet-body" ref={body}>
          {children}
        </div>
      </div>
    </div>
  );
}
