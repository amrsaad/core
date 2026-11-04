import { ShareSheet } from '../components/ShareSheet';
import { ClipView } from '../components/ClipView';

/**
 * Vorschau der Komponenten, die erst Brief 05 verdrahtet (Share-Blatt, Clip-Seite). Aufruf mit ?design=share, clip, clip-rtl oder clip-text.
 * Reine Darstellung mit festen Beispieltexten, keine Daten, kein Schlüssel. Das Layout-Gate (Entscheidung 43) prüft diese Seiten.
 */
const LONG = 'A hook that is long enough to wrap over several lines on a narrow phone screen without any word being cut off at the edge';
const PASSAGE = Array.from({ length: 6 }, (_, i) => `Passage sentence ${i + 1}, long enough to wrap over several lines in the reading column of the clip page.`).join('\n');

export function Preview({ which }: { which: string }) {
  if (which === 'share') {
    return (
      <div className="vfeed" style={{ height: '100dvh' }}>
        <ShareSheet info={{ hook: LONG, channel: 'Channel Brain (Dr. Test)' }} onClose={() => {}} />
      </div>
    );
  }
  if (which === 'clip-rtl') {
    return <ClipView clip={{ form: 'audio', hook: 'بسم الله الرحمن الرحيم', channel: 'قناة', episode: 'الحلقة ١', dir: 'rtl', context: 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ\nٱلرَّحْمَـٰنِ ٱلرَّحِيمِ', episodeUrl: 'https://example.org/' }} onPlay={() => {}} />;
  }
  if (which === 'clip-text') {
    return <ClipView clip={{ form: 'text', hook: LONG, channel: 'Channel Brain', episode: 'Episode 12', context: PASSAGE, episodeUrl: 'https://example.org/' }} />;
  }
  return <ClipView clip={{ form: 'video', hook: LONG, channel: 'Channel Body', episode: 'Episode 12 with a rather long title', context: 'Caption one\nCaption two', episodeUrl: 'https://example.org/' }} onPlay={() => {}} />;
}
