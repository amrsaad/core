import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Icon } from '../../components/Icon';
import { AREA_COLOR, AREA_LABEL } from '../../lib/labels';
import { isArabic, type Moment } from '../types';
import { PhoneLyrics } from './PhoneLyrics';
import { cleanText } from '../textfit';

/**
 * Runde 45: Inhalt der iPhone-Ansicht zwischen Reiterleiste und Aktionsreihe (Audio und Video). Chip, Kanal, Hook, im Audio das Feld mit dem mitlaufenden Text.
 * Reine Anzeige. Die Berührung des Kopfs (Tipp öffnet den Kontext) steuert der Feed über info.
 */

const lineProps = (s: string) => ({ dir: isArabic(s) ? ('rtl' as const) : ('ltr' as const), lang: isArabic(s) ? 'ar' : 'en' });

/**
 * Der Hook wird nie gekürzt. Er steht in der größten von drei Stufen (28, 24, 21 px im Audio, 24, 21, 18 px im Video), die in den Platz passt.
 * Platz = Höhe des Blocks minus Chip-Zeile, Abstände und der Mindestplatz darunter (reserve). Passt auch die kleinste nicht, bleibt sie und der Platz darunter schrumpft.
 */
function useHookFit(box: RefObject<HTMLElement>, hook: RefObject<HTMLElement>, reserve: number, key: string, fallback = reserve, clamp = false) {
  useLayoutEffect(() => {
    const b = box.current;
    const h = hook.current;
    if (!b || !h) return;
    const fit = () => {
      h.style.removeProperty('--hook-lines');
      delete h.dataset.clamp;
      const cs = getComputedStyle(b);
      const gap = parseFloat(cs.rowGap) || 0;
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      // Audio (clamp): die Chip-Zeile liegt vor dem Tipp-Umschlag des Hooks, nicht vor dem Hook selbst (sonst fehlen ihre 24 px in der Rechnung)
      const row = (clamp ? h.closest('.ph-hooktap')?.previousElementSibling : h.previousElementSibling) as HTMLElement | null;
      const avail = b.clientHeight - pad - (row?.offsetHeight ?? 0) - gap;
      // Erst mit der Reserve für das Titelbild: die größte Stufe, bei der es Platz hat. Gibt es keine (kleine Karte), gilt die Reserve ohne Bild (das Bild entfällt dann per CSS), der Hook schrumpft nicht umsonst.
      const pick = (r: number): number | null => {
        for (let s = 0; s <= 2; s++) {
          h.dataset.step = String(s);
          if (h.scrollHeight <= avail - r - (clamp ? gap : 0)) return s;
        }
        return null;
      };
      const s = pick(reserve) ?? pick(fallback) ?? 2;
      h.dataset.step = String(s);
      // Runde 50b (nur Audio): passt auch die kleinste Stufe nicht, werden die Hook-Zeilen geklemmt (Auslassung), damit die Karte ihre Mindesthöhe behält und nie die Aktionsreihe berührt
      if (clamp) {
        const room = avail - reserve - gap;
        const lhh = parseFloat(getComputedStyle(h).lineHeight) || 0;
        if (lhh && h.scrollHeight > room + 0.5) {
          h.style.setProperty('--hook-lines', String(Math.max(1, Math.floor((room + 0.5) / lhh))));
          h.dataset.clamp = '';
        }
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

/** Titelbild des Audio-Moments (Runde 48, ab Runde 49 groß oben in der Karte, ab Runde 50 als Quadrat): Adresse beim Originalanbieter, nur wenn das Feld thumb eine https-Adresse ist */
export const coverUrl = (thumb?: string): string => (thumb && /^https:\/\//i.test(thumb.trim()) ? thumb.trim() : '');

export function PhoneInfo({ m, speaker, info, onSource, hookRef }: { m: Moment; speaker: string; info: PhoneInfoHandlers; onSource?: () => void; hookRef: RefObject<HTMLHeadingElement> }) {
  return (
    <>
      <div className="ph-chiprow">
        <div className="ph-tap" data-testid="info-tap" {...info}>
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
          {cleanText(m.hook)}
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
  /** Nummer des aktuellen Cues (kleiner als 0: noch keiner) */
  cueIdx: number;
  /** Ohne Untertitel: der Auszug des Moments */
  fallbackText: string;
  /** Platz unter der Zeile der Rückmeldung ("N notes, send?") */
  notes: boolean;
  /** Diagnose-Zeile "cover: <id> ok|late|error|none" */
  onCover?: (line: string) => void;
}

/** Ab wann ein Titelbild in der Diagnose als verspätet gilt (ms nach dem Wechsel zum Moment). Das Bild wird trotzdem eingeblendet, sobald es da ist, es gibt keine Zeitgrenze. */
export const COVER_WAIT_MS = 600;
/** Kleinere Bilder (zum Beispiel ein durchsichtiges 1x1) gelten als Fehler */
const COVER_MIN_PX = 16;
type CoverPhase = 'wait' | 'ready' | 'error';

/** Audio: Chip, Kanal, Hook, darunter das Feld mit dem mitlaufenden Text (durchgehende Liste, siehe PhoneLyrics) */
export function PhoneAudio(p: PhoneAudioProps) {
  const box = useRef<HTMLDivElement>(null);
  const hook = useRef<HTMLHeadingElement>(null);
  // Titelbild nur im aktiven Moment (diese Ansicht steht nur für ihn). Hat der Moment ein Bild (thumb), ist das Quadrat von Anfang an reserviert (Runde 50c, keine Layoutverschiebung):
  // bis das Bild da ist (ohne Zeitgrenze) und bei einem Ladefehler steht dort eine ruhige Fläche in der Bereichsfarbe, das Bild blendet ein. Ohne thumb kein Quadrat.
  const thumb = coverUrl(p.m.thumb);
  const [st, setSt] = useState<{ src: string; p: CoverPhase }>({ src: '', p: 'wait' });
  const phase: CoverPhase = thumb ? (st.src === thumb ? st.p : 'wait') : 'error';
  const src = thumb && phase !== 'error' ? thumb : '';
  const ready = !!src && phase === 'ready';
  const reserved = !!thumb;
  const img = useRef<HTMLImageElement>(null);
  const t0 = useRef(0);
  const logged = useRef('');
  const note = (id: string, ph: string) => {
    if (logged.current === `${id}|${ph}`) return;
    logged.current = `${id}|${ph}`;
    p.onCover?.(`cover: ${id} ${ph}`);
  };
  // Diagnose: nur das erste Urteil je Moment zählt (ok: kam innerhalb COVER_WAIT_MS, late: kam später oder war nach COVER_WAIT_MS noch nicht da, error: Ladefehler)
  const settled = useRef('');
  const verdict = (v: 'ok' | 'late' | 'error') => {
    if (settled.current === `${p.m.id}|${thumb}`) return;
    settled.current = `${p.m.id}|${thumb}`;
    note(p.m.id, v);
  };
  const fail = () => { verdict('error'); setSt({ src: thumb, p: 'error' }); };
  const judge = (el: HTMLImageElement) => {
    if (!(el.naturalWidth >= COVER_MIN_PX && el.naturalHeight >= COVER_MIN_PX)) return fail();
    setWide(Math.abs(el.naturalWidth / el.naturalHeight - 1) > 0.02 ? thumb : '');
    verdict(performance.now() - t0.current <= COVER_WAIT_MS ? 'ok' : 'late');
    setSt({ src: thumb, p: 'ready' });
  };
  useLayoutEffect(() => {
    if (!thumb) {
      note(p.m.id, 'none');
      return;
    }
    t0.current = performance.now();
    const timer = window.setTimeout(() => verdict('late'), COVER_WAIT_MS);
    // Ein Bild aus dem Cache kann geladen sein, bevor der Handler hängt
    const el = img.current;
    if (el?.complete) {
      window.clearTimeout(timer);
      judge(el);
      return;
    }
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumb, p.m.id]);
  // Ohne Untertitel zum Anzeigen (CC aus, kein Text): das Bild steht als größtmögliches Quadrat mittig in der Karte
  const fill = reserved && (p.hasCaptions ? !p.captionsOn : !p.fallbackText);
  // Nicht quadratisches Bild: ganz sichtbar (contain) auf der Quadratfläche statt beschnitten (cover)
  const [wide, setWide] = useState('');
  // Reserve unter dem Hook: wie ohne Bild. Der Hook wird wegen des Bildes nicht kleiner (Runde 50, gemessen): das Bild nimmt nur Platz, der übrig ist, und entfällt sonst.
  const cues = p.m.cues ?? [];
  const sample = (p.cueIdx >= 0 && cues[p.cueIdx]?.[1]) || cues[0]?.[1] || p.fallbackText || p.m.hook;
  // Mindesthöhe der Karte ohne Bild: drei Zeilen der aktuellen Zeile samt Innenabstand und Rand (arabisch höhere Zeilen)
  useHookFit(box, hook, lineProps(sample).dir === 'rtl' ? 180 : 132, p.m.id, undefined, true);
  const lines =
    !p.hasCaptions && !p.fallbackText ? (
      <div className="ph-lyr-body"><p className="ph-lyric-note">No captions for this moment.</p></div>
    ) : !p.hasCaptions ? (
      <div className="ph-lyr-body">
        <p className="ph-lyric-text" data-testid="ph-lyric-text" {...lineProps(p.fallbackText)}>
          {p.fallbackText}
        </p>
      </div>
    ) : !p.captionsOn ? (
      <div className="ph-lyr-body"><p className="ph-lyric-note">Captions are off. Tap CC to show them.</p></div>
    ) : (
      <PhoneLyrics key={`l${p.m.id}`} id={p.m.id} cues={cues} idx={p.cueIdx} />
    );
  return (
    <div className="ph-audio" ref={box} data-testid="ph-audio" data-notes={p.notes ? '' : undefined} style={{ ['--ad' as string]: AREA_COLOR[p.m.area] }}>
      <PhoneInfo m={p.m} speaker={p.speaker} info={p.info} onSource={p.onSource} hookRef={hook} />
      <section className="ph-lyrics" data-testid="ph-lyrics" aria-label="Captions" aria-live="off" data-art={reserved ? (fill ? 'fill' : 'top') : undefined} data-dir={reserved ? lineProps(sample).dir : undefined}>
        {reserved && (
          <div className="ph-art" data-testid="ph-cover-slot" data-state={phase}>
            {phase === 'error' && <Icon name="headphones" size="40px" className="ph-art-sym" />}
            {src && (
              <img
                key={`c${p.m.id}`}
                ref={img}
                className="ph-art-img"
                data-testid="ph-cover"
                data-ready={ready ? 'yes' : 'no'}
                data-fit={wide === src ? 'contain' : 'cover'}
                src={src}
                alt=""
                width={128}
                height={128}
                decoding="async"
                referrerPolicy="no-referrer"
                onLoad={(e) => judge(e.currentTarget)}
                onError={fail}
              />
            )}
          </div>
        )}
        {fill ? null : lines}
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
