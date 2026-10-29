// YouTube IFrame Player API, Einbettung über youtube-nocookie.com. Kein API-Key.
import { isYtId } from '../moments/contract';

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
export const registerHls = (items: { videoId: string; hls?: string }[]) => {
  for (const m of items) if (m.hls) HLS.set(m.videoId, m.hls);
};

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
  const hideNativeCaptions = () => {
    for (let i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = 'disabled';
  };
  video.textTracks.addEventListener?.('addtrack', hideNativeCaptions);
  video.addEventListener('loadedmetadata', hideNativeCaptions);

  let mode: 'yt' | 'hls' = HLS.has(videoId) ? 'hls' : 'yt';
  let hlsState: number = STATE.UNSTARTED;
  let endAt = Infinity;
  let readyFired = false;
  const setHlsState = (st: number) => {
    hlsState = st;
    if (mode === 'hls') events.onState?.(st);
  };
  video.addEventListener('playing', () => setHlsState(STATE.PLAYING));
  video.addEventListener('pause', () => setHlsState(video.ended ? STATE.ENDED : STATE.PAUSED));
  video.addEventListener('waiting', () => setHlsState(STATE.BUFFERING));
  video.addEventListener('ended', () => setHlsState(STATE.ENDED));
  video.addEventListener('timeupdate', () => {
    if (mode === 'hls' && video.currentTime >= endAt && !video.paused) {
      video.pause();
      setHlsState(STATE.ENDED);
    }
  });
  video.addEventListener('error', () => {
    if (mode === 'hls') events.onError?.(-1);
  });

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
    video.style.display = m === 'hls' ? 'block' : 'none';
    const f = iframe();
    if (f) f.style.visibility = m === 'yt' ? 'visible' : 'hidden';
  };

  const diag = (line: string) => events.onDiag?.(line);
  const vstate = () => `rs=${video.readyState} ns=${video.networkState} muted=${video.muted} t=${video.currentTime.toFixed(1)}${video.error ? ` err=${video.error.code}` : ''}`;
  let attemptNo = 0;
  // Ein Startversuch mit Ergebnis im Protokoll. Verweigert der Browser den Ton (NotAllowedError), läuft das Bild stumm weiter, statt zu stehen.
  const tryPlay = (why: string) => {
    const n = ++attemptNo;
    diag(`hls play#${n} ${why} ${vstate()}`);
    let p: Promise<void> | undefined;
    try {
      p = video.play();
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
        if (name === 'NotAllowedError' && !video.muted) {
          video.muted = true;
          tryPlay('muted-retry');
        } else if (name !== 'AbortError') setHlsState(STATE.PAUSED);
      },
    );
  };

  const prepareHls = (id: string, start: number, end: number | undefined, play: boolean) => {
    try { yt.pauseVideo(); } catch { /* noch nicht bereit */ }
    show('hls');
    endAt = end ?? Infinity;
    const src = HLS.get(id)!;
    let sought = false;
    const seek = () => {
      if (!sought) {
        try {
          video.currentTime = start;
          sought = video.readyState >= 1;
        } catch { /* iOS setzt erst nach loadedmetadata */ }
      }
    };
    const onMeta = () => {
      diag(`hls loadedmetadata ${vstate()}`);
      seek();
      if (play) tryPlay('loadedmetadata');
      else setHlsState(STATE.CUED);
    };
    // Zweiter Anstoß, wenn Daten da sind und das erste play() nichts bewirkt hat (iOS verwirft play() vor den Metadaten manchmal still)
    const onCanPlay = () => {
      diag(`hls canplay ${vstate()}`);
      seek();
      if (play && video.paused && hlsState !== STATE.PAUSED) tryPlay('canplay');
    };
    if (video.dataset.src !== src) {
      video.dataset.src = src;
      video.addEventListener('loadedmetadata', onMeta, { once: true });
      video.addEventListener('canplay', onCanPlay, { once: true });
      video.src = src;
      video.load();
      diag(`hls load ${play ? 'play' : 'cue'} start=${start} ${vstate()}`);
    } else {
      onMeta();
    }
  };

  const route = (arg: YTLoad, play: boolean) => {
    const id = typeof arg === 'string' ? arg : arg.videoId;
    if (HLS.has(id)) {
      const o = typeof arg === 'string' ? { startSeconds: 0, endSeconds: undefined } : arg;
      prepareHls(id, o.startSeconds ?? 0, o.endSeconds, play);
    } else if (!isYtId(id)) {
      // Kein Stream und keine YouTube-ID (Text-Moment oder Podcast ohne hls): nichts laden, nichts werfen
      video.pause();
      try { yt.pauseVideo(); } catch { /* noch nicht bereit */ }
      show('yt');
    } else {
      video.pause();
      show('yt');
      if (play) yt.loadVideoById(arg);
      else yt.cueVideoById(arg);
    }
  };

  return {
    loadVideoById: (arg) => route(arg, true),
    cueVideoById: (arg) => route(arg, false),
    playVideo: () => (mode === 'hls' ? tryPlay('playVideo') : yt.playVideo()),
    pauseVideo: () => (mode === 'hls' ? video.pause() : yt.pauseVideo()),
    mute: () => {
      video.muted = true;
      yt.mute();
    },
    unMute: () => {
      video.muted = false;
      yt.unMute();
    },
    isMuted: () => (mode === 'hls' ? video.muted : yt.isMuted()),
    getCurrentTime: () => (mode === 'hls' ? video.currentTime : yt.getCurrentTime()),
    getDuration: () => (mode === 'hls' ? video.duration || 0 : yt.getDuration()),
    getPlayerState: () => (mode === 'hls' ? hlsState : yt.getPlayerState()),
    setPlaybackRate: (rate: number) => {
      video.playbackRate = rate;
      try {
        yt.setPlaybackRate(rate);
      } catch {
        /* noch nicht bereit */
      }
    },
    destroy: () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      yt.destroy();
    },
  };
}
