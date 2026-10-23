import { useMemo, useState } from 'react';
import type { Area } from '../types';
import { dueDate } from '../lib/fsrs';
import { AREA_COLOR, AREA_LABEL, topicLabel } from '../lib/labels';
import type { AppState } from '../lib/state';
import { Excerpt, SourceLine } from '../feed/CardView';

export function Saved({ state, update }: { state: AppState; update: (fn: (s: AppState) => AppState) => void }) {
  const [area, setArea] = useState<Area | 'all'>('all');
  const [topic, setTopic] = useState<string>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const items = Object.values(state.saved).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const topics = useMemo(() => [...new Set(items.filter((i) => area === 'all' || i.card.area === area).map((i) => i.card.topic))], [items, area]);
  const needle = q.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (area === 'all' || i.card.area === area) &&
      (topic === 'all' || i.card.topic === topic) &&
      (!needle || `${i.card.headline} ${i.card.source.excerpt} ${i.card.source.title} ${i.card.translation ?? ''}`.toLowerCase().includes(needle)),
  );
  const chip = (active: boolean) => `t-meta shrink-0 rounded-full border px-3 py-2 ${active ? 'border-[var(--fg)] text-[var(--fg)]' : 'border-[var(--line)] text-muted'}`;

  return (
    <div className="pad pad-nav flex h-[100dvh] flex-col gap-4 overflow-y-auto">
      <h1 className="t-headline m-0">Gespeichert</h1>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Suchen"
        className="rounded-xl border border-[var(--line)] bg-surface px-4 py-3 text-[17px] text-[var(--fg)] outline-none"
      />
      <div className="flex gap-2 overflow-x-auto">
        {(['all', 'brain', 'body', 'beat'] as const).map((a) => (
          <button key={a} className={chip(area === a)} onClick={() => { setArea(a); setTopic('all'); }}>
            {a === 'all' ? 'Alle' : AREA_LABEL[a]}
          </button>
        ))}
      </div>
      {topics.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          <button className={chip(topic === 'all')} onClick={() => setTopic('all')}>Alle Topics</button>
          {topics.map((t) => (
            <button key={t} className={chip(topic === t)} onClick={() => setTopic(t)}>{topicLabel(t)}</button>
          ))}
        </div>
      )}
      {!shown.length && <p className="t-body text-muted">{items.length ? 'Nichts gefunden.' : 'Doppeltipp auf eine Karte speichert sie hier. Sie kommt dann als Abruf-Karte zurück.'}</p>}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {shown.map((i) => (
          <li key={i.card.id} className="relative overflow-hidden rounded-xl bg-surface p-4 pl-5">
            <div aria-hidden className="absolute left-0 top-0 h-full w-1" style={{ background: AREA_COLOR[i.card.area] }} />
            <button onClick={() => setOpen(open === i.card.id ? null : i.card.id)} className="block w-full text-left">
              <div className="t-meta text-muted">
                {AREA_LABEL[i.card.area]} · {topicLabel(i.card.topic)} · fällig {dueDate(i).toLocaleDateString('de-DE')}
              </div>
              <div className="mt-1 text-[17px] font-semibold leading-[24px]">{i.card.headline}</div>
            </button>
            {open === i.card.id && (
              <div className="mt-3 flex flex-col gap-3">
                {i.card.forYou && <p className="m-0 text-[16px] leading-[24px]">{i.card.forYou}</p>}
                <Excerpt text={i.card.source.excerpt} />
                <SourceLine card={i.card} />
                <button
                  className="t-meta self-start text-muted"
                  onClick={() => update((s) => { const saved = { ...s.saved }; delete saved[i.card.id]; return { ...s, saved }; })}
                >
                  Entfernen
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
