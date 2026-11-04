import { Icon } from './Icon';

export interface ClipData {
  form: 'video' | 'audio' | 'text';
  hook: string;
  channel: string;
  episode?: string;
  /** Caption oder Passage (Text), eine Zeile je Absatz */
  context?: string;
  dir?: 'ltr' | 'rtl';
  /** Link zur Folge beim Original-Host */
  episodeUrl?: string;
}

/**
 * Clip-Seite (Brief 06, Board "Clip-Seite"): nur Darstellung für clip.html aus Brief 05. Hook, Kanal, Folge, Medienfläche (Slot), Caption oder Passage, Link zur Folge.
 * Der Aufrufer legt das Medium (IFrame, Audio) in den Slot. Ohne Login, ohne Pool-Daten. RTL bei dir "rtl".
 */
export function ClipView({ clip, media, onPlay }: { clip: ClipData; media?: React.ReactNode; onPlay?: () => void }) {
  const rtl = clip.dir === 'rtl';
  return (
    <main className="clip" dir={clip.dir ?? 'ltr'} data-testid="clip-view" data-form={clip.form}>
      <div className="clip-col">
        <p className="clip-kicker">
          {clip.channel}
          {clip.episode ? ` · ${clip.episode}` : ''}
        </p>
        <h1 className="clip-hook">{clip.hook}</h1>
        {clip.form !== 'text' && (
          <div className="clip-media">
            {media ?? (
              <button type="button" className="clip-play" onClick={onPlay} aria-label="Play" disabled={!onPlay}>
                <Icon name="play" size="var(--s-8)" />
              </button>
            )}
          </div>
        )}
        {clip.context && (
          <div className={clip.form === 'text' ? 'clip-passage' : 'clip-caption'} lang={rtl ? 'ar' : undefined}>
            {clip.context.split('\n').map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        )}
        {clip.episodeUrl && (
          <a className="clip-link" href={clip.episodeUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="arrow-square-out" />
            Open the original
          </a>
        )}
      </div>
    </main>
  );
}
