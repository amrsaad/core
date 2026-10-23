import { useCallback, useEffect, useRef, useState } from 'react';
import type { Video } from '../videoTypes';
import { dayKey, now as clockNow } from '../lib/clock';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import type { AppState } from '../lib/state';
import { adjustChannel, CHANNEL_FEEDBACK, newCursor, nextBlock, type MixCursor } from './mix';
import { createPlayer, loadYT, STATE, type YTPlayer } from './ytApi';

interface Props {
  pool: Video[];
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  active: boolean;
  onPausedChange: (paused: boolean) => void;
}

interface Slot {
  host: HTMLDivElement | null;
  player: YTPlayer | null;
  ready: boolean;
  index: number;
  /** zuletzt gemeldeter Player-Zustand */
  st: number;
  /** Video-ID, die gerade im Player steckt */
  vid: string;
}

const SKIP_MS = 3000;
const END_GUARD = 0.4;
const LIMIT_MS = 30 * 60_000;
const POLL_MS = 200;
const SWIPE_PX = 60;
const TAP_MS = 260;
const LONG_MS = 520;

export function VideoFeed({ pool, state, update, active, onPausedChange }: Props) {
  const single = state.settings.playerMode === 'single';
  const SLOTS = single ? 1 : 3;
  const stateRef = useRef(state);
  stateRef.current = state;

  const queue = useRef<Video[]>([]);
  const cursor = useRef<MixCursor | null>(null);
  const idxRef = useRef(0);
  const slots = useRef<Slot[]>(Array.from({ length: 3 }, () => ({ host: null, player: null, ready: false, index: -1, st: STATE.UNSTARTED, vid: '' })));
  const soundOn = useRef(false);
  const userPaused = useRef(false);
  const since = useRef(Date.now());
  const endedAt = useRef(-1);
  const feedMs = useRef(0);
  const dragEl = useRef<HTMLDivElement>(null);
  /** Diagnose für Tests: Zustandswechsel und Fehlercodes des Players */
  const diag = useRef<string[]>([]);

  const [idx, setIdx] = useState(0);
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState(true);
  const [paused, setPaused] = useState(false);
  const [menu, setMenu] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [limit, setLimit] = useState<'none' | 'modal' | 'done'>('none');
  const [error, setError] = useState<string | null>(null);

  const today = dayKey(clockNow());

  const show = (t: string) => {
    setFlash(t);
    window.setTimeout(() => setFlash(null), 900);
  };

  /** Warteschlange blockweise auffüllen (Mix-Logik) */
  const ensureQueue = useCallback(
    (upTo: number) => {
      const s = stateRef.current;
      cursor.current ??= newCursor(s.videoDay !== today);
      while (queue.current.length < upTo) {
        const b = nextBlock(pool, { areaShares: s.settings.areaShares, channelWeights: s.channelWeights, mutedChannels: s.mutedChannels, videoSeen: s.videoSeen }, cursor.current, Date.now());
        if (!b || !b.videos.length) break;
        queue.current.push(...b.videos);
      }
    },
    [pool, today],
  );

  const slotFor = (j: number) => slots.current[single ? 0 : ((j % 3) + 3) % 3];
  const current = () => slotFor(idxRef.current);

  const applySound = (p: YTPlayer) => (soundOn.current ? p.unMute() : p.mute());

  /** Slot auf Queue-Index j setzen; play=true startet sofort (in der Geste aufgerufen zählt das als Nutzergeste) */
  const assign = useCallback((slot: Slot, j: number, play: boolean) => {
    const v = queue.current[j];
    slot.index = j;
    if (!v || !slot.player || !slot.ready) return;
    applySound(slot.player);
    if (slot.vid !== v.id) {
      slot.vid = v.id;
      slot.st = STATE.UNSTARTED;
      if (play) slot.player.loadVideoById(v.id);
      else slot.player.cueVideoById(v.id);
    } else if (play) slot.player.playVideo();
    else slot.player.pauseVideo();
  }, []);

  const markSeen = (v: Video | undefined) => {
    if (!v) return;
    update((s) => (s.videoSeen[v.id] ? { ...s, videoDay: today } : { ...s, videoDay: today, videoSeen: { ...s.videoSeen, [v.id]: Date.now() } }));
  };

  /** iOS kann unstummes Abspielen ohne Geste blockieren: dann stumm weiter und Hinweis zeigen */
  const soundGuard = (j: number) => {
    window.setTimeout(() => {
      const sl = slotFor(j);
      if (idxRef.current !== j || userPaused.current || !sl.player) return;
      if (sl.st !== STATE.PLAYING && soundOn.current) {
        sl.player.mute();
        sl.player.playVideo();
        soundOn.current = false;
        setHint(true);
      }
    }, 1500);
  };

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next === idxRef.current) return;
      ensureQueue(next + 4);
      if (next >= queue.current.length) return;
      const prev = idxRef.current;
      const prevVideo = queue.current[prev];
      if (next > prev && prevVideo && Date.now() - since.current < SKIP_MS) {
        update((s) => ({ ...s, channelWeights: adjustChannel(s.channelWeights, prevVideo.channelId, CHANNEL_FEEDBACK.skip) }));
      }
      current().player?.pauseVideo();
      idxRef.current = next;
      since.current = Date.now();
      endedAt.current = -1;
      userPaused.current = false;
      setPaused(false);
      setProgress(0);
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
          const j = s;
          const v = queue.current[single ? 0 : j];
          if (!slot.host || !v) continue;
          slot.index = single ? 0 : j;
          slot.vid = v.id;
          // YouTube ersetzt das Ziel-Element durch ein iframe: eigenes Kind-Element, das React nicht verwaltet
          const target = document.createElement('div');
          slot.host.replaceChildren(target);
          slot.player = createPlayer(YT, target, v.id, {
            onReady: () => {
              slot.ready = true;
              slot.player!.mute();
              if (slot.index === idxRef.current) {
                slot.player!.playVideo();
                markSeen(queue.current[slot.index]);
              }
              rerender();
            },
            onState: (st) => {
              diag.current.push(`slot${s} ${slot.vid} state ${st}`);
              slot.st = st;
              if (st === STATE.ENDED && slot.index === idxRef.current && endedAt.current !== idxRef.current) {
                endedAt.current = idxRef.current;
                goTo(idxRef.current + 1);
              }
              // Vorgeladene Slots nicht im Hintergrund laufen lassen
              if (st === STATE.PLAYING && slot.index !== idxRef.current) slot.player?.pauseVideo();
              rerender();
            },
            onError: (code) => {
              diag.current.push(`slot${s} ${slot.vid} error ${code}`);
              if (slot.index === idxRef.current) goTo(idxRef.current + 1);
            },
          });
        }
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      for (const s of slots.current) {
        s.player?.destroy();
        Object.assign(s, { player: null, ready: false, index: -1, st: STATE.UNSTARTED, vid: '' });
      }
    };
    // Player nur einmal je Modus anlegen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, pool.length > 0]);

  // Endscreen-Schutz per Polling, Fortschritt, Feed-Zeit
  useEffect(() => {
    let flushed = 0;
    const t = window.setInterval(() => {
      const sl = current();
      const p = sl.player;
      if (!p || !sl.ready) return;
      const d = p.getDuration?.() ?? 0;
      const c = p.getCurrentTime?.() ?? 0;
      if (d > 1) {
        setProgress(Math.min(1, c / d));
        if (c >= d - END_GUARD && endedAt.current !== idxRef.current) {
          endedAt.current = idxRef.current;
          p.pauseVideo();
          goTo(idxRef.current + 1);
        }
      }
      if (sl.st === STATE.PLAYING && document.visibilityState === 'visible') {
        feedMs.current += POLL_MS;
        if (feedMs.current - flushed >= 10_000) {
          const add = feedMs.current - flushed;
          flushed = feedMs.current;
          update((s) => ({ ...s, feedTime: { ...s.feedTime, [today]: (s.feedTime[today] ?? 0) + add } }));
        }
        const total = (stateRef.current.feedTime[today] ?? 0) + feedMs.current - flushed;
        if (total >= LIMIT_MS && !stateRef.current.limitShown[today]) {
          p.pauseVideo();
          userPaused.current = true;
          setLimit('modal');
          update((s) => ({ ...s, limitShown: { ...s.limitShown, [today]: true } }));
        }
      }
    }, POLL_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTo, today]);

  // Tab gewechselt: anhalten
  useEffect(() => {
    if (!active) current().player?.pauseVideo();
    else if (!userPaused.current && limit === 'none') current().player?.playVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => onPausedChange(paused || limit !== 'none'), [paused, limit, onPausedChange]);

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
      // Erster Tipp: Ton für die ganze Sitzung an
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

  const save = () => {
    const v = queue.current[idxRef.current];
    if (!v) return;
    if (stateRef.current.savedVideos[v.id]) return show('Schon gespeichert');
    navigator.vibrate?.(15);
    update((s) => ({ ...s, savedVideos: { ...s.savedVideos, [v.id]: { video: v, savedAt: new Date().toISOString() } }, channelWeights: adjustChannel(s.channelWeights, v.channelId, CHANNEL_FEEDBACK.save) }));
    show('Gespeichert');
  };

  const weigh = (factor: number, label: string) => {
    const v = queue.current[idxRef.current];
    if (!v) return;
    update((s) => ({ ...s, channelWeights: adjustChannel(s.channelWeights, v.channelId, factor) }));
    setMenu(false);
    show(label);
  };

  const muteChannel = () => {
    const v = queue.current[idxRef.current];
    if (!v) return;
    update((s) => ({ ...s, mutedChannels: { ...s.mutedChannels, [v.channelId]: v.channelName } }));
    // Kommende Videos dieses Kanals aus der Warteschlange nehmen
    const keep = queue.current.slice(0, idxRef.current + 1);
    const rest = queue.current.slice(idxRef.current + 1).filter((x) => x.channelId !== v.channelId);
    queue.current = [...keep, ...rest];
    for (const s of slots.current) if (s.index > idxRef.current) s.index = -1;
    setMenu(false);
    show(`${v.channelName} stumm`);
    stateRef.current = { ...stateRef.current, mutedChannels: { ...stateRef.current.mutedChannels, [v.channelId]: v.channelName } };
    goTo(idxRef.current + 1);
  };

  const onDown = (e: React.PointerEvent) => {
    const r = g.current;
    Object.assign(r, { x: e.clientX, y: e.clientY, t: Date.now(), moved: false, fired: false, dy: 0 });
    window.clearTimeout(r.long);
    r.long = window.setTimeout(() => {
      r.fired = true;
      navigator.vibrate?.(10);
      setMenu(true);
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
    if (!wasDown || r.fired) return;
    if (r.moved) {
      setDrag(0);
      // Wischen: Wechsel direkt im pointerup-Handler (Nutzergeste für iOS)
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
      // Ton sofort in der Geste einschalten, nicht erst nach dem Doppeltipp-Fenster
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
    let wheelLock = 0;
    const wheel = (e: WheelEvent) => {
      if (!active || Date.now() < wheelLock || Math.abs(e.deltaY) < 30) return;
      wheelLock = Date.now() + 600;
      goTo(idxRef.current + (e.deltaY > 0 ? 1 : -1));
    };
    window.addEventListener('keydown', key);
    window.addEventListener('wheel', wheel, { passive: true });
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('wheel', wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, goTo]);

  // Test-Hook für Playwright: aktuellen Zustand lesen, ohne in den Cross-Origin-Player zu greifen
  useEffect(() => {
    (window as unknown as { __core?: unknown }).__core = {
      idx: () => idxRef.current,
      video: () => queue.current[idxRef.current]?.id,
      state: () => current().st,
      time: () => [current().player?.getCurrentTime?.() ?? 0, current().player?.getDuration?.() ?? 0],
      seek: (s: number) => (current().player as unknown as { seekTo?: (s: number, a: boolean) => void })?.seekTo?.(s, true),
      next: () => goTo(idxRef.current + 1),
      diag: () => diag.current.slice(-40),
    };
  });

  if (pool.length && !queue.current.length) ensureQueue(6);

  if (!pool.length) return <Empty text="Noch keine Videos im Pool. Der tägliche Lauf füllt ihn." />;
  if (error) return <Empty text={`${error}. Videos brauchen Internet.`} />;
  if (!queue.current.length) return <Empty text="Alle Videos gesehen. Neue kommen täglich um 03:00 UTC." />;

  const v = queue.current[idx];
  const saved = v && !!state.savedVideos[v.id];

  return (
    <div className="vfeed" ref={dragEl}>
      {slots.current.slice(0, SLOTS).map((slot, s) => {
        const j = slot.index;
        const vid = queue.current[j];
        const offset = single ? 0 : j - idx;
        const isCur = offset === 0;
        const showPoster = !isCur || slot.st !== STATE.PLAYING;
        return (
          <div key={s} className={`vslot ${Math.abs(offset) <= 1 ? 'vslot-anim' : ''}`} style={{ ['--off' as string]: offset }} aria-hidden={!isCur}>
            <div className="vframe">
              <div ref={(el) => (slot.host = el)} />
            </div>
            {vid && showPoster && <img className="vposter" src={vid.thumb} alt="" draggable={false} />}
            {isCur && paused && (
              <svg className="vplay" width="72" height="72" viewBox="0 0 24 24" fill="#fff" aria-label="Pausiert">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </div>
        );
      })}

      <div className="vprogress" style={{ transform: `scaleX(${progress})` }} />

      {/* Gesten-Ebene: der Player selbst bekommt keine Touches */}
      <div
        className="vgesture no-callout"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          g.current.t = 0;
          setDrag(0);
          window.clearTimeout(g.current.long);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />

      {hint && (
        <div className="vhint pointer-events-none">
          <span>Tippen für Ton</span>
        </div>
      )}

      {v && (
        <div className="vinfo pointer-events-none">
          <div className="vchannel">
            <span style={{ color: AREA_COLOR[v.area] }}>{AREA_LABEL[v.area]}</span>
            <span className="text-[#B3B3B3]"> · {v.channelName}</span>
          </div>
          <div className="vtitle">{v.title}</div>
        </div>
      )}

      <div className="vactions">
        <ActionButton label={saved ? 'Gespeichert' : 'Speichern'} onClick={save} active={saved}>
          <path d="M7 4h10v16l-5-4-5 4z" />
        </ActionButton>
        <ActionButton label="Mehr davon" onClick={() => weigh(CHANNEL_FEEDBACK.more, 'Mehr davon')}>
          <path d="M12 5v14M5 12h14" />
        </ActionButton>
        <ActionButton label="Weniger" onClick={() => weigh(CHANNEL_FEEDBACK.less, 'Weniger davon')}>
          <path d="M5 12h14" />
        </ActionButton>
      </div>

      {flash && (
        <div className="flash pointer-events-none absolute inset-x-0 bottom-40 z-30 flex justify-center">
          <span className="rounded-full bg-black/80 px-4 py-2 text-[15px] text-white">{flash}</span>
        </div>
      )}

      {menu && v && (
        <div className="absolute inset-0 z-40 flex items-end bg-black/60" onClick={(e) => e.target === e.currentTarget && setMenu(false)}>
          <div className="pad w-full rounded-t-2xl bg-[#121212] text-white">
            <div className="t-meta mb-2 text-[#B3B3B3]">{v.channelName}</div>
            {(
              [
                ['Mehr davon', () => weigh(CHANNEL_FEEDBACK.more, 'Mehr davon')],
                ['Weniger', () => weigh(CHANNEL_FEEDBACK.less, 'Weniger davon')],
                ['Kanal stummschalten', muteChannel],
                ['Abbrechen', () => setMenu(false)],
              ] as [string, () => void][]
            ).map(([label, fn]) => (
              <button key={label} onClick={fn} className="block w-full border-b border-[#2a2a2a] py-4 text-left text-[17px] last:border-0">
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {limit !== 'none' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black px-8 text-center text-white">
          <h2 className="t-headline m-0">{limit === 'modal' ? '30 Minuten heute' : 'Für heute fertig'}</h2>
          {limit === 'modal' ? (
            <div className="flex w-full max-w-xs gap-3">
              <button
                className="flex-1 rounded-xl border border-[#333] py-4 text-[17px] font-semibold"
                onClick={() => {
                  setLimit('none');
                  userPaused.current = false;
                  current().player?.playVideo();
                }}
              >
                Weiter
              </button>
              <button className="flex-1 rounded-xl bg-white py-4 text-[17px] font-semibold text-black" onClick={() => setLimit('done')}>
                Fertig
              </button>
            </div>
          ) : (
            <button
              className="t-meta text-[#B3B3B3]"
              onClick={() => {
                setLimit('none');
                userPaused.current = false;
                current().player?.playVideo();
              }}
            >
              Doch weiterschauen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onClick}
      className="flex flex-col items-center gap-1 text-white"
    >
      <svg width="30" height="30" viewBox="0 0 24 24" fill={active ? '#fff' : 'none'} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' }}>
        {children}
      </svg>
      <span className="vlabel">{label}</span>
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="pad flex h-[100dvh] items-center bg-black text-[17px] leading-[25px] text-[#B3B3B3]">{text}</div>;
}
