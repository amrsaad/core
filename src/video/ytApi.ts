// YouTube IFrame Player API, Einbettung über youtube-nocookie.com. Kein API-Key.
import { isYtId } from '../moments/contract';
import { formOf } from '../moments/form';
import { localKey } from '../moments/localKey';
import { audioRunning, breakLevel, chainFor, hostState, levelWanted, markHost, onContextState, onUnlock, tempoNow, type Chain } from '../moments/audioGraph';
import { clampGain, laneFor, youtubeVolume, type LoudInfo } from '../moments/loudness';
import { AudioDeck, type DeckClip, type DeckSink } from './audioDeck';
import { isSilent, reduceSound, SOUND_NONE, type SoundObs } from '../moments/soundHint';
import { installGestures, onGesture } from '../moments/gesture';

/** gainDb: Anpassung der Lautheit des Moments in dB (Entscheidung 16), fehlt sie, bleibt der Moment unverändert */
export type YTLoad = string | { videoId: string; startSeconds?: number; endSeconds?: number; gainDb?: number };

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
  /** Nur YouTube: Lautstärke 0 bis 100 */
  setVolume?(volume: number): void;
  destroy(): void;
  /** Lautheit, die auf dem laufenden Moment wirklich angewendet ist (Diagnose, Tests) */
  loud?(): LoudInfo;
  /** Ton und Wiedergabe des Elements, das gerade spielt (Hinweis "Ton aus": nur aus diesem Zustand, nie aus einem Berührungs-Flag) */
  sound?(): SoundObs;
  /** Nur Stream-Player: Der angehaltene Moment hat schon Daten für das erste Bild (readyState 3 oder höher) */
  isBuffered?(): boolean;
  /** Nur Stream-Player: Der Moment kommt aus dem Offline-Vorrat (Blob-URL) */
  isLocal?(): boolean;
  /** Nur Stream-Player: Läuft der Moment unverändert, weil es noch keinen Web-Audio-Kontext gab, jetzt an die geregelte Spur hängen (erste Berührung) */
  relevel?(): void;
  /** YouTube-Player: an eine Stelle springen */
  seekTo?(seconds: number, allowSeekAhead?: boolean): void;
  /**
   * Nach einem Netzfehler an derselben Stelle weiter (Issue 9): Stream neu laden und bei pos ansetzen, YouTube springen und spielen.
   * Moment, Ton und Tempo bleiben, der Slot wird nicht neu gebaut. play false: nur bereitstellen (Vorlade-Slot).
   */
  recoverAt?(pos: number, play: boolean): void;
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
/** Momente der Audio-Form laufen auf dem dauerhaften <audio>-Element des audioDeck: iOS Safari spielt es bei gesperrtem Bildschirm weiter (Entscheidung 13, Issue 11) */
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
 * Das Audio-Element des Audio-Reiters (Issue 11, Entscheidung 13). Es überlebt Reiterwechsel und wird nie ersetzt.
 * Mit Lautheit (Entscheidung 16) gibt es dazu höchstens ein zweites, fest stehendes für die geregelte Spur. Beide werden per Geste
 * freigeschaltet, der Wechsel zwischen ihnen geschieht wie jeder Quellwechsel synchron im Ereignis-Handler.
 */
export const audioDeck: AudioDeck = new AudioDeck({
  local: (key) => LOCAL.get(key),
  dropLocal: (key) => {
    LOCAL.delete(key);
  },
  lane: (clip, local, forcePlain) =>
    laneFor({ enabled: levelWanted(), rate: tempoNow(), running: audioRunning(), gainDb: clampGain(clip.gain), local, url: clip.url, host: local ? undefined : hostState(clip.url), forcePlain }),
  chain: (el, gainDb) => {
    const c = chainFor(el as unknown as HTMLMediaElement);
    if (!c) return null;
    c.setDb(clampGain(gainDb));
    return { linear: () => c.linear() };
  },
  host: (url, state) => markHost(url, state),
  running: audioRunning,
  broken: breakLevel,
  playbackState: (st, why) => setMediaState(st, why),
});

/** Media Session des Betriebssystems setzen. Im Hintergrund steht jede Änderung im Protokoll (Hintergrund-Diagnose, Frage 2). */
let msLast = '';
export function setMediaState(st: 'playing' | 'paused', why: string): void {
  try {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (navigator.mediaSession.playbackState !== st) navigator.mediaSession.playbackState = st;
    const line = `bg: ms playbackState ${st} (${why})`;
    if (line !== msLast && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      msLast = line;
      audioDeck.diag(line);
    }
  } catch {
    /* Media Session nicht verfügbar */
  }
}
if (typeof window !== 'undefined') {
  // Jede erste Geste im Dokument (auch auf den Reitern) schaltet das Deck-Element frei, nicht nur ein Tipp im Feed
  installGestures();
  onGesture(() => audioDeck.unlock());
  onUnlock(() => levelWanted() && audioDeck.prime());
  // iOS unterbricht den Kontext (Sperrbildschirm, Anruf): läuft er nicht mehr, spielt der Audio-Reiter unverändert weiter
  onContextState((s) => audioDeck.contextChanged(s));
  // Issue 13: jeder Seitenwechsel mit Zustand des Audio-Elements und der Media Session im Protokoll (Zeilen "bg: deck page ...")
  document.addEventListener('visibilitychange', () => audioDeck.pageEvent(document.visibilityState));
  window.addEventListener('pagehide', (e) => audioDeck.pageEvent(`pagehide persisted=${e.persisted}`));
  window.addEventListener('pageshow', (e) => audioDeck.pageEvent(`pageshow persisted=${e.persisted}`));
}

/** Ausschnitt eines Audio-Moments für das Element, null wenn der Moment nicht über das Audio-Element läuft */
export const deckClipOf = (m: { videoId: string; start: number; end: number; gainDb?: number }): DeckClip | null => {
  const url = HLS.get(m.videoId);
  return url && AUDIO_ONLY.has(m.videoId) ? { key: localKey(m.videoId, m.start, m.end), id: m.videoId, url, start: m.start, end: m.end, gain: clampGain(m.gainDb) } : null;
};

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
    setVolume() {}
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

/** Eine Sekunde Stille als WAV. Entsperrt die geregelten Elemente in der ersten Berührung (iOS erlaubt Ton nur für Elemente, die eine Geste gestartet hat). */
let silentUrl: string | null = null;
function silentWav(): string {
  if (silentUrl) return silentUrl;
  const n = 8000;
  const b = new Uint8Array(44 + n);
  const v = new DataView(b.buffer);
  const tag = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  tag(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  tag(36, 'data');
  v.setUint32(40, n, true);
  b.fill(128, 44);
  silentUrl = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  return silentUrl;
}

/**
 * Ein Player pro Slot, der je nach Moment YouTube (IFrame), einen HLS-Stream (<video>, iOS spielt HLS nativ) oder das gemeinsame
 * Audio-Element des Audio-Reiters (audioDeck) nutzt. Nach außen dieselbe Schnittstelle wie der YouTube-Player, damit Feed und Modal unverändert bleiben.
 * Audio-Momente haben hier kein eigenes Element: cueVideoById merkt sich nur den Ausschnitt, erst loadVideoById oder playVideo
 * übernimmt das gemeinsame Element (src und play, synchron).
 *
 * Lautheit (Entscheidung 16): Für Streams mit Bild gibt es zwei Elemente. Die unveränderte Spur (video) spielt wie bisher.
 * Die geregelte Spur (videoL) hängt über Web Audio an einem GainNode mit Begrenzer. Welche Spur ein Moment bekommt,
 * entscheidet laneFor (loudness.ts). Jeder Fehler der geregelten Spur führt zurück auf die unveränderte, nie zu Stille.
 * Für Audio-Momente gilt dasselbe im audioDeck.
 */
export function createPlayer(YT: YTNamespace, el: HTMLElement, videoId: string, events: { onReady?: () => void; onState?: (s: number) => void; onError?: (code: number) => void; onDiag?: (line: string) => void; /** Tempo, das ein neu gestarteter Moment sofort bekommt */ getRate?: () => number; /** Ton oder Wiedergabe des Elements hat sich geändert */ onSound?: () => void; /** Messung am Element, das Ton ausgibt (Untertitel, Issue 15): Quellzeit, Tempo, Ton läuft */ onTime?: (t: number, rate: number, playing: boolean) => void }): YTPlayer {
  const host = el.parentElement!;
  host.style.position = 'relative';
  const mkVideo = (level: boolean) => {
    const video = document.createElement('video');
    // iOS entscheidet über Autoplay an den Attributen, die vor dem Setzen von src stehen: muted und playsinline als Attribut, nicht nur als Eigenschaft
    video.setAttribute('muted', '');
    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.preservesPitch = true;
    (video as unknown as { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    // Nur die geregelte Spur fordert CORS an, sonst gäbe Web Audio für Quellen ohne Freigabe Stille aus
    if (level) video.crossOrigin = 'anonymous';
    Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'none', pointerEvents: 'none' });
    host.appendChild(video);
    return video;
  };
  const video = mkVideo(false);
  const videoL = mkVideo(true);
  const all = [video, videoL];
  const isLevel = (e: HTMLMediaElement) => e === videoL;
  /** Das Element des laufenden HLS-Moments. Die anderen sind angehalten. */
  let media: HTMLMediaElement = video;
  const hideNativeCaptions = (v: HTMLVideoElement) => () => {
    for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = 'disabled';
  };
  for (const v of [video, videoL]) {
    v.textTracks.addEventListener?.('addtrack', hideNativeCaptions(v));
    v.addEventListener('loadedmetadata', hideNativeCaptions(v));
  }

  let mode: 'yt' | 'hls' = HLS.has(videoId) ? 'hls' : 'yt';
  let hlsState: number = STATE.UNSTARTED;
  let endAt = Infinity;
  /** Tonzeit des ersten Bytes, wenn der Moment aus dem Vorrat kommt (sonst 0) */
  let offset = 0;
  let lastArgs: { id: string; start: number; end: number | undefined; play: boolean; gain: number; from: number } | null = null;
  let readyFired = false;
  /** Der laufende Moment ist ein Audio-Moment und gehört dem gemeinsamen Audio-Element */
  let deckMode = false;
  let deckClip: DeckClip | null = null;
  /** Ton gewünscht (mute und unMute), gilt für das Element, sobald dieser Player es besitzt */
  let wantMuted = true;
  /** Lautheit des laufenden Moments, je nach Weg (HLS-Stream oder YouTube) */
  let hlsLoud: LoudInfo = { db: 0, how: 'unchanged: no value' };
  let ytLoud: LoudInfo = { db: 0, how: 'unchanged: no value' };
  /** Quelle, die in der geregelten Spur nicht lud. Lädt sie danach unverändert, gilt der Host als ohne CORS. */
  let trialFailed: string | null = null;
  /** Ton und Wiedergabe des laufenden Stream-Elements (volumechange, playing, pause), YouTube liest den Hinweis aus dem Player */
  let hlsSnd: SoundObs = SOUND_NONE;
  const soundChanged = () => events.onSound?.();
  const setHlsState = (st: number) => {
    hlsState = st;
    if (mode === 'hls') events.onState?.(st);
  };
  const diag = (line: string) => events.onDiag?.(line);
  const sink: DeckSink = {
    state: (st) => setHlsState(st),
    error: () => {
      if (mode === 'hls') events.onError?.(-1);
    },
    sound: () => {
      if (mode === 'hls' && deckMode) soundChanged();
    },
    time: (t, rate, playing) => {
      if (mode === 'hls' && deckMode) events.onTime?.(t, rate, playing);
    },
  };
  const leaveDeck = () => {
    if (!deckMode) return;
    audioDeck.drop(sink);
    deckMode = false;
    deckClip = null;
  };
  for (const el of all) {
    // Ereignisse der gerade nicht benutzten Elemente zählen nicht, im Audio-Reiter gehört der Ton dem audioDeck
    const mine = () => !deckMode && el === media;
    // Messung für die Untertitel: Zeit des Elements, das Ton ausgibt (Video-Reiter: der Slot)
    const tick = () => {
      if (mine() && mode === 'hls') events.onTime?.(el.currentTime + offset, el.playbackRate || 1, !el.paused && el.readyState >= 3);
    };
    el.addEventListener('timeupdate', tick);
    el.addEventListener('playing', tick);
    el.addEventListener('waiting', tick);
    el.addEventListener('pause', tick);
    el.addEventListener('volumechange', () => {
      if (!mine()) return;
      hlsSnd = reduceSound(hlsSnd, 'volumechange', el);
      soundChanged();
    });
    el.addEventListener('playing', () => {
      if (!mine()) return;
      hlsSnd = reduceSound(hlsSnd, 'playing', el);
      setHlsState(STATE.PLAYING);
      soundChanged();
      // Web Audio läuft nicht (iOS hat den Kontext unterbrochen): die geregelte Spur wäre stumm, darum zurück auf die unveränderte
      if (isLevel(el)) window.setTimeout(() => mine() && !el.paused && !audioRunning() && (breakLevel('context not running'), bail('context not running')), 700);
    });
    el.addEventListener('pause', () => {
      if (!mine()) return;
      hlsSnd = reduceSound(hlsSnd, 'pause', el);
      setHlsState(el.ended ? STATE.ENDED : STATE.PAUSED);
      soundChanged();
    });
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
        prepareHls(a.id, a.start, a.end, a.play, a.gain, false, a.from);
        return;
      }
      // Geregelte Spur, Quelle aus dem Netz: meist fehlt die CORS-Freigabe. Dieser Moment läuft unverändert weiter, nie ein Überspringen.
      if (isLevel(el) && lastArgs) {
        const a = lastArgs;
        trialFailed = el.dataset.src ?? null;
        diag(`loud: level lane failed (code ${el.error?.code ?? '?'}), playing unchanged`);
        delete el.dataset.src;
        prepareHls(a.id, a.start, a.end, a.play, a.gain, true, a.from, 'skipped cors');
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
    for (const v of [video, videoL]) v.style.display = m === 'hls' && !deckMode && media === v ? 'block' : 'none';
    const f = iframe();
    if (f) f.style.visibility = m === 'yt' ? 'visible' : 'hidden';
  };

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
        if (name === 'NotAllowedError') {
          hlsSnd = reduceSound(hlsSnd, 'refused', media);
          soundChanged();
        }
        // Die geregelte Spur ist nie entsperrt worden: auf die unveränderte wechseln, die den bewährten Weg hat
        if (name === 'NotAllowedError' && isLevel(media) && lastArgs) bail('play refused');
        else if (name === 'NotAllowedError' && !media.muted) {
          media.muted = true;
          tryPlay('muted-retry');
        } else if (name !== 'AbortError') setHlsState(STATE.PAUSED);
      },
    );
  };

  /** Von der geregelten Spur zurück auf die unveränderte, an der aktuellen Stelle */
  const bail = (why: string) => {
    const a = lastArgs;
    if (!a || !isLevel(media) || mode !== 'hls') return;
    diag(`loud: level lane abandoned (${why}), playing unchanged`);
    const at = media.currentTime + offset;
    const running = !media.paused || a.play;
    delete media.dataset.src;
    prepareHls(a.id, a.start, a.end, running, a.gain, true, Math.max(a.start, at), why);
  };

  /** Quelle freigeben und load(), damit der Speicher frei wird. Nie src = '' (löst einen Fehler aus). */
  const releaseEl = (e: HTMLMediaElement) => {
    if (!e.getAttribute('src')) return;
    e.pause();
    e.removeAttribute('src');
    delete e.dataset.src;
    delete e.dataset.local;
    e.load();
  };
  /** Tempo nur auf ein Element mit Quelle schreiben und nur, wenn es abweicht. load() setzt es auf den Standard zurück, darum beides. */
  const applyRateTo = (e: HTMLMediaElement, rate = events.getRate?.() ?? 1) => {
    if (!e.getAttribute('src')) return;
    if (e.defaultPlaybackRate !== rate) e.defaultPlaybackRate = rate;
    if (e.playbackRate !== rate) e.playbackRate = rate;
  };

  const pending = new WeakMap<HTMLMediaElement, () => void>();

  const prepareHls = (id: string, start: number, end: number | undefined, play: boolean, gain: number, forcePlain = false, seekTo = start, forceWhy?: string) => {
    try { yt.pauseVideo(); } catch { /* noch nicht bereit */ }
    leaveDeck();
    const loc = LOCAL.get(localKey(id, start, end));
    const src = loc?.url ?? HLS.get(id)!;
    // Spurwahl: geregelte Spur nur, wenn Web Audio läuft und die Quelle sicher durchgelassen wird (laneFor)
    const pick = laneFor({ enabled: levelWanted(), rate: tempoNow(), running: audioRunning(), gainDb: gain, local: !!loc, url: src, host: loc ? undefined : hostState(src), forcePlain });
    let next = pick.lane === 'level' ? videoL : video;
    let chain: Chain | null = null;
    let why = forcePlain && forceWhy ? forceWhy : pick.why;
    if (pick.lane === 'level') {
      chain = chainFor(next);
      if (!chain) {
        next = video;
        why = 'no audio graph';
      } else chain.setDb(gain);
    }
    hlsLoud = chain ? { db: gain, how: 'web audio', linear: chain.linear() } : { db: 0, how: `unchanged: ${why}` };
    if (next !== media) {
      // Elementwechsel (Reiterwechsel oder Spurwechsel): das alte Element anhalten, Ton und Tempo übernehmen
      const old = media;
      media = next;
      old.pause();
      media.muted = old.muted;
      media.defaultPlaybackRate = old.defaultPlaybackRate;
      media.playbackRate = old.playbackRate;
      // Das alte Element gibt seine Quelle frei (Issue 13): höchstens ein Element mit Quelle je Slot, sonst halten drei Slots sechs Puffer
      pending.get(old)?.();
      pending.delete(old);
      delete old.dataset.src;
      old.removeAttribute('src');
      old.load();
      hlsSnd = { muted: isSilent(media), playing: false, refused: false };
    }
    show('hls');
    lastArgs = { id, start, end, play, gain, from: seekTo };
    offset = loc?.offset ?? 0;
    media.dataset.local = loc ? '1' : '0';
    endAt = (end ?? Infinity) - offset;
    const el = media;
    let sought = false;
    const seek = () => {
      if (!sought) {
        try {
          el.currentTime = Math.max(0, seekTo - offset);
          sought = el.readyState >= 1;
        } catch { /* iOS setzt erst nach loadedmetadata */ }
      }
    };
    const onMeta = () => {
      if (el !== media) return; // inzwischen auf das andere Element gewechselt
      diag(`hls loadedmetadata ${vstate()}`);
      // Die Quelle lud in der geregelten Spur: der Host erlaubt CORS. Lud sie erst nach einem Fehler dort unverändert: er erlaubt es nicht.
      if (!loc) {
        if (isLevel(el)) markHost(src, 'ok');
        else if (trialFailed === src) markHost(src, 'bad');
      }
      trialFailed = null;
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
    // Listener eines früheren, nie abgeschlossenen Ladens (Fehler, Rückfall) entfernen, sonst feuern sie beim nächsten Laden mit alten Argumenten
    pending.get(el)?.();
    pending.delete(el);
    if (el.dataset.src !== src) {
      el.dataset.src = src;
      el.addEventListener('loadedmetadata', onMeta, { once: true });
      el.addEventListener('canplay', onCanPlay, { once: true });
      pending.set(el, () => {
        el.removeEventListener('loadedmetadata', onMeta);
        el.removeEventListener('canplay', onCanPlay);
      });
      el.src = src;
      el.load();
      applyRateTo(el);
      diag(`hls load ${play ? 'play' : 'cue'} start=${start} lane=${isLevel(el) ? 'level' : 'plain'} ${vstate()}`);
    } else onMeta();
  };

  /** Audio-Moment: Ausschnitt merken. Mit play übernimmt dieser Player das gemeinsame Element, ohne play bleibt es unberührt. */
  const prepareDeck = (id: string, start: number, end: number | undefined, play: boolean, gain: number) => {
    try { yt.pauseVideo(); } catch { /* noch nicht bereit */ }
    for (const e of all) releaseEl(e);
    deckMode = true;
    show('hls');
    lastArgs = { id, start, end, play, gain, from: start };
    deckClip = { key: localKey(id, start, end), id, url: HLS.get(id)!, start, end, gain };
    if (play) deckLoad(true);
    else setHlsState(STATE.CUED);
  };
  const deckLoad = (play: boolean) => {
    if (!deckClip) return;
    // Das Tempo steht vor dem Start fest, das Element bekommt es mit der Quelle (nie danach per Neuladen)
    if (events.getRate) audioDeck.setRate(events.getRate());
    audioDeck.load(deckClip, sink, { play, muted: wantMuted });
  };
  const deckPlay = () => {
    if (!deckClip) return;
    // Läuft der Ausschnitt schon in diesem Element, geht es dort weiter. Sonst wird er geladen (Wisch auf einen vorgemerkten Moment).
    if (audioDeck.owns(sink) && audioDeck.holds(deckClip.key)) audioDeck.play(sink);
    else deckLoad(true);
  };

  /** YouTube kann nur absenken. Bei Anhebung bleibt es bei 100. */
  const applyYtVolume = (gain: number) => {
    ytLoud = gain < 0 ? { db: gain, how: 'youtube volume' } : { db: 0, how: gain > 0 ? 'unchanged: youtube cannot raise' : 'unchanged: no value' };
    try { yt.setVolume?.(youtubeVolume(gain)); } catch { /* Player noch nicht bereit */ }
  };

  const route = (arg: YTLoad, play: boolean) => {
    const id = typeof arg === 'string' ? arg : arg.videoId;
    const gain = typeof arg === 'string' ? 0 : clampGain(arg.gainDb);
    if (HLS.has(id)) {
      const o = typeof arg === 'string' ? { startSeconds: 0, endSeconds: undefined } : arg;
      if (AUDIO_ONLY.has(id)) prepareDeck(id, o.startSeconds ?? 0, o.endSeconds, play, gain);
      else prepareHls(id, o.startSeconds ?? 0, o.endSeconds, play, gain);
    } else if (!isYtId(id)) {
      // Kein Stream und keine YouTube-ID (Text-Moment oder Podcast ohne hls): nichts laden, nichts werfen
      for (const e of all) releaseEl(e);
      leaveDeck();
      try { yt.pauseVideo(); } catch { /* noch nicht bereit */ }
      show('yt');
    } else {
      for (const e of all) releaseEl(e);
      leaveDeck();
      show('yt');
      applyYtVolume(gain);
      // gainDb gehört nicht an die YouTube-API
      const yarg = typeof arg === 'string' ? arg : { videoId: arg.videoId, startSeconds: arg.startSeconds, endSeconds: arg.endSeconds };
      if (play) yt.loadVideoById(yarg);
      else yt.cueVideoById(yarg);
    }
  };

  // Erste Berührung: die geregelten Elemente einmal mit Stille starten, damit iOS ihnen später Ton erlaubt
  const prime = () => {
    for (const e of [videoL]) {
      if (e === media || e.dataset.primed || e.dataset.src) continue;
      e.dataset.primed = '1';
      try {
        e.muted = false;
        e.src = silentWav();
        const p = e.play();
        const done = () => {
          if (e === media || e.dataset.src) return;
          e.pause();
          e.removeAttribute('src');
        };
        p?.then(done, done);
      } catch { /* kein Entsperren nötig oder möglich */ }
    }
  };
  const offUnlock = onUnlock(prime);
  // iOS unterbricht den Kontext (Anruf, Sperrbildschirm): erst fortsetzen lassen, läuft er danach nicht, zurück auf die unveränderte Spur
  const offState = onContextState((s) => {
    if (s === 'running') return;
    window.setTimeout(() => {
      if (!deckMode && isLevel(media) && !media.paused && !audioRunning()) {
        breakLevel(`context ${s}`);
        bail(`context ${s}`);
      }
    }, 1500);
  });

  // Die echte YouTube-API hat ihre Methoden erst nach onReady, vorher wirft getPlayerState (Seitenfehler im Keyrestore-E2E, 30.10.)
  const ytState = (): number => { try { return typeof yt.getPlayerState === 'function' ? yt.getPlayerState() : STATE.UNSTARTED; } catch { return STATE.UNSTARTED; } };
  return {
    loadVideoById: (arg) => route(arg, true),
    cueVideoById: (arg) => route(arg, false),
    playVideo: () => {
      if (mode !== 'hls') yt.playVideo();
      else if (deckMode) deckPlay();
      else tryPlay('playVideo');
    },
    pauseVideo: () => {
      if (mode !== 'hls') yt.pauseVideo();
      else if (deckMode) audioDeck.pause(sink);
      else media.pause();
    },
    mute: () => {
      for (const e of all) if (!e.muted) e.muted = true;
      wantMuted = true;
      audioDeck.setMuted(sink, true);
      yt.mute();
      soundChanged();
    },
    unMute: () => {
      for (const e of all) if (e.muted) e.muted = false;
      wantMuted = false;
      audioDeck.setMuted(sink, false);
      yt.unMute();
      soundChanged();
    },
    sound: () => {
      if (mode === 'yt') {
        let muted = true;
        try { muted = yt.isMuted(); } catch { /* Player noch nicht bereit */ }
        return { muted, playing: ytState() === STATE.PLAYING, refused: false };
      }
      if (deckMode) return audioDeck.sound(sink) ?? { muted: wantMuted, playing: false, refused: false };
      return hlsSnd;
    },
    isMuted: () => (mode === 'hls' ? (deckMode ? wantMuted : media.muted) : yt.isMuted()),
    getCurrentTime: () => (mode === 'hls' ? (deckMode ? audioDeck.time(sink) ?? deckClip?.start ?? 0 : media.currentTime + offset) : yt.getCurrentTime()),
    getDuration: () => (mode === 'hls' ? (deckMode ? audioDeck.duration(sink) ?? 0 : (media.duration || 0) + offset) : yt.getDuration()),
    isBuffered: () => mode === 'hls' && hlsState === STATE.CUED && (deckMode ? !!deckClip && LOCAL.has(deckClip.key) : media.readyState >= 3),
    isLocal: () => mode === 'hls' && (deckMode ? audioDeck.local(sink) : media.dataset.local === '1'),
    relevel: () => {
      if (mode !== 'hls') return;
      if (deckMode) {
        if (audioDeck.owns(sink)) audioDeck.relevel();
        return;
      }
      const a = lastArgs;
      if (!a || isLevel(media) || hlsLoud.how !== 'unchanged: no audio context') return;
      const loc = LOCAL.get(localKey(a.id, a.start, a.end));
      const src = loc?.url ?? HLS.get(a.id)!;
      const pick = laneFor({ enabled: levelWanted(), rate: tempoNow(), running: audioRunning(), gainDb: a.gain, local: !!loc, url: src, host: loc ? undefined : hostState(src) });
      if (pick.lane !== 'level') return;
      const at = media.currentTime + offset;
      if (a.end !== undefined && a.end - at < 4) return;
      diag(`loud: attaching running moment at ${at.toFixed(1)} s (${pick.why})`);
      prepareHls(a.id, a.start, a.end, !media.paused || a.play, a.gain, false, Math.max(a.start, at));
    },
    recoverAt: (pos, play) => {
      const a = lastArgs;
      if (mode === 'hls' && deckMode) {
        // Audio-Reiter: das gemeinsame Element macht dort weiter, wo der Ausschnitt steht (kein eigener Start bei pos, E2E deckt diesen Weg nicht ab)
        deckLoad(play);
      } else if (mode === 'hls' && a) {
        // Nach einem Netzfehler (Issue 9): Quelle neu setzen, ein Element mit Netzfehler lädt nur nach load() wieder. Ton (muted) und Tempo hängen am Element und bleiben.
        delete media.dataset.src;
        prepareHls(a.id, a.start, a.end, play, a.gain, false, Math.min(Math.max(pos, a.start), a.end ?? pos));
      } else if (mode === 'yt') {
        try {
          yt.seekTo?.(pos, true);
          if (play) yt.playVideo();
        } catch {
          /* noch nicht bereit */
        }
      }
    },
    getPlayerState: () => (mode === 'hls' ? hlsState : ytState()),
    loud: () => {
      if (mode !== 'hls') return ytLoud;
      if (deckMode) return audioDeck.loud(sink) ?? hlsLoud;
      const c = isLevel(media) ? chainFor(media) : null;
      return c ? { ...hlsLoud, db: c.db(), linear: c.linear() } : hlsLoud;
    },
    setPlaybackRate: (rate: number) => {
      // defaultPlaybackRate zuerst: load() setzt playbackRate darauf zurück, sonst startet jeder neue Moment mit 1x (Issue 13)
      // Nur schreiben, was abweicht: jeder Schreibzugriff löst ratechange aus, auf allen sechs Elementen pro Tempowechsel
      for (const e of all) {
        if (e.defaultPlaybackRate !== rate) e.defaultPlaybackRate = rate;
        if (e.playbackRate !== rate) e.playbackRate = rate;
      }
      audioDeck.setRate(rate);
      // Tempo ungleich 1x nie über Web Audio (Issue 13): ein laufender Ausschnitt wechselt an der Stelle auf die unveränderte Spur
      if (rate !== 1 && mode === 'hls' && isLevel(media)) bail('tempo');
      if (mode === 'hls') return;
      try {
        yt.setPlaybackRate(rate);
      } catch {
        /* noch nicht bereit */
      }
    },
    destroy: () => {
      offUnlock();
      offState();
      leaveDeck();
      for (const e of all) {
        e.pause();
        e.removeAttribute('src');
        e.load();
        e.remove();
      }
      yt.destroy();
    },
  };
}
