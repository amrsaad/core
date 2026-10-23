import type { Card } from '../types';
import { AREA_COLOR, AREA_LABEL, isArabic, shortTitle, topicLabel, TYPE_LABEL } from '../lib/labels';

export function AreaBar({ area }: { area: Card['area'] }) {
  return <div aria-hidden className="absolute left-0 top-0 h-full w-1" style={{ background: AREA_COLOR[area] }} />;
}

export function MetaLine({ card, extra }: { card: Card; extra?: string }) {
  return (
    <div className="t-meta flex flex-wrap gap-x-2 text-muted">
      <span style={{ color: AREA_COLOR[card.area] }}>{AREA_LABEL[card.area]}</span>
      <span>·</span>
      <span>{topicLabel(card.topic)}</span>
      <span>·</span>
      <span>{extra ?? TYPE_LABEL[card.type]}</span>
    </div>
  );
}

export function Excerpt({ text }: { text: string }) {
  const ar = isArabic(text);
  return (
    <blockquote dir={ar ? 'rtl' : 'ltr'} className={`t-excerpt m-0 text-muted ${ar ? 't-arabic-sm' : ''}`}>
      {ar ? `«${text}»` : `„${text}“`}
    </blockquote>
  );
}

export function SourceLine({ card }: { card: Card }) {
  const s = card.source;
  return (
    <a
      href={s.url}
      target="_blank"
      rel="noopener noreferrer"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      className="t-meta flex items-start gap-2 text-muted no-underline"
    >
      <span className="min-w-0 flex-1">
        {s.publisher}
        {s.year ? ` · ${s.year}` : ''} · <span className="normal-case tracking-normal">{shortTitle(s.title)}</span>
      </span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Quelle öffnen">
        <path d="M7 17 17 7M9 7h8v8" />
      </svg>
    </a>
  );
}

export function CardView({ card }: { card: Card }) {
  const verse = card.area === 'beat';
  return (
    <div className="pad relative flex h-full flex-col justify-center gap-5 overflow-y-auto">
      <MetaLine card={card} extra={verse ? `${TYPE_LABEL[card.type]} ${card.id.replace('quran:', '')}` : undefined} />
      {card.arabic && (
        <p dir="rtl" lang="ar" className="t-arabic m-0">
          {card.arabic}
        </p>
      )}
      <h2 className="t-headline m-0">{card.translation ?? card.headline}</h2>
      {card.body && (
        <div className="flex flex-col gap-1">
          {verse && <span className="t-meta text-muted">Tafsir Ibn Kathir</span>}
          <p className="t-body m-0">{card.body}</p>
        </div>
      )}
      {card.forYou && (
        <div className="rounded-xl bg-surface p-4">
          <div className="t-meta mb-1 text-muted">Für dich</div>
          <p className="t-body m-0">{card.forYou}</p>
        </div>
      )}
      {verse && card.reflection && (
        <div className="rounded-xl bg-surface p-4">
          <div className="t-meta mb-1 text-muted">Reflexionsfrage</div>
          <p className="t-body m-0">{card.reflection}</p>
        </div>
      )}
      <div className="flex flex-col gap-1">
        {verse && <span className="t-meta text-muted">{isArabic(card.source.excerpt) ? 'Tafsir al-Muyassar' : 'Tafsir Ibn Kathir'}</span>}
        <Excerpt text={card.source.excerpt} />
      </div>
      <SourceLine card={card} />
    </div>
  );
}
