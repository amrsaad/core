// YouTube IFrame Player API, Einbettung über youtube-nocookie.com. Kein API-Key.
import { isYtId } from '../moments/contract';
import { formOf } from '../moments/form';

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
export function createPlayer(YT: YTNamespace, el: HTMLElement, videoId: string, events: { onReady?: () => void; onState?: (s: number) => void; onError?: (code: number) => void }): YTPlayer {
  const host = el.parentElement!;
  host.style.position = 'relative';
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'none', pointerEvents: 'none' });
  host.appendChild(video);
  // Audio-Form: eigenes <audio>-Element ohne Bild. Das Bild des Moments zeigt die Seite selbst (vaudio).
  const audio = document.createElement('audio');
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
      if (mine() && mode === 'hls') events.onError?.(-1);
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
    endAt = end ?? Infinity;
    const src = HLS.get(id)!;
    const el = media;
    const seek = () => {
      if (el !== media) return; // inzwischen auf das andere Element gewechselt
      try { el.currentTime = start; } catch { /* iOS setzt erst nach loadedmetadata */ }
      if (play) void el.play().catch(() => setHlsState(STATE.PAUSED));
      else setHlsState(STATE.CUED);
    };
    if (el.dataset.src !== src) {
      el.dataset.src = src;
      el.src = src;
      el.addEventListener('loadedmetadata', seek, { once: true });
      el.load();
    } else seek();
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
    playVideo: () => (mode === 'hls' ? void media.play().catch(() => setHlsState(STATE.PAUSED)) : yt.playVideo()),
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
    getCurrentTime: () => (mode === 'hls' ? media.currentTime : yt.getCurrentTime()),
    getDuration: () => (mode === 'hls' ? media.duration || 0 : yt.getDuration()),
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
