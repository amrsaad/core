// YouTube IFrame Player API, Einbettung über youtube-nocookie.com. Kein API-Key.

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

export function createPlayer(YT: YTNamespace, el: HTMLElement, videoId: string, events: { onReady?: () => void; onState?: (s: number) => void; onError?: (code: number) => void }): YTPlayer {
  return new YT.Player(el, {
    host: 'https://www.youtube-nocookie.com',
    videoId,
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
