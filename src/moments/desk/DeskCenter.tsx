import { useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from 'react';
import { Icon } from '../../components/Icon';
import { captionLines } from '../captions';
import type { Form } from '../form';
import { atTime } from '../hook';
import { isArabic, type Moment } from '../types';
import { AREA_DK, AREA_LABEL } from './area';
import { clipLen, fracAtPointer, groupTop, hookSize } from './model';

/**
 * Mitte der Mac-Ansicht (Runde 44, Desktop ab 1181 px). Chip, Kanal, Hook, Untertitelfeld, Zeitleiste und Abspielleiste.
 * Reine Anzeige: jede Taste ruft eine Funktion des Feeds (Pause, Weiter, goTo, Tempo, Sprung im Ausschnitt). Die Wiedergabe selbst bleibt dort.
 */

export function AreaChip({ m, speaker }: { m: Moment; speaker: string }) {
  return (
    <div className="dc-chiprow" data-testid="desk-speaker" style={{ ['--ad' as string]: AREA_DK[m.area] }}>
      <span className="dc-chip">
        <i aria-hidden="true" />
        {AREA_LABEL[m.area]}
      </span>
      <span className="dc-speaker" dir="auto">
        {speaker}
      </span>
    </div>
  );
}

/** Zeitleiste des Ausschnitts: Zeit links und rechts, Klick oder Ziehen springt (nur wenn der Player springen kann). Sonst reine Anzeige. */
function Timeline({ m, frac, seekable, onSeek }: { m: Moment; frac: number; seekable: boolean; onSeek: (f: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const len = clipLen(m);
  const shown = drag ?? frac;
  const at = (e: RPointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    return fracAtPointer(e.clientX, r.left, r.width);
  };
  const handlers = seekable
    ? {
        onPointerDown: (e: RPointerEvent) => {
          e.stopPropagation();
          bar.current?.setPointerCapture?.(e.pointerId);
          setDrag(at(e));
        },
        onPointerMove: (e: RPointerEvent) => {
          if (drag !== null) setDrag(at(e));
        },
        onPointerUp: (e: RPointerEvent) => {
          if (drag === null) return;
          const f = at(e);
          setDrag(null);
          onSeek(f);
        },
        onPointerCancel: () => setDrag(null),
      }
    : {};
  const pct = `${(shown * 100).toFixed(2)}%`;
  const now = Math.round(shown * len);
  return (
    <div className="dt-time">
      <span data-testid="desk-time-now">{atTime(now)}</span>
      <div
        ref={bar}
        className="dt-bar"
        data-testid="desk-timeline"
        data-seekable={seekable ? '' : undefined}
        role={seekable ? 'slider' : 'progressbar'}
        tabIndex={seekable ? 0 : undefined}
        aria-label="Position in this clip"
        aria-valuemin={0}
        aria-valuemax={Math.round(len)}
        aria-valuenow={now}
        aria-valuetext={`${atTime(now)} of ${atTime(len)}`}
        {...handlers}
      >
        <div className="dt-track">
          <div className="dt-fill" style={{ width: pct }} />
          {seekable && <div className="dt-thumb" style={{ left: pct }} />}
        </div>
      </div>
      <span data-testid="desk-time-len">{atTime(len)}</span>
    </div>
  );
}

function Transport({ m, frac, paused, rate, seekable, canPrev, cc, onPlay, onPrev, onNext, onRate, onSeek }: TransportProps) {
  return (
    <section className="dt" aria-label="Playback" data-testid="desk-transport">
      <Timeline m={m} frac={frac} seekable={seekable} onSeek={onSeek} />
      <div className="dt-row">
        <button type="button" className="dt-rate" data-testid="desk-rate" aria-label={`Speed ${rate}x, tap to change`} title="Speed (Shift + .)" onClick={onRate}>
          Speed {rate}x
        </button>
        <div className="dt-main">
          <button type="button" className="dt-round" data-testid="desk-prev" aria-label="Previous moment" disabled={!canPrev} onClick={onPrev}>
            <Icon name="skip-back" size="var(--icon)" />
          </button>
          <button type="button" className="dt-round dt-play" data-testid="desk-play" aria-label={paused ? 'Play' : 'Pause'} onClick={onPlay}>
            <Icon name={paused ? 'play' : 'pause'} size="var(--icon)" />
          </button>
          <button type="button" className="dt-round" data-testid="desk-next" aria-label="Next moment" onClick={onNext}>
            <Icon name="skip-forward" size="var(--icon)" />
          </button>
        </div>
        {cc ? (
          <button type="button" className="dt-cc" data-testid="desk-cc" aria-label="Captions" aria-pressed={cc.on} title="Captions (C)" onClick={cc.onToggle}>
            CC
          </button>
        ) : (
          <span className="dt-end" aria-hidden="true" />
        )}
      </div>
    </section>
  );
}

interface TransportProps {
  m: Moment;
  frac: number;
  paused: boolean;
  rate: number;
  seekable: boolean;
  canPrev: boolean;
  /** Video mit Untertiteln: Taste CC rechts in der Leiste (schaltet wie Taste C). Sonst bleibt der Platz frei. */
  cc?: { on: boolean; onToggle: () => void };
  onPlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRate: () => void;
  onSeek: (f: number) => void;
}

export interface DeskCenterProps extends TransportProps {
  form: Form;
  speaker: string;
  /** Audio: das Cover (Feed-Baustein mit Wiederladen), 176 px */
  cover: ReactNode;
  /** Untertitel sind an (Regel des Moments oder Taste C) und der Moment hat welche */
  captionsOn: boolean;
  hasCaptions: boolean;
  /** Audio: aktuelle und vorige Zeile. Ohne Cues der geprüfte Text (excerpt). */
  lyric: { prev: string; cur: string; next: string };
  fallbackText: string;
  /** Video: Untertitel im Bild, die aktuelle Zeile */
  subtitle: string;
  onCaptions: () => void;
}

const lineProps = (s: string) => ({ dir: isArabic(s) ? ('rtl' as const) : ('ltr' as const), lang: isArabic(s) ? 'ar' : 'en' });

/**
 * Video: Player, Meta und Leiste bilden eine Gruppe mit gleichen Abständen, in der Spalte mittig. Der Player hängt per CSS an --dc-y (Feed), darum misst
 * dieser Hook die Gruppe und setzt --dc-y. Die Höhe von Meta und Leiste hängt nicht von --dc-y ab, es gibt keine Rückkopplung.
 */
function useGroupTop(ref: RefObject<HTMLDivElement | null>, on: boolean) {
  useLayoutEffect(() => {
    const dc = ref.current;
    const feed = dc?.closest<HTMLElement>('.vfeed');
    if (!on || !dc || !feed) return;
    const fit = () => {
      const cs = getComputedStyle(dc);
      const gap = parseFloat(cs.rowGap) || 0;
      const kids = [...dc.children] as HTMLElement[];
      const h = kids.reduce((n, k) => n + k.offsetHeight, 0) + gap * Math.max(0, kids.length - 1);
      const min = parseFloat(getComputedStyle(feed).getPropertyValue('--dc-top')) || 40;
      feed.style.setProperty('--dc-y', `${groupTop(dc.clientHeight, h, min)}px`);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return () => feed.style.removeProperty('--dc-y');
    const ro = new ResizeObserver(fit);
    ro.observe(dc);
    for (const k of dc.children) ro.observe(k);
    return () => {
      ro.disconnect();
      feed.style.removeProperty('--dc-y');
    };
  });
}

export function DeskCenter(p: DeskCenterProps) {
  const { m, form } = p;
  const dcRef = useRef<HTMLDivElement>(null);
  useGroupTop(dcRef, form === 'video');
  if (form === 'text') return <DeskTextBar canPrev={p.canPrev} onPrev={p.onPrev} onNext={p.onNext} />;
  const meta = (
    <div className="dc-meta">
      <AreaChip m={m} speaker={p.speaker} />
      <h1 className="dc-hook" data-testid="desk-hook" data-size={hookSize(m.hook)} dir="auto">
        {m.hook}
      </h1>
    </div>
  );
  return (
    <div className="dc" ref={dcRef} data-form={form} data-testid="desk-center" style={{ ['--ad' as string]: AREA_DK[m.area] }}>
      {form === 'video' ? (
        <>
          <div className="dc-media" data-testid="desk-media">
            {p.captionsOn && p.subtitle && (
              <div className="dc-sub" data-testid="desk-subtitle">
                {captionLines(p.subtitle).map((line, k) => (
                  <span key={k} {...lineProps(line)}>
                    {line}
                  </span>
                ))}
              </div>
            )}
          </div>
          {meta}
        </>
      ) : (
        <>
          <section className="dc-head">
            <div className="dc-cover" data-testid="desk-cover">
              {p.cover}
            </div>
            {meta}
          </section>
          <section className="dc-lyrics" data-testid="desk-lyrics" aria-label="Captions" aria-live="off">
            {!p.hasCaptions && !p.fallbackText ? (
              <p className="dc-lyric-note">No captions for this moment.</p>
            ) : !p.captionsOn ? (
              <p className="dc-lyric-note">Captions are off. Press C to show them.</p>
            ) : p.hasCaptions ? (
              <>
                {p.lyric.prev && (
                  <p key={`p${p.lyric.prev}`} className="dc-lyric-prev" data-testid="desk-lyric-prev" {...lineProps(p.lyric.prev)}>
                    {p.lyric.prev}
                  </p>
                )}
                <p key={`c${p.lyric.cur}`} className="dc-lyric-cur" data-testid="desk-lyric-cur" {...lineProps(p.lyric.cur)}>
                  {p.lyric.cur}
                </p>
                {p.lyric.next && (
                  <p key={`n${p.lyric.next}`} className="dc-lyric-next" data-testid="desk-lyric-next" {...lineProps(p.lyric.next)}>
                    {p.lyric.next}
                  </p>
                )}
              </>
            ) : (
              <p className="dc-lyric-text" data-testid="desk-lyric-text" {...lineProps(p.fallbackText)}>
                {p.fallbackText}
              </p>
            )}
          </section>
        </>
      )}
      <Transport {...p} cc={form === 'video' && p.hasCaptions ? { on: p.captionsOn, onToggle: p.onCaptions } : undefined} />
    </div>
  );
}

/** Text-Reiter: Leiste unten mit Voriger und Nächster (der Text selbst steht im Lesebereich des Feeds) */
function DeskTextBar({ canPrev, onPrev, onNext }: { canPrev: boolean; onPrev: () => void; onNext: () => void }) {
  return (
    <nav className="dc-textbar" aria-label="Moments" data-testid="desk-textbar">
      <button type="button" className="dt-pill" data-testid="desk-prev" disabled={!canPrev} onClick={onPrev}>
        <Icon name="arrow-up" size="var(--icon-sm)" />
        Previous
      </button>
      <button type="button" className="dt-pill" data-testid="desk-next" onClick={onNext}>
        Next
        <Icon name="arrow-down" size="var(--icon-sm)" />
      </button>
    </nav>
  );
}

/** Kopf des Lesebereichs im Text-Reiter: Chip, Kanal, Hook als große Serifen-Überschrift */
export function DeskTextHead({ m, speaker }: { m: Moment; speaker: string }) {
  return (
    <header className="dtx-head" data-testid="desk-textmeta">
      <AreaChip m={m} speaker={speaker} />
      <h1 className="dtx-hook" data-testid="desk-hook" data-size={hookSize(m.hook)} dir="auto">
        {m.hook}
      </h1>
    </header>
  );
}

/** Fuß des Lesebereichs: Herkunft und "Apply today", nur wenn der Moment sie hat */
export function DeskTextFoot({ m }: { m: Moment }) {
  const origin = m.origin?.trim();
  const apply = m.apply?.trim();
  if (!origin && !apply) return null;
  return (
    <>
      {origin && (
        <p className="dtx-origin" data-testid="desk-origin" dir="auto">
          {origin}
        </p>
      )}
      {apply && (
        <section className="dtx-apply" data-testid="desk-apply" style={{ ['--ad' as string]: AREA_DK[m.area] }}>
          <h2>Apply today</h2>
          <p dir="auto">{apply}</p>
        </section>
      )}
    </>
  );
}
