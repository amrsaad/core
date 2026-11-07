import { useEffect, useRef, useState } from 'react';
import { ClipView } from '../components/ClipView';
import { Icon } from '../components/Icon';
import { atTime } from '../moments/hook';
import { episodeUrlOf, isYtId, type ClipPayload } from '../share/link';

/**
 * Clip-Seite (Brief 05, Entscheidung 27): öffentlich, ohne Login, ohne Pool. Alles kommt aus dem Hash des Links.
 * Das Medium bleibt beim Original-Host: Audio und eigene Streams über <audio> oder <video> ab start, Stopp bei end;
 * YouTube über das IFrame mit start und end; Text als Passage. Spielt ein Host im Browser nicht, steht der Link zur Folge mit Zeitstempel.
 */
export function ClipPage({ clip }: { clip: ClipPayload | null }) {
  useEffect(() => {
    const html = document.documentElement;
    html.dir = clip?.dir ?? 'ltr';
    html.lang = clip?.lang ?? 'en';
    document.title = clip ? `${clip.hook} · ${clip.channel}` : 'Clip';
  }, [clip]);

  if (!clip) {
    return (
      <main className="clip" data-testid="clip-empty">
        <div className="clip-col">
          <p className="clip-kicker">Clip</p>
          <h1 className="clip-hook">This link is incomplete.</h1>
          <p className="clip-note">Ask the sender to share the moment again.</p>
        </div>
      </main>
    );
  }

  const episodeUrl = episodeUrlOf(clip);
  const view = { form: clip.form, hook: clip.hook, channel: clip.channel, episode: clip.episode, context: clip.context, dir: clip.dir, episodeUrl };
  if (clip.form === 'text') return <ClipView clip={view} />;
  if (clip.form === 'video' && isYtId(clip.src)) return <ClipView clip={view} media={<YouTubeClip id={clip.src} start={clip.start} end={clip.end} />} />;
  return <ClipView clip={view} media={<MediaClip kind={clip.form} src={clip.src} start={clip.start} end={clip.end} episodeUrl={episodeUrl} />} />;
}

/** YouTube-IFrame mit Start und Ende, ohne Verwandte, ohne Cookies. Der Start braucht einen Tipp (iOS). */
function YouTubeClip({ id, start, end }: { id: string; start: number; end: number }) {
  const q = new URLSearchParams({ start: String(start), end: String(end), rel: '0', playsinline: '1', modestbranding: '1' });
  return (
    <iframe
      data-testid="clip-youtube"
      src={`https://www.youtube-nocookie.com/embed/${id}?${q}`}
      title="Clip"
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

type Phase = 'idle' | 'playing' | 'paused' | 'done' | 'failed';

/**
 * Audio oder eigener Stream vom Original-Host. Play setzt currentTime auf start (vor den Metadaten als Startposition gemerkt, sonst als Sprung)
 * und hält bei end an. Lädt der Host im Browser nicht (CORS spielt für <audio> keine Rolle, Fehler kommen von Formaten wie HLS in Chromium),
 * zeigt die Fläche den Link zur Folge mit Zeitstempel.
 */
function MediaClip({ kind, src, start, end, episodeUrl }: { kind: 'audio' | 'video'; src: string; start: number; end: number; episodeUrl: string }) {
  const el = useRef<HTMLMediaElement | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [t, setT] = useState(start);

  useEffect(() => {
    const m = el.current;
    if (!m) return;
    const onTime = () => {
      setT(m.currentTime);
      if (m.currentTime >= end) {
        m.pause();
        setPhase('done');
      }
    };
    const onMeta = () => {
      // Sprung erst mit Metadaten, iOS ignoriert ihn sonst
      if (Math.abs(m.currentTime - start) > 0.5 && m.paused && phase === 'idle') m.currentTime = start;
    };
    const onErr = () => setPhase('failed');
    const onPause = () => setPhase((p) => (p === 'playing' ? 'paused' : p));
    m.addEventListener('timeupdate', onTime);
    m.addEventListener('loadedmetadata', onMeta);
    m.addEventListener('error', onErr);
    m.addEventListener('pause', onPause);
    return () => {
      m.removeEventListener('timeupdate', onTime);
      m.removeEventListener('loadedmetadata', onMeta);
      m.removeEventListener('error', onErr);
      m.removeEventListener('pause', onPause);
    };
  }, [start, end, phase]);

  const toggle = () => {
    const m = el.current;
    if (!m || phase === 'failed') return;
    if (phase === 'playing') {
      m.pause();
      return;
    }
    if (phase !== 'paused') m.currentTime = start;
    m.play()
      .then(() => setPhase('playing'))
      .catch(() => setPhase('failed'));
  };

  const media =
    kind === 'video' ? (
      <video ref={el as React.RefObject<HTMLVideoElement>} data-testid="clip-video" src={src} preload="metadata" playsInline data-start={start} data-end={end} />
    ) : (
      <audio ref={el as React.RefObject<HTMLAudioElement>} data-testid="clip-audio" src={src} preload="metadata" data-start={start} data-end={end} />
    );

  if (phase === 'failed') {
    return (
      <div className="clip-fail" data-testid="clip-fail">
        {media}
        <Icon name="warning" />
        <p>This source does not play here.</p>
        <a href={episodeUrl} target="_blank" rel="noopener noreferrer">
          Open at {atTime(start)}
        </a>
      </div>
    );
  }
  const icon = phase === 'playing' ? 'pause' : phase === 'done' ? 'arrow-clockwise' : 'play';
  return (
    <div className="clip-player" data-testid="clip-player" data-phase={phase}>
      {media}
      <button type="button" className="clip-play" data-testid="clip-play" onClick={toggle} aria-label={phase === 'playing' ? 'Pause' : 'Play'}>
        <Icon name={icon} size="var(--s-8)" />
      </button>
      <p className="clip-time" data-testid="clip-time">
        {atTime(Math.min(Math.max(t, start), end))} / {atTime(end)}
      </p>
    </div>
  );
}
