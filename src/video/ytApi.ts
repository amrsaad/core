// YouTube IFrame Player API, Einbettung über youtube-nocookie.com. Kein API-Key.
import { isYtId } from '../moments/contract';
import { formOf } from '../moments/form';
import { localKey } from '../moments/localKey';

export type YTLoad = string | { videoId: string; startSeconds?: number; endSeconds?: number };

export interface YTPlayer {
  loadVideoById(arg: YTLoad): void;
  cueVideoById(arg: YTLoad): void;
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  destroy(): void;
  /** Nur Stream-Player: Der angehaltene Moment hat schon Daten für das erste Bild (readyState 3 oder höher) */
  isBuffered?(): boolean;
  /** Nur Stream-Player: Der Moment kommt aus dem Offline-Vorrat (Blob-URL) */
  isLocal?(): boolean;
}

interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: { ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

/** Vorgaben aus dem Auftrag, unverändert */
export const PLAYER_VARS = { playsinline: 1, controls: 0, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0, disablekb: 1, mute: 1, autoplay: 0, cc_load_policy: 0 };

let loading: Promise<YTNamespace> | null = null;

export function loadYT(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  loading ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('YouTube-Player nicht erreichbar'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Momente aus anderen Quellen (z.B. TED) mit eigenem HLS-Stream statt YouTube. Schlüssel ist videoId. */
export const HLS = new Map<string, string>();
export { isYtId } from '../moments/contract';
/** HLS-Momente der Audio-Form laufen auf einem <audio>-Element: iOS Safari spielt es bei gesperrtem Bildschirm weiter (Entscheidung 13) */
export const AUDIO_ONLY = new Set<string>();
export const registerHls = (items: { videoId: string; hls?: string; audio?: boolean; form?: 'video' | 'audio' | 'text' }[]) => {
  for (const m of items) {
    if (!m.hls) continue;
    HLS.set(m.videoId, m.hls);
    if (formOf(m) === 'audio') AUDIO_ONLY.add(m.videoId);
    else AUDIO_ONLY.delete(m.videoId);
  }
};

/**
 * Ausschnitte aus dem Offline-Vorrat (Blob-URL), Schlüssel localKey(videoId, start, end).
 * offset ist die Tonzeit des ersten Bytes der Quelle: Zeit im Ausschnitt = Zeit in der Quelle minus offset.
 */
export interface LocalSrc { url: string; offset: number }
export const LOCAL = new Map<string, LocalSrc>();

/**
 * Ersatz, wenn die YouTube-API nicht zu laden ist (offline, blockiert). Streams, Podcasts und Text laufen trotzdem,
 * YouTube-Momente tun nichts und werden im schlechten Netz ohnehin nach hinten gestellt.
 */
export function offlineYT(): YTNamespace {
  class Stub implements YTPlayer {
    constructor(_el: HTMLElement, opts: Record<string, unknown>) {
      const ev = (opts.events ?? {}) as { onReady?: () => void };
      setTimeout(() => ev.onReady?.(), 0);
    }
    loadVideoById() {}
    cueVideoById() {}
    playVideo() {}
    pauseVideo() {}
    mute() {}
    unMute() {}
    isMuted() { return true; }
    getCurrentTime() { return 0; }
    getDuration() { return 0; }
    getPlayerState() { return STATE.UNSTARTED; }
    setPlaybackRate() {}
    destroy() {}
  }
  return { Player: Stub, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
}

function ytPlayer(YT: YTNamespace, el: HTMLElement, videoId: string | undefined, events: { onReady?: () => void; onState?: (s: number) => void; onError?: (code: number) => void }): YTPlayer {
  return new YT.Player(el, {
    host: 'https://www.youtube-nocookie.com',
    ...(videoId ? { videoId } : {}),
    width: '100%',
    height: '100%',
    playerVars: { ...PLAYER_VARS, origin: location.origin, playlist: undefined },
    events: {
      onReady: () => events.onReady?.(),
      onStateChange: (e: { data: number }) => events.onState?.(e.data),
      onError: (e: { data: number }) => events.onError?.(e.data),
    },
  });
}

/**
 * Ein Player pro Slot, der je nach Moment YouTube (IFrame) oder einen HLS-Stream (<video>, iOS spielt HLS nativ) nutzt.
 * Nach außen dieselbe Schnittstelle wie der YouTube-Player, damit Feed und Modal unverändert bleiben.
 */
export function createPlayer(YT: YTNamespace, el: HTMLElement, videoId: string, events: { onReady?: () => void; onState?: (s: number) => void; onError?: (code: number) => void; onDiag?: (line: string) => void }): YTPlayer {
  const host = el.parentElement!;
  host.style.position = 'relative';
  const video = document.createElement('video');
  // iOS entscheidet über Autoplay an den Attributen, die vor dem Setzen von src stehen: muted und playsinline als Attribut, nicht nur als Eigenschaft
  video.setAttribute('muted', '');
  video.defaultMuted = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'none', pointerEvents: 'none' });
  host.appendChild(video);
  // Audio-Form: eigenes <audio>-Element ohne Bild. Das Bild des Moments zeigt die Seite selbst (vaudio).
  const audio = document.createElement('audio');
  audio.setAttribute('muted', '');
  audio.defaultMuted = true;
  audio.muted = true;
  audio.preload = 'auto';
  audio.style.display = 'none';
  host.appendChild(audio);
  /** Das Element des laufenden HLS-Moments. Das andere ist angehalten. */
  let media: HTMLMediaElement = video;
  const hideNativeCaptions = () => {
    for (let i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = 'disabled';
  };
  video.textTracks.addEventListener?.('addtrack', hideNativeCaptions);
  video.addEventListener('loadedmetadata', hideNativeCaptions);

  let mode: 'yt' | 'hls' = HLS.has(videoId) ? 'hls' : 'yt';
  let hlsState: number = STATE.UNSTARTED;
  let endAt = Infinity;
  /** Tonzeit des ersten Bytes, wenn der Moment aus dem Vorrat kommt (sonst 0) */
  let offset = 0;
  let lastArgs: { id: string; start: number; end: number | undefined; play: boolean } | null = null;
  let readyFired = false;
  const setHlsState = (st: number) => {
    hlsState = st;
    if (mode === 'hls') events.onState?.(st);
  };
  for (const el of [video, audio]) {
    // Ereignisse des gerade nicht benutzten Elements zählen nicht
    const mine = () => el === media;
    el.addEventListener('playing', () => mine() && setHlsState(STATE.PLAYING));
    el.addEventListener('pause', () => mine() && setHlsState(el.ended ? STATE.ENDED : STATE.PAUSED));
    el.addEventListener('waiting', () => mine() && setHlsState(STATE.BUFFERING));
    el.addEventListener('ended', () => mine() && setHlsState(STATE.ENDED));
    el.addEventListener('timeupdate', () => {
      if (mine() && mode === 'hls' && el.currentTime >= endAt && !el.paused) {
        el.pause();
        setHlsState(STATE.ENDED);
      }
    });
    el.addEventListener('error', () => {
      if (!mine() || mode !== 'hls') return;
      // Ausschnitt aus dem Vorrat nicht abspielbar: einmal vom Netz laden statt zu überspringen
      if (el.dataset.local === '1' && lastArgs) {
        const a = lastArgs;
        LOCAL.delete(localKey(a.id, a.start, a.end));
        delete el.dataset.src;
        prepareHls(a.id, a.start, a.end, a.play);
        return;
      }
      events.onError?.(-1);
    });
  }

  // Nur echte YouTube-IDs an den IFrame-Player. Text- und Podcast-IDs ohne Stream werfen sonst "Invalid video id".
  const yt = ytPlayer(YT, el, mode === 'yt' && isYtId(videoId) ? videoId : undefined, {
    onReady: () => {
      if (!readyFired) {
        readyFired = true;
        events.onReady?.();
      }
    },
    onState: (st) => {
      if (mode === 'yt') events.onState?.(st);
    },
    onError: (code) => {
      if (mode === 'yt') events.onError?.(code);
    },
  });
  const iframe = () => host.querySelector('iframe') as HTMLElement | null;
  const show = (m: 'yt' | 'hls') => {
    mode = m;
    video.style.display = m === 'hls' && media === video ? 'block' : 'none';
    const f = iframe();
    if (f) f.style.visibility = m === 'yt' ? 'visible' : 'hidden';
  };

  const diag = (line: string) => events.onDiag?.(line);
  const vstate = () => `rs=${media.readyState} ns=${media.networkState} muted=${media.muted} t=${media.currentTime.toFixed(1)}${media.error ? ` err=${media.error.code}` : ''}`;
  let attemptNo = 0;
  // Ein Startversuch mit Ergebnis im Protokoll. Verweigert der Browser den Ton (NotAllowedError), läuft das Bild stumm weiter, statt zu stehen.
  const tryPlay = (why: string) => {
    const n = ++attemptNo;
    diag(`hls play#${n} ${why} ${vstate()}`);
    let p: Promise<void> | undefined;
    try {
      p = media.play();
    } catch (e) {
      diag(`hls play#${n} threw ${e instanceof Error ? e.name : String(e)}`);
      setHlsState(STATE.PAUSED);
      return;
    }
    p?.then(
      () => diag(`hls play#${n} ok ${vstate()}`),
      (e: unknown) => {
        const name = e instanceof Error ? e.name : String(e);
        diag(`hls play#${n} refused ${name} ${vstate()}`);
        if (name === 'NotAllowedError' && !media.muted) {
          media.muted = true;
          tryPlay('muted-retry');
        } else if (name !== 'AbortError') setHlsState(STATE.PAUSED);
      },
    );
  };

  const prepareHls = (id: string, start: number, end: number | undefined, play: boolean) => {
    try { yt.pauseVideo(); } catch { /* noch nicht bereit */ }
    const next = AUDIO_ONLY.has(id) ? audio : video;
    if (next !== media) {
      // Elementwechsel (Reiterwechsel): das alte Element anhalten, Ton und Tempo übernehmen
      const old = media;
      media = next;
      old.pause();
      media.muted = old.muted;
      media.playbackRate = old.playbackRate;
    }
    show('hls');
    lastArgs = { id, start, end, play };
    const loc = LOCAL.get(localKey(id, start, end));
    offset = loc?.offset ?? 0;
    media.dataset.local = loc ? '1' : '0';
    endAt = (end ?? Infinity) - offset;
    const src = loc?.url ?? HLS.get(id)!;
    const el = media;
    let sought = false;
    const seek = () => {
      if (!sought) {
        try {
          el.currentTime = Math.max(0, start - offset);
          sought = el.readyState >= 1;
        } catch { /* iOS setzt erst nach loadedmetadata */ }
      }
    };
    const onMeta = () => {
      if (el !== media) return; // inzwischen auf das andere Element gewechselt
      diag(`hls loadedmetadata ${vstate()}`);
      seek();
      if (play) tryPlay('loadedmetadata');
      else setHlsState(STATE.CUED);
    };
    // Zweiter Anstoß, wenn Daten da sind und das erste play() nichts bewirkt hat (iOS verwirft play() vor den Metadaten manchmal still)
    const onCanPlay = () => {
      if (el !== media) return;
      diag(`hls canplay ${vstate()}`);
      seek();
      if (play && el.paused && hlsState !== STATE.PAUSED) tryPlay('canplay');
    };
    if (el.dataset.src !== src) {
      el.dataset.src = src;
      el.addEventListener('loadedmetadata', onMeta, { once: true });
      el.addEventListener('canplay', onCanPlay, { once: true });
      el.src = src;
      el.load();
      diag(`hls load ${play ? 'play' : 'cue'} start=${start} ${vstate()}`);
    } else onMeta();
  };

  const route = (arg: YTLoad, play: boolean) => {
    const id = typeof arg === 'string' ? arg : arg.videoId;
    if (HLS.has(id)) {
      const o = typeof arg === 'string' ? { startSeconds: 0, endSeconds: undefined } : arg;
      prepareHls(id, o.startSeconds ?? 0, o.endSeconds, play);
    } else if (!isYtId(id)) {
      // Kein Stream und keine YouTube-ID (Text-Moment oder Podcast ohne hls): nichts laden, nichts werfen
      video.pause();
      audio.pause();
      try { yt.pauseVideo(); } catch { /* noch nicht bereit */ }
      show('yt');
    } else {
      video.pause();
      audio.pause();
      show('yt');
      if (play) yt.loadVideoById(arg);
      else yt.cueVideoById(arg);
    }
  };

  return {
    loadVideoById: (arg) => route(arg, true),
    cueVideoById: (arg) => route(arg, false),
    playVideo: () => (mode === 'hls' ? tryPlay('playVideo') : yt.playVideo()),
    pauseVideo: () => (mode === 'hls' ? media.pause() : yt.pauseVideo()),
    mute: () => {
      video.muted = true;
      audio.muted = true;
      yt.mute();
    },
    unMute: () => {
      video.muted = false;
      audio.muted = false;
      yt.unMute();
    },
    isMuted: () => (mode === 'hls' ? media.muted : yt.isMuted()),
    getCurrentTime: () => (mode === 'hls' ? media.currentTime + offset : yt.getCurrentTime()),
    getDuration: () => (mode === 'hls' ? (media.duration || 0) + offset : yt.getDuration()),
    isBuffered: () => mode === 'hls' && hlsState === STATE.CUED && media.readyState >= 3,
    isLocal: () => mode === 'hls' && media.dataset.local === '1',
    getPlayerState: () => (mode === 'hls' ? hlsState : yt.getPlayerState()),
    setPlaybackRate: (rate: number) => {
      video.playbackRate = rate;
      audio.playbackRate = rate;
      try {
        yt.setPlaybackRate(rate);
      } catch {
        /* noch nicht bereit */
      }
    },
    destroy: () => {
      for (const el of [video, audio]) {
        el.pause();
        el.removeAttribute('src');
        el.load();
        el.remove();
      }
      yt.destroy();
    },
  };
}
