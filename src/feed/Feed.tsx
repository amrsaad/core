import { useEffect, useMemo, useRef, useState } from 'react';
import type { Grade } from 'ts-fsrs';
import type { Card } from '../types';
import { dayKey, now as clockNow } from '../lib/clock';
import { newSaved, Rating, review } from '../lib/fsrs';
import { adjustWeight, FEEDBACK, type AppState } from '../lib/state';
import { AreaBar, CardView } from './CardView';
import { RecallView } from './RecallView';
import { RoundEnd } from './RoundEnd';
import { composeRound, type RoundItem } from './round';
import { useGestures } from './useGestures';

interface Props {
  cards: Card[];
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  onToggleChrome: () => void;
}

const SKIP_MS = 1500;

function Slide({ item, state, update, onToggleChrome }: { item: RoundItem } & Omit<Props, 'cards'>) {
  const [flash, setFlash] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const card = item.kind === 'card' ? item.card : item.item.card;
  const saved = !!state.saved[card.id];

  const show = (t: string) => {
    setFlash(t);
    window.setTimeout(() => setFlash(null), 900);
  };

  const gestures = useGestures({
    onTap: onToggleChrome,
    onDoubleTap: () => {
      if (item.kind !== 'card') return;
      if (saved) return show('Schon gespeichert');
      navigator.vibrate?.(15);
      update((s) => adjustWeight({ ...s, saved: { ...s.saved, [card.id]: newSaved(card, clockNow()) } }, card.topic, FEEDBACK.save));
      show('Gespeichert');
    },
    onLongPress: () => {
      navigator.vibrate?.(10);
      setMenu(true);
    },
  });

  const feedback = (factor: number, label: string) => {
    update((s) => adjustWeight(s, card.topic, factor));
    setMenu(false);
    show(label);
  };

  const grade = (r: Grade) =>
    update((s) => ({
      ...s,
      saved: { ...s.saved, [card.id]: review(s.saved[card.id], r, clockNow()) },
      reviews: [...s.reviews, { id: card.id, ts: clockNow().toISOString(), hit: r === Rating.Good || r === Rating.Easy, kind: 'fsrs' as const }].slice(-2000),
    }));

  return (
    <div className="no-callout h-full" {...(item.kind === 'card' ? gestures : {})}>
      <AreaBar area={card.area} />
      {item.kind === 'card' ? <CardView card={card} /> : <RecallView item={item.item} onGrade={grade} />}
      {saved && item.kind === 'card' && (
        <div className="t-meta pointer-events-none absolute right-5 text-muted" style={{ top: 'calc(env(safe-area-inset-top) + 20px)' }}>
          Gespeichert
        </div>
      )}
      {flash && (
        <div className="flash pointer-events-none absolute inset-x-0 bottom-28 flex justify-center">
          <span className="rounded-full bg-surface px-4 py-2 text-[15px] shadow">{flash}</span>
        </div>
      )}
      {menu && (
        <div className="absolute inset-0 z-20 flex items-end bg-black/50" onPointerUp={(e) => e.target === e.currentTarget && setMenu(false)}>
          <div className="pad w-full rounded-t-2xl bg-surface" onPointerUp={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            {[
              ['Mehr davon', () => feedback(FEEDBACK.more, 'Mehr davon')],
              ['Weniger', () => feedback(FEEDBACK.less, 'Weniger davon')],
              ['Quelle prüfen', () => { setMenu(false); window.open(card.source.url, '_blank', 'noopener'); }],
              ['Abbrechen', () => setMenu(false)],
            ].map(([label, fn]) => (
              <button key={label as string} onClick={fn as () => void} className="block w-full border-b border-[var(--line)] py-4 text-left text-[17px] last:border-0">
                {label as string}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Feed({ cards, state, update, onToggleChrome }: Props) {
  const today = dayKey(clockNow());
  const doneToday = state.rounds[today] ?? 0;
  const limit = state.settings.dailyRoundLimit;
  const [roundKey, setRoundKey] = useState(0);
  const [finished, setFinished] = useState(doneToday >= limit);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Runde einmal pro roundKey zusammenstellen, nicht bei jedem State-Update
  const items = useMemo(
    () => composeRound({ cards, state: stateRef.current, now: clockNow(), roundToday: stateRef.current.rounds[today] ?? 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, roundKey],
  );
  const quiz = useMemo(() => {
    const cs = items.flatMap((i) => (i.kind === 'card' ? [i.card] : []));
    return [...cs.filter((c) => c.recall), ...cs.filter((c) => !c.recall)].slice(0, 3);
  }, [items]);

  const scroller = useRef<HTMLDivElement>(null);
  const active = useRef<{ idx: number; since: number; acted: boolean }>({ idx: -1, since: 0, acted: false });
  const completed = useRef(false);

  useEffect(() => {
    completed.current = false;
    scroller.current?.scrollTo({ top: 0 });
    const els = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-idx]') ?? [])];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const idx = Number((e.target as HTMLElement).dataset.idx);
          const prev = active.current;
          if (idx === prev.idx) continue;
          const prevItem = items[prev.idx];
          const before = stateRef.current.saved[prevItem?.kind === 'card' ? prevItem.card.id : ''];
          // Überspringen unter 1,5 s senkt das Topic leicht
          if (prevItem?.kind === 'card' && !before && Date.now() - prev.since < SKIP_MS && idx > prev.idx) {
            update((s) => adjustWeight(s, prevItem.card.topic, FEEDBACK.skip));
          }
          active.current = { idx, since: Date.now(), acted: false };
          const item = items[idx];
          if (item?.kind === 'card') update((s) => (s.seen[item.card.id] ? s : { ...s, seen: { ...s.seen, [item.card.id]: Date.now() } }));
          if (idx === items.length && !completed.current) {
            completed.current = true;
            update((s) => ({ ...s, rounds: { ...s.rounds, [today]: (s.rounds[today] ?? 0) + 1 }, roundsTotal: s.roundsTotal + 1 }));
          }
        }
      },
      { root: scroller.current, threshold: 0.6 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items, today, update]);

  if (finished || !items.length) {
    return (
      <div className="pad flex h-[100dvh] flex-col justify-center gap-4">
        <h2 className="t-headline m-0">{items.length ? 'Für jetzt fertig' : 'Alle Karten gesehen'}</h2>
        <p className="t-body m-0 text-muted">
          {items.length ? `Heute ${doneToday} von ${limit} Runden.` : 'Neue Karten kommen täglich um 03:00 UTC.'}
        </p>
        {items.length > 0 && doneToday < limit && (
          <button onClick={() => { setFinished(false); setRoundKey((k) => k + 1); }} className="rounded-xl border border-[var(--line)] py-4 text-[17px] font-semibold">
            Neue Runde
          </button>
        )}
      </div>
    );
  }

  const roundNo = (state.rounds[today] ?? 0) || 1;
  return (
    <div ref={scroller} className="feed">
      {items.map((it, i) => (
        <section key={`${roundKey}-${i}`} data-idx={i} className="slide">
          <Slide item={it} state={state} update={update} onToggleChrome={onToggleChrome} />
        </section>
      ))}
      <section data-idx={items.length} className="slide">
        <RoundEnd
          roundNo={roundNo}
          limitReached={(state.rounds[today] ?? 0) >= limit}
          quiz={quiz}
          state={state}
          now={clockNow()}
          onQuiz={(id, hit) => update((s) => ({ ...s, reviews: [...s.reviews, { id, ts: clockNow().toISOString(), hit, kind: 'quiz' as const }].slice(-2000) }))}
          onMore={() => setRoundKey((k) => k + 1)}
          onDone={() => setFinished(true)}
        />
      </section>
    </div>
  );
}

