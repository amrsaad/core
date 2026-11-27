import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Icon } from '../../components/Icon';
import { AREA_COLOR, AREA_LABEL } from '../../lib/labels';
import { isArabic, type Moment } from '../types';

/**
 * Runde 45: Inhalt der iPhone-Ansicht zwischen Reiterleiste und Aktionsreihe (Audio und Video). Chip, Kanal, Hook, im Audio das Feld mit dem mitlaufenden Text.
 * Reine Anzeige. Die Berührung des Kopfs (Tipp öffnet den Kontext) steuert der Feed über info.
 */

const lineProps = (s: string) => ({ dir: isArabic(s) ? ('rtl' as const) : ('ltr' as const), lang: isArabic(s) ? 'ar' : 'en' });

/**
 * Der Hook wird nie gekürzt. Er steht in der größten von drei Stufen (28, 24, 21 px im Audio, 24, 21, 18 px im Video), die in den Platz passt.
 * Platz = Höhe des Blocks minus Chip-Zeile, Abstände und der Mindestplatz darunter (reserve). Passt auch die kleinste nicht, bleibt sie und der Platz darunter schrumpft.
 */
function useHookFit(box: RefObject<HTMLElement>, hook: RefObject<HTMLElement>, reserve: number, key: string) {
  useLayoutEffect(() => {
    const b = box.current;
    const h = hook.current;
    if (!b || !h) return;
    const fit = () => {
      const cs = getComputedStyle(b);
      const gap = parseFloat(cs.rowGap) || 0;
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const row = h.previousElementSibling as HTMLElement | null;
      const room = b.clientHeight - pad - (row?.offsetHeight ?? 0) - gap - reserve;
      let s = 0;
      for (;;) {
        h.dataset.step = String(s);
        if (h.scrollHeight <= room || s >= 2) break;
        s++;
      }
    };
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(b);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.addEventListener?.('loadingdone', fit);
    return () => {
      ro?.disconnect();
      fonts?.removeEventListener?.('loadingdone', fit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reserve]);
}

export interface PhoneInfoHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

/** Kleines Titelbild des Audio-Moments (Runde 48): Adresse beim Originalanbieter, nur wenn das Feld thumb eine https-Adresse ist */
export const coverUrl = (thumb?: string): string => (thumb && /^https:\/\//i.test(thumb.trim()) ? thumb.trim() : '');

export function PhoneInfo({ m, speaker, info, onSource, hookRef, cover }: { m: Moment; speaker: string; info: PhoneInfoHandlers; onSource?: () => void; hookRef: RefObject<HTMLHeadingElement>; cover?: { src: string; onError: () => void } }) {
  return (
    <>
      <div className="ph-chiprow" data-cover={cover ? '' : undefined}>
        <div className="ph-tap" data-testid="info-tap" {...info}>
          {cover && <img className="ph-cover" data-testid="ph-cover" src={cover.src} alt="" width={44} height={44} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={cover.onError} />}
          <div className="ph-chips" data-testid="speaker-line" style={{ ['--ad' as string]: AREA_COLOR[m.area] }}>
            <span className="ph-chip">
              <i aria-hidden="true" />
              {AREA_LABEL[m.area]}
            </span>
            <span className="ph-speaker" dir="auto">
              {speaker}
            </span>
          </div>
        </div>
        {onSource && (
          <button type="button" className="ph-src" data-testid="source" data-primary="true" aria-label="Source" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={onSource}>
            <Icon name="arrow-square-out" size="var(--icon)" />
          </button>
        )}
      </div>
      <div className="ph-tap ph-hooktap" {...info}>
        <h1 className="ph-hook" data-testid="hook" ref={hookRef} dir="auto">
          {m.hook}
        </h1>
      </div>
    </>
  );
}

export interface PhoneAudioProps {
  m: Moment;
  speaker: string;
  info: PhoneInfoHandlers;
  onSource?: () => void;
  /** Untertitel sind an (Regel des Moments oder Taste CC) */
  captionsOn: boolean;
  hasCaptions: boolean;
  lyric: { prev: string; cur: string; next: string };
  /** Ohne Untertitel: der Auszug des Moments */
  fallbackText: string;
  /** Platz unter der Zeile der Rückmeldung ("N notes, send?") */
  notes: boolean;
}

/** Audio: Chip, Kanal, Hook, darunter das Feld mit dem mitlaufenden Text (vorige Zeile gedämpft, aktuelle groß, nächste gedämpft, feste Position der aktuellen Zeile) */
export function PhoneAudio(p: PhoneAudioProps) {
  const box = useRef<HTMLDivElement>(null);
  const hook = useRef<HTMLHeadingElement>(null);
  // Titelbild nur im aktiven Moment (diese Ansicht steht nur für ihn), lädt es nicht, verschwindet der Platz ganz
  const thumb = coverUrl(p.m.thumb);
  const [bad, setBad] = useState('');
  const cover = thumb && bad !== thumb ? { src: thumb, onError: () => setBad(thumb) } : undefined;
  useHookFit(box, hook, 132, `${p.m.id}|${cover ? 'c' : ''}`);
  return (
    <div className="ph-audio" ref={box} data-testid="ph-audio" data-notes={p.notes ? '' : undefined} style={{ ['--ad' as string]: AREA_COLOR[p.m.area] }}>
      <PhoneInfo m={p.m} speaker={p.speaker} info={p.info} onSource={p.onSource} hookRef={hook} cover={cover} />
      <section className="ph-lyrics" data-testid="ph-lyrics" aria-label="Captions" aria-live="off">
        {!p.hasCaptions && !p.fallbackText ? (
          <p className="ph-lyric-note">No captions for this moment.</p>
        ) : !p.hasCaptions ? (
          <p className="ph-lyric-text" data-testid="ph-lyric-text" {...lineProps(p.fallbackText)}>
            {p.fallbackText}
          </p>
        ) : !p.captionsOn ? (
          <p className="ph-lyric-note">Captions are off. Tap CC to show them.</p>
        ) : (
          <>
            {p.lyric.prev && (
              <p key={`p${p.lyric.prev}`} className="ph-lyric-prev" data-testid="ph-lyric-prev" {...lineProps(p.lyric.prev)}>
                {p.lyric.prev}
              </p>
            )}
            <p key={`c${p.lyric.cur}`} className="ph-lyric-cur" data-testid="caption" {...lineProps(p.lyric.cur)}>
              <span>{p.lyric.cur}</span>
            </p>
            {p.lyric.next && (
              <p key={`n${p.lyric.next}`} className="ph-lyric-next" data-testid="ph-lyric-next" {...lineProps(p.lyric.next)}>
                {p.lyric.next}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export interface PhoneVideoProps {
  m: Moment;
  speaker: string;
  info: PhoneInfoHandlers;
  onSource?: () => void;
  /** Untertitel im Bild wie bisher (Element des Feeds, data-testid=caption) */
  caption: ReactNode;
  notes: boolean;
}

/** Video: unter dem randlosen Player Chip, Kanal, Hook (höchstens drei Zeilen in der größten passenden Stufe) und die Untertitel */
export function PhoneVideo(p: PhoneVideoProps) {
  const box = useRef<HTMLDivElement>(null);
  const hook = useRef<HTMLHeadingElement>(null);
  useHookFit(box, hook, 64, p.m.id);
  return (
    <div className="ph-video" ref={box} data-testid="ph-video" data-notes={p.notes ? '' : undefined} style={{ ['--ad' as string]: AREA_COLOR[p.m.area] }}>
      <PhoneInfo m={p.m} speaker={p.speaker} info={p.info} onSource={p.onSource} hookRef={hook} />
      <div className="ph-cap">{p.caption}</div>
    </div>
  );
}
