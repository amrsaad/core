import { useCallback, useEffect, useRef, useState } from 'react';
import { dayKey, now as clockNow } from '../lib/clock';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import type { AppState } from '../lib/state';
import { createPlayer, HLS, loadYT, STATE, type YTPlayer } from '../video/ytApi';
import { applySignal, leaveSignal, newMomentCursor, nextMomentBlock, SIGNAL, type MomentCursor } from './mix';
import { clampRate, DEFAULT_SPEED, HOLD_SPEED, speedOf } from '../lib/state';
import { addSample } from './latency';
import { captionsShown } from './captions';
import { fullVideoUrl, isArabic, thumbOf, type Feedback, type Moment } from './types';

interface Props {
  pool: Moment[];
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  active: boolean;
  onPausedChange: (paused: boolean) => void;
}

interface Slot {
  host: HTMLDivElement | null;
  /** Rahmen des Slots, trägt data-live, solange der Player wirklich abspielt (Vorschaubild wird synchron ausgeblendet) */
  el: HTMLDivElement | null;
  player: YTPlayer | null;
  ready: boolean;
  index: number;
  st: number;
  /** Moment-ID, die gerade im Player steckt */
  mid: string;
}

const END_GUARD = 0.3;
const FOR_YOU_MS = 6000;
const POLL_MS = 150;
const SWIPE_PX = 60;
const TAP_MS = 260;
const LONG_MS = 520;
const LOG_MAX = 3000;

const load = (m: Moment) => ({ videoId: m.videoId, startSeconds: m.start, endSeconds: m.end });

export function MomentFeed({ pool, state, update, active, onPausedChange }: Props) {
  const single = state.settings.playerMode === 'single';
  const SLOTS = single ? 1 : 3;
  const stateRef = useRef(state);
  stateRef.current = state;

  const queue = useRef<Moment[]>([]);
  const cursor = useRef<MomentCursor | null>(null);
  const idxRef = useRef(0);
  const slots = useRef<Slot[]>(Array.from({ length: 3 }, () => ({ host: null, el: null, player: null, ready: false, index: -1, st: STATE.UNSTARTED, mid: '' })));
  const soundOn = useRef(false);
  const userPaused = useRef(false);
  const since = useRef(Date.now());
  const endedAt = useRef(-1);
  const forYouRef = useRef(false);
  const forYouTimer = useRef(0);
  const feedMs = useRef(0);
  const dragEl = useRef<HTMLDivElement>(null);
  const diag = useRef<string[]>([]);
  const bad = useRef(new Set<string>());
  const everPlayed = useRef(false);
  /** Offene Messung Wisch bis erstes Bild */
  const swipe = useRef<{ j: number; t0: number; buffered: boolean } | null>(null);

  const [idx, setIdx] = useState(0);
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState(true);
  const [paused, setPaused] = useState(false);
  const [menu, setMenu] = useState(false);
  const [fast, setFast] = useState(false);
  const rateRef = useRef(DEFAULT_SPEED);
  const fastRef = useRef(false);
  const endFast = () => {
    fastRef.current = false;
    for (const sl of slots.current) sl.player?.setPlaybackRate(clampRate(rateRef.current));
    setFast(false);
  };
  const [forYou, setForYou] = useState<Moment | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);
  const waitSince = useRef(0);
  rateRef.current = speedOf(state.settings);

  const today = dayKey(clockNow());
  const show = (t: string) => {
    setFlash(t);
    window.setTimeout(() => setFlash(null), 900);
  };

  const ensureQueue = useCallback(
    (upTo: number) => {
      const s = stateRef.current;
      cursor.current ??= newMomentCursor(s.momentDay !== today);
      while (queue.current.length < upTo) {
        const b = nextMomentBlock(pool, { areaShares: s.settings.areaShares, weights: s.momentWeights, seen: s.momentSeen, mutedChannels: s.mutedChannels }, cursor.current);
        if (!b || !b.length) break;
        queue.current.push(...b.filter((m) => !bad.current.has(m.videoId)));
      }
    },
    [pool, today],
  );

  const slotFor = (j: number) => slots.current[single ? 0 : ((j % 3) + 3) % 3];
  const current = () => slotFor(idxRef.current);
  const applySound = (p: YTPlayer) => (soundOn.current ? p.unMute() : p.mute());

  const assign = useCallback((slot: Slot, j: number, play: boolean) => {
    const m = queue.current[j];
    slot.index = j;
    if (!m || !slot.player || !slot.ready) return;
    // Vorladen ohne Ton, der aktuelle Moment bekommt den gewählten Ton
    if (play) applySound(slot.player);
    else slot.player.mute();
    if (slot.mid !== m.id) {
      slot.mid = m.id;
      slot.st = STATE.UNSTARTED;
      if (play) slot.player.loadVideoById(load(m));
      // YouTube lädt bei cue nur das Vorschaubild. Darum stumm laden, der Player hält beim ersten Bild an (siehe onState).
      else if (!HLS.has(m.videoId)) slot.player.loadVideoById(load(m));
      else slot.player.cueVideoById(load(m));
    } else if (play) slot.player.playVideo();
    else slot.player.pauseVideo();
  }, []);

  const log = (m: Moment, patch: { ended?: boolean; feedback?: Feedback }) =>
    update((s) => {
      const watched = Math.round((Date.now() - since.current) / 1000);
      const entries = [...s.momentLog];
      const i = entries.findIndex((e) => e.id === m.id && e.day === today);
      if (i >= 0) entries[i] = { ...entries[i], ...patch, watched: Math.max(entries[i].watched, watched) };
      else entries.push({ id: m.id, day: today, ended: false, watched, ...patch });
      return { ...s, momentLog: entries.slice(-LOG_MAX) };
    });

  const markSeen = (m: Moment | undefined) => {
    if (!m) return;
    update((s) => ({ ...s, momentDay: today, momentSeen: s.momentSeen[m.id] ? s.momentSeen : { ...s.momentSeen, [m.id]: Date.now() } }));
  };

  const soundGuard = (j: number) => {
    window.setTimeout(() => {
      const sl = slotFor(j);
      if (idxRef.current !== j || userPaused.current || !sl.player || forYouRef.current) return;
      if (sl.st !== STATE.PLAYING && soundOn.current) {
        sl.player.mute();
        sl.player.playVideo();
        soundOn.current = false;
        setHint(true);
      }
    }, 1500);
  };

  const closeForYou = () => {
    window.clearTimeout(forYouTimer.current);
    forYouRef.current = false;
    setForYou(null);
  };

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next === idxRef.current) return;
      closeForYou();
      const from = idxRef.current + 1;
      const rest = queue.current.slice(from);
      const clean = rest.filter((x) => !bad.current.has(x.videoId));
      if (clean.length !== rest.length) {
        queue.current = [...queue.current.slice(0, from), ...clean];
        for (const sl of slots.current) if (sl.index >= from) sl.index = -1;
      }
      ensureQueue(next + 4);
      if (next >= queue.current.length) return;
      const prev = idxRef.current;
      const prevM = queue.current[prev];
      // Weitergewischt: Signal nach geschautem Anteil (unter 5 s Minus, fast ganz geschaut leichtes Plus)
      if (next > prev && prevM && endedAt.current !== prev) {
        const f = leaveSignal((Date.now() - since.current) / 1000, prevM.end - prevM.start);
        if (f) update((s) => ({ ...s, momentWeights: applySignal(s.momentWeights, prevM, f) }));
      }
      // Zurückgewischt, um etwas nochmal zu sehen: Plus für den Zielmoment
      const backM = queue.current[next];
      if (next < prev && backM) update((s) => ({ ...s, momentWeights: applySignal(s.momentWeights, backM, SIGNAL.back) }));
      setCaption('');
      endFast();
      waitSince.current = 0;
      setLoading(false);
      if (prevM && endedAt.current !== prev) log(prevM, {});
      current().player?.pauseVideo();
      idxRef.current = next;
      since.current = Date.now();
      endedAt.current = -1;
      userPaused.current = false;
      setPaused(false);
      setProgress(0);
      const target = slotFor(next);
      const nm = queue.current[next];
      // Gepuffert heißt: der Vorlade-Player hält genau diesen Moment schon angehalten am Start
      swipe.current = { j: next, t0: performance.now(), buffered: !single && !!nm && target.ready && target.mid === nm.id && target.st === STATE.PAUSED };
      if (single) assign(slots.current[0], next, true);
      else {
        assign(slotFor(next), next, true);
        for (const j of [next + 1, next + 2]) if (slotFor(j).index !== j) assign(slotFor(j), j, false);
      }
      markSeen(queue.current[next]);
      soundGuard(next);
      setIdx(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ensureQueue, assign, single],
  );

  /** Moment bis end geschaut: Signal, dann Für dich (falls gesetzt) oder direkt weiter */
  const finish = useCallback(() => {
    if (endedAt.current === idxRef.current) return;
    endedAt.current = idxRef.current;
    const m = queue.current[idxRef.current];
    current().player?.pauseVideo();
    if (!m) return;
    log(m, { ended: true });
    update((s) => ({ ...s, momentWeights: applySignal(s.momentWeights, m, SIGNAL.ended) }));
    if (m.forYou) {
      forYouRef.current = true;
      setForYou(m);
      forYouTimer.current = window.setTimeout(() => goTo(idxRef.current + 1), FOR_YOU_MS);
    } else goTo(idxRef.current + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTo]);

  // Player anlegen
  useEffect(() => {
    let cancelled = false;
    ensureQueue(6);
    if (!queue.current.length) return;
    loadYT()
      .then((YT) => {
        if (cancelled) return;
        for (let s = 0; s < SLOTS; s++) {
          const slot = slots.current[s];
          const j = single ? 0 : s;
          const m = queue.current[j];
          if (!slot.host || !m) continue;
          slot.index = j;
          slot.mid = '';
          const target = document.createElement('div');
          slot.host.replaceChildren(target);
          slot.player = createPlayer(YT, target, m.videoId, {
            onReady: () => {
              slot.ready = true;
              slot.player!.mute();
              assign(slot, slot.index, slot.index === idxRef.current);
              if (slot.index === idxRef.current) markSeen(queue.current[slot.index]);
              rerender();
            },
            onState: (st) => {
              diag.current.push(`slot${s} ${slot.mid} state ${st}`);
              slot.st = st;
              // Vorschaubild bleibt bis zum ersten Bild: ohne Umweg über React, damit kein Frame der YouTube-Oberfläche durchrutscht
              slot.el?.toggleAttribute('data-live', st === STATE.PLAYING);
              if (st === STATE.PLAYING) everPlayed.current = true;
              const sw = swipe.current;
              if (st === STATE.PLAYING && sw && slot.index === sw.j && sw.j === idxRef.current) {
                swipe.current = null;
                const ms = Math.round(performance.now() - sw.t0);
                diag.current.push(`first-frame ${ms}ms ${sw.buffered ? 'buffered' : 'cold'}`);
                update((x) => ({ ...x, playLatency: addSample(x.playLatency, { ms, buffered: sw.buffered, at: Date.now() }) }));
              }
              // Standardtempo nach Fundament-Regel 11 (1,5x), gehaltenes 2x bleibt bis zum Loslassen
              if (st === STATE.PLAYING && !fastRef.current) slot.player?.setPlaybackRate(clampRate(rateRef.current));
              if (st === STATE.ENDED && slot.index === idxRef.current) finish();
              if (st === STATE.PLAYING && (slot.index !== idxRef.current || forYouRef.current)) slot.player?.pauseVideo();
              rerender();
            },
            onError: (code) => {
              const m2 = queue.current[slot.index];
              diag.current.push(`slot${s} ${slot.mid} error ${code}`);
              if (m2) bad.current.add(m2.videoId);
              if (!everPlayed.current && bad.current.size >= 8) setError(`YouTube spielt gerade keine Videos ab (Fehler ${code})`);
              else if (slot.index === idxRef.current) goTo(idxRef.current + 1);
            },
          });
        }
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      for (const s of slots.current) {
        s.player?.destroy();
        s.el?.removeAttribute('data-live');
        Object.assign(s, { player: null, ready: false, index: -1, st: STATE.UNSTARTED, mid: '' });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, pool.length > 0]);

  // Ende genau bei end (Polling zusätzlich zu endSeconds), Fortschritt, Feed-Zeit
  useEffect(() => {
    let flushed = 0;
    const t = window.setInterval(() => {
      const sl = current();
      const p = sl.player;
      const m = queue.current[idxRef.current];
      if (!p || !sl.ready || !m || forYouRef.current) return;
      const c = p.getCurrentTime?.() ?? 0;
      // Laden sichtbar machen, hängende Momente überspringen
      if (sl.st === STATE.PLAYING || userPaused.current) {
        waitSince.current = 0;
        setLoading(false);
      } else {
        waitSince.current ||= Date.now();
        const waited = Date.now() - waitSince.current;
        setLoading(waited > 400);
        // Nur wenn in dieser Sitzung schon etwas lief (sonst blockiert z.B. der Stromsparmodus Autoplay und alles würde übersprungen)
        if (everPlayed.current && waited > 12_000 && c < m.start + 1) {
          diag.current.push(`watchdog ${m.id}`);
          bad.current.add(m.videoId);
          waitSince.current = 0;
          goTo(idxRef.current + 1);
          return;
        }
      }
      if (sl.st === STATE.PLAYING || sl.st === STATE.PAUSED) {
        setProgress(Math.min(1, Math.max(0, (c - m.start) / (m.end - m.start))));
        const rel = c - m.start;
        let cue = '';
        if (m.cues) for (const [t, text] of m.cues) if (t <= rel + 0.1) cue = text; else break;
        setCaption(cue);
      }
      if (sl.st === STATE.PLAYING && c >= m.end - END_GUARD) finish();
      if (sl.st === STATE.PLAYING && document.visibilityState === 'visible') {
        feedMs.current += POLL_MS;
        if (feedMs.current - flushed >= 10_000) {
          const add = feedMs.current - flushed;
          flushed = feedMs.current;
          update((s) => ({ ...s, feedTime: { ...s.feedTime, [today]: (s.feedTime[today] ?? 0) + add } }));
        }
      }
    }, POLL_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish, today]);

  useEffect(() => {
    if (!active) current().player?.pauseVideo();
    else if (!userPaused.current && !forYouRef.current) current().player?.playVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => onPausedChange(paused), [paused, onPausedChange]);

  // ---- Gesten ----
  const g = useRef({ x: 0, y: 0, t: 0, moved: false, long: 0, fired: false, tap: 0, lastUp: 0, dy: 0 });
  const setDrag = (px: number) => {
    dragEl.current?.style.setProperty('--drag', `${px}px`);
    if (!px) dragEl.current?.removeAttribute('data-drag');
  };

  const togglePlay = () => {
    const p = current().player;
    if (!p) return;
    if (!soundOn.current) {
      soundOn.current = true;
      for (const s of slots.current) s.player?.unMute();
      p.playVideo();
      userPaused.current = false;
      setPaused(false);
      setHint(false);
      return;
    }
    if (current().st === STATE.PLAYING) {
      p.pauseVideo();
      userPaused.current = true;
      setPaused(true);
    } else {
      p.playVideo();
      userPaused.current = false;
      setPaused(false);
    }
  };

  /** Knopf: Speichern und wieder Entfernen. Doppeltipp speichert nur, wie bei Reels. */
  const toggleSave = () => {
    const m = queue.current[idxRef.current];
    if (!m) return;
    if (!stateRef.current.savedMoments[m.id]) return save();
    update((s) => {
      const x = { ...s.savedMoments };
      delete x[m.id];
      return { ...s, savedMoments: x };
    });
    show('Removed');
  };

  const save = () => {
    const m = queue.current[idxRef.current];
    if (!m) return;
    if (stateRef.current.savedMoments[m.id]) return show('Already saved');
    navigator.vibrate?.(15);
    update((s) => ({ ...s, savedMoments: { ...s.savedMoments, [m.id]: { moment: m, savedAt: new Date().toISOString() } }, momentWeights: applySignal(s.momentWeights, m, SIGNAL.save) }));
    show('Saved');
  };

  const feedback = (fb: Feedback) => {
    const m = queue.current[idxRef.current];
    setMenu(false);
    if (!m) return;
    const factor = fb === 'mehr' ? SIGNAL.more : SIGNAL.negative;
    update((s) => ({ ...s, momentWeights: applySignal(s.momentWeights, m, factor) }));
    log(m, { feedback: fb });
    show({ mehr: 'More like this', kenne: 'Already known', schwach: 'Weak', falsch: 'Wrong' }[fb]);
    if (fb !== 'mehr') goTo(idxRef.current + 1);
  };

  const muteChannel = () => {
    const m = queue.current[idxRef.current];
    setMenu(false);
    if (!m) return;
    update((s) => ({ ...s, mutedChannels: { ...s.mutedChannels, [m.channel]: m.channel } }));
    stateRef.current = { ...stateRef.current, mutedChannels: { ...stateRef.current.mutedChannels, [m.channel]: m.channel } };
    const keep = queue.current.slice(0, idxRef.current + 1);
    queue.current = [...keep, ...queue.current.slice(idxRef.current + 1).filter((x) => x.channel !== m.channel)];
    for (const sl of slots.current) if (sl.index > idxRef.current) sl.index = -1;
    show(`${speakerLine(m.channel)} muted`);
    goTo(idxRef.current + 1);
  };

  const openFull = () => {
    const m = queue.current[idxRef.current];
    setMenu(false);
    if (!m) return;
    current().player?.pauseVideo();
    userPaused.current = true;
    setPaused(true);
    // Öffnet auf dem iPhone die YouTube-App an der Stelle des Moments
    window.open(fullVideoUrl(m), '_blank', 'noopener');
  };

  const onDown = (e: React.PointerEvent) => {
    const r = g.current;
    Object.assign(r, { x: e.clientX, y: e.clientY, t: Date.now(), moved: false, fired: false, dy: 0 });
    window.clearTimeout(r.long);
    r.long = window.setTimeout(() => {
      r.fired = true;
      navigator.vibrate?.(10);
      current().player?.setPlaybackRate(clampRate(HOLD_SPEED));
      fastRef.current = true;
      setFast(true);
    }, LONG_MS);
  };
  const onMove = (e: React.PointerEvent) => {
    const r = g.current;
    if (!r.t) return;
    r.dy = e.clientY - r.y;
    if (Math.abs(r.dy) > 10 || Math.abs(e.clientX - r.x) > 10) {
      r.moved = true;
      window.clearTimeout(r.long);
    }
    if (r.moved && !single) {
      dragEl.current?.setAttribute('data-drag', '1');
      setDrag(r.dy);
    }
  };
  const onUp = () => {
    const r = g.current;
    window.clearTimeout(r.long);
    const wasDown = r.t;
    r.t = 0;
    if (r.fired) {
      r.fired = false;
      endFast();
      return;
    }
    if (!wasDown) return;
    if (r.moved) {
      setDrag(0);
      if (r.dy < -SWIPE_PX) goTo(idxRef.current + 1);
      else if (r.dy > SWIPE_PX) goTo(idxRef.current - 1);
      return;
    }
    const t = Date.now();
    if (t - r.lastUp < TAP_MS) {
      window.clearTimeout(r.tap);
      r.lastUp = 0;
      save();
      return;
    }
    r.lastUp = t;
    if (!soundOn.current) {
      togglePlay();
      return;
    }
    r.tap = window.setTimeout(togglePlay, TAP_MS);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!active) return;
      if (e.key === 'ArrowDown' || e.key === 'j') goTo(idxRef.current + 1);
      if (e.key === 'ArrowUp' || e.key === 'k') goTo(idxRef.current - 1);
      if (e.key === ' ') togglePlay();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, goTo]);

  // Test-Hook für Playwright (liest nur App-Zustand, nicht den Cross-Origin-Player)
  useEffect(() => {
    (window as unknown as { __core?: unknown }).__core = {
      idx: () => idxRef.current,
      moment: () => queue.current[idxRef.current],
      state: () => current().st,
      time: () => current().player?.getCurrentTime?.() ?? 0,
      forYou: () => forYouRef.current,
      next: () => goTo(idxRef.current + 1),
      diag: () => diag.current.slice(-40),
      slots: () => slots.current.slice(0, SLOTS).map((x) => ({ st: x.st, index: x.index })),
      latency: () => stateRef.current.playLatency ?? [],
    };
  });

  if (pool.length && !queue.current.length) ensureQueue(6);

  if (!pool.length) return <Empty text="No moments in the pool yet. The daily run fills it." />;
  if (error) return <Empty text={`${error}. Moments need internet.`} />;
  if (!queue.current.length) return <Empty text="You have seen every moment. New ones arrive with the next daily run." />;

  const m = queue.current[idx];
  const saved = m && !!state.savedMoments[m.id];
  const captionsOn = !!m && captionsShown(state.settings.captionMode, m);

  return (
    <div className="vfeed" ref={dragEl} style={{ ['--area' as string]: m ? AREA_COLOR[m.area] : '#fff' }}>
      {slots.current.slice(0, SLOTS).map((slot, s) => {
        const j = slot.index;
        const mm = queue.current[j];
        const offset = single ? 0 : j - idx;
        const isCur = offset === 0;
        return (
          <div key={s} ref={(el) => (slot.el = el)} className={`vslot ${Math.abs(offset) <= 1 ? 'vslot-anim' : ''}`} style={{ ['--off' as string]: offset }} aria-hidden={!isCur}>
            <div className="vframe">
              <div ref={(el) => (slot.host = el)} />
            </div>
            {mm && !mm.audio && <img className="vposter" src={thumbOf(mm)} alt="" draggable={false} />}
            {mm?.audio && (
              <div className="vaudio">
                <img className="vaudio-bg" src={thumbOf(mm)} alt="" draggable={false} />
                <img className="vaudio-art" src={thumbOf(mm)} alt="" draggable={false} />
              </div>
            )}
            {isCur && paused && !forYou && (
              <svg className="vplay" width="72" height="72" viewBox="0 0 24 24" fill="#fff" aria-label="Pausiert">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </div>
        );
      })}

      <div className="vtrack" />
      <div className="vprogress" style={{ transform: `scaleX(${progress})` }} />
      {loading && !forYou && <div className="vloading" aria-label="Loading" />}

      <div
        className="vgesture no-callout"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          if (g.current.fired) endFast();
          g.current.fired = false;
          g.current.t = 0;
          setDrag(0);
          window.clearTimeout(g.current.long);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />

      {hint && !forYou && (
        <div className="vhint pointer-events-none">
          <span>Tap for sound</span>
        </div>
      )}

      {captionsOn && caption && !forYou && (
        <div className={`vcaption pointer-events-none ${m?.audio ? 'vcaption-audio' : ''} ${isArabic(caption) ? 'vcaption-rtl' : ''}`} data-testid="caption">
          <span dir={isArabic(caption) ? 'rtl' : 'ltr'} lang={isArabic(caption) ? 'ar' : 'en'}>{caption}</span>
        </div>
      )}

      {m && !forYou && (
        <div className="vinfo pointer-events-none">
          <div className="vchannel">
            <span className="vdot" aria-hidden="true" />
            <span style={{ color: AREA_COLOR[m.area] }}>{AREA_LABEL[m.area]}</span>
            <span className="vspeaker">{speakerLine(m.channel)}</span>
          </div>
          <div className="vtitle">{m.hook}</div>
        </div>
      )}

      {!forYou && (
        <div className="vactions">
          <ActionButton label={saved ? 'Saved' : 'Save'} onClick={toggleSave} active={saved}>
            <path d="M7 4h10v16l-5-4-5 4z" />
          </ActionButton>
          <ActionButton label="More like this" onClick={() => feedback('mehr')}>
            <path d="M12 5v14M5 12h14" />
          </ActionButton>
          <ActionButton label={m?.audio ? 'Full episode' : 'Full video'} onClick={openFull}>
            <path d="M7 17 17 7M9 7h8v8" />
          </ActionButton>
          <ActionButton label="More" onClick={() => setMenu(true)}>
            <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3.2" />
          </ActionButton>
        </div>
      )}

      {forYou && (
        <div
          className="foryou no-callout"
          data-testid="foryou"
          onPointerUp={() => goTo(idxRef.current + 1)}
          style={{ ['--area' as string]: AREA_COLOR[forYou.area] }}
        >
          <div className="foryou-label">FOR YOU</div>
          <p className="foryou-text">{forYou.forYou}</p>
          <div className="foryou-foot">
            <span>Tap to continue</span>
            <span>6 s</span>
          </div>
        </div>
      )}

      {fast && (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+16px)] z-30 flex justify-center">
          <span className="rounded-full bg-black/70 px-3 py-1 text-[14px] font-semibold text-white">2x</span>
        </div>
      )}

      {flash && (
        <div className="flash pointer-events-none absolute inset-x-0 bottom-40 z-30 flex justify-center">
          <span className="rounded-full bg-black/80 px-4 py-2 text-[15px] text-white">{flash}</span>
        </div>
      )}

      {menu && m && (
        <div className="absolute inset-0 z-40 flex items-end bg-black/60" onClick={(e) => e.target === e.currentTarget && setMenu(false)}>
          <div className="w-full rounded-t-2xl bg-[#121212] px-4 pt-2 text-white" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#3A3D45]" aria-hidden="true" />
            <div className="mb-2 flex items-center gap-2 text-[13px] leading-[18px] text-[#B3B3B3]">
              <span className="h-2 w-2 rounded-full" style={{ background: AREA_COLOR[m.area] }} aria-hidden="true" />
              {speakerLine(m.channel)}
            </div>
            {(
              [
                ['More like this', () => feedback('mehr')],
                ['Already know this', () => feedback('kenne')],
                ['Weak', () => feedback('schwach')],
                ['Wrong', () => feedback('falsch')],
                [m.audio ? 'Open full episode' : 'Open full video', openFull],
                ['Mute this channel', muteChannel],
              ] as [string, () => void][]
            ).map(([label, fn]) => (
              <button key={label} onClick={fn} className="block h-[52px] w-full border-b border-[#262931] text-left text-[17px]">
                {label}
              </button>
            ))}
            <label className="flex h-[52px] items-center justify-between text-[17px]">
              <span>Captions</span>
              <input
                type="checkbox"
                checked={captionsOn}
                disabled={!m.cues?.length}
                onChange={() => update((s) => ({ ...s, settings: { ...s.settings, captionMode: captionsOn ? 'off' : 'on' } }))}
                className="h-[22px] w-[22px] accent-white"
              />
            </label>
            <button onClick={() => setMenu(false)} className="mt-2 h-[52px] w-full rounded-xl bg-[#1E2026] text-[17px] font-semibold">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button aria-label={label} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={onClick} className="flex min-h-[44px] flex-col items-center gap-1 text-white">
      <svg width="28" height="28" viewBox="0 0 24 24" fill={active ? '#fff' : 'none'} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' }}>
        {children}
      </svg>
      <span className="vlabel">{label}</span>
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="pad flex h-[100dvh] items-center bg-black text-[17px] leading-[25px] text-[#B3B3B3]">{text}</div>;
}

/** "Sigma Nutrition (Prof. Grant Tinsley)" wird zu "Sigma Nutrition · Prof. Grant Tinsley" */
function speakerLine(channel: string) {
  const m = channel.match(/^(.*?)\s*\((.+)\)$/);
  return m ? `${m[1]} · ${m[2]}` : channel;
}
