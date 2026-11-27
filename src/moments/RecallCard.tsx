import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { Icon } from '../components/Icon';
import { recallTag, shuffleOrder } from './recall';
import { isArabic, thumbOf, type Moment } from './types';
import { sourceLine } from './source';
import { FIT_LEVELS, RECALL_TOP_MIN, RECALL_TOP_MIN_DONE, pickRecallFit, recallSwipe, recallTop, recallTopDone } from './recallfit';

/** Bezug oben auf der Abrufkarte (Issue 42): Hook und Quelle des Ursprungs-Moments, Sprache und Richtung folgen dem Moment */
export function originOf(m: Moment): { hook: string; dir: 'rtl' | 'ltr'; source: string } {
  const src = sourceLine(m);
  return { hook: m.hook, dir: isArabic(m.hook) ? 'rtl' : 'ltr', source: src ? `${src.prefix}${src.text}` : '' };
}

/** Kennzeichnungszeile: macht klar, dass die Karte eine Wiederholungsfrage zu früher Gelesenem ist */
export function RecallTag({ review, day, dir }: { review: boolean; day?: string | null; dir?: 'rtl' | 'ltr' }) {
  return <div className="recall-tag" data-testid="recall-tag" dir={dir} lang="en">{recallTag(review, day)}</div>;
}

/** Hook des Ursprungs-Moments (Desktop-Panel). Auf dem Handy erscheint er nicht (nach der Antwort steht nur die Erklärung). */
export function RecallHook({ text, dir, className, as: Tag = 'p' }: { text: string; dir: string; className: string; as?: 'p' | 'h2' }) {
  return <Tag className={className} dir={dir} data-recall-hook="">{text}</Tag>;
}

/** Knopf "Show text". Der Ursprungstext öffnet als Überlagerung über der Abrufseite (eigener scrollbarer Bereich mit "Close"), nie im Fluss. Tipp und Wisch bleiben im Bereich. */
export function RecallTextPeek({ text, dir }: { text: string; dir: 'rtl' | 'ltr' }) {
  const [open, setOpen] = useState(false);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="recall-peek" onPointerDown={stop} onPointerUp={stop} onTouchStart={stop} onTouchEnd={stop}>
      <button type="button" className="recall-showtext" data-testid="recall-showtext" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide text' : 'Show text'}
      </button>
      {open && (
        <div className="recall-peekov" data-testid="recall-peekov" role="dialog" aria-label="Text">
          <div className="recall-peekhead">
            <button type="button" className="recall-peekclose" data-testid="recall-peekclose" lang="en" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <div className="recall-peektext" data-testid="recall-peektext" dir={dir} lang={dir === 'rtl' ? 'ar' : 'en'} tabIndex={0}>
            {text}
          </div>
        </div>
      )}
    </div>
  );
}

/** Höhe des Blocks (oberste Oberkante bis unterste Unterkante der Kinder im Fluss) */
function blockBox(root: HTMLElement): { top: number; bottom: number } {
  let top = Infinity;
  let bottom = -Infinity;
  for (const el of Array.from(root.children) as HTMLElement[]) {
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.position === 'absolute' || c.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.bottom);
  }
  return bottom > top ? { top, bottom } : { top: 0, bottom: 0 };
}

/** Höhe des Blocks nach der Antwort, auch vor der Antwort: Unterkante der letzten Antwort, dann Erklärung, Hook und "Next" aus der unsichtbaren Messkopie (.recall-probe, aus dem Fluss, ohne Höhe) */
function doneHeight(root: HTMLElement, askBox: { top: number; bottom: number }): number {
  const probe = root.querySelector<HTMLElement>('.recall-probe');
  if (!probe) return askBox.bottom - askBox.top;
  const opts = Array.from(root.querySelectorAll<HTMLElement>('[data-testid=recall-option]'));
  const lastOpt = opts.length ? opts[opts.length - 1].getBoundingClientRect().bottom : askBox.bottom;
  let h = lastOpt - askBox.top;
  for (const el of Array.from(probe.children) as HTMLElement[]) h += parseFloat(getComputedStyle(el).marginTop) + el.getBoundingClientRect().height;
  return h;
}

/**
 * Stufe wählen: jede Stufe setzen, Block vor und nach der Antwort messen, die kleinste nehmen, bei der beide in die Fläche passen (ab from).
 * Setzt außerdem die Oberkante des Blocks (--rc-top an der Seite): beim ersten Anzeigen 40 Prozent des freien Platzes, nach der Antwort unverändert, nur so weit nach oben, wie nötig.
 * top ist die beim ersten Anzeigen gemessene Oberkante (null: erstes Anzeigen).
 */
export function fitRoot(root: HTMLElement, answered = false, from = 0, top: number | null = null): { level: number; top: number } {
  const ask: number[] = [];
  const done: number[] = [];
  const cs = getComputedStyle(root);
  const room = root.clientHeight - parseFloat(cs.paddingBottom);
  for (let lv = 0; lv < FIT_LEVELS; lv++) {
    root.dataset.fit = String(lv);
    const box = blockBox(root);
    ask.push(box.bottom - box.top);
    done.push(doneHeight(root, box));
  }
  // Nach der Antwort zählt nur noch der Block nach der Antwort (die Oberkante ist schon festgelegt), samt 8 px Mindestabstand oben
  // Runde 51: auf dem Handy sitzt die Oberkante fest 16 px unter der Seitenkante (24 pt unter der Reiterleiste, wie der Chip der anderen Reiter), vor und nach der Antwort. Der Block nach der Antwort braucht dann 16 statt 8 px oben.
  const phone = !!root.closest('.vfeed[data-phone]');
  const level = pickRecallFit(answered ? [] : ask, phone ? done.map((d) => d + RECALL_TOP_MIN - RECALL_TOP_MIN_DONE) : done, room, from);
  root.dataset.fit = String(level);
  const t0 = phone ? RECALL_TOP_MIN : answered && top !== null ? top : recallTop(room, ask[level]);
  const t = phone ? RECALL_TOP_MIN : answered ? recallTopDone(t0, room, done[level]) : t0;
  if (answered) root.setAttribute('data-answered', '');
  root.style.setProperty('--rc-top', `${t}px`);
  return { level, top: t0 };
}

/** Steuerung von außen, nur im Desktop-Modus: Antwort nach angezeigter Stelle (0 bis 2) wählen */
export interface RecallCtl {
  pick: (shown: number) => void;
}

/**
 * Abrufkarte: Cover, Sprecher und Bereich, darunter die Frage, darunter die drei Antworten in zufälliger Reihenfolge.
 * Erst nach dem Tipp: richtige Antwort grün, falsch gewählte rot, dann recall.why und "Next".
 * Die Wertung zählt beim Tipp. Arabisch läuft rechtsläufig.
 * Runde 28: auf dem Handy (alle drei Reiter) kein Kasten. Die Seite unter der Reiterleiste trägt einen Block: Kennzeile, Bereich, Quelle, Frage, Antworten, "Skip".
 * Der Hook steht erst nach der Antwort, unter der Erklärung. Der Block sitzt 40 zu 60 über der Mitte, seine Oberkante wird beim ersten Anzeigen gemessen und bleibt nach der Antwort stehen.
 * Die Stufe (recallfit.ts, data-fit) wird so gewählt, dass der Block vor und nach der Antwort passt. Nichts scrollt.
 * Weiter geht es vor der Antwort nur über "Skip" (ohne Wertung), nach der Antwort über "Next" oder einen Wisch nach oben.
 */
export function RecallCard({ m, review, read, rng, onAnswer, onClose, onSkip, onDiag, keys, ctl, origin = true, noImg = false }: { m: Moment; noImg?: boolean; review: boolean; read?: string | null; origin?: boolean; rng: () => number; onAnswer: (got: boolean) => void; onClose: () => void; onSkip?: () => void; onDiag?: (line: string) => void; keys?: boolean; ctl?: MutableRefObject<RecallCtl | null> }) {
  const r = m.recall!;
  const order = useMemo(() => shuffleOrder(r.options.length, rng), [m.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [chosen, setChosen] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const y = useRef<number | null>(0);
  const blocked = useRef(false);
  const level = useRef<number | null>(null);
  const floor = useRef(0);
  const top0 = useRef<number | null>(null);
  const diagRef = useRef(onDiag);
  diagRef.current = onDiag;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const speaker = m.channel.replace(/^(.*?)\s*\((.+)\)$/, '$1 · $2');
  const ar = isArabic(r.question);
  const dir = ar ? 'rtl' : 'ltr';
  const answered = chosen !== null;
  const pick = (i: number) => {
    if (chosen !== null) return;
    setChosen(i);
    onAnswer(i === r.correct);
  };
  useEffect(() => {
    if (!ctl) return;
    ctl.current = { pick: (shown) => order[shown] !== undefined && pick(order[shown]) };
    return () => {
      ctl.current = null;
    };
  });
  // Stufe messen, bevor etwas gezeichnet wird: beim Öffnen, nach der Antwort, bei jeder Größenänderung (Leisten von Safari, Drehen, Schrift geladen). Desktop (keys) hat Platz im Panel.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || keys) return;
    const root = (card.closest('.vrecall-page') as HTMLElement | null) ?? card;
    const fit = () => {
      const res = fitRoot(root, answered, answered ? floor.current : 0, top0.current);
      const lv = res.level;
      if (!answered) top0.current = res.top;
      if (level.current === null) diagRef.current?.(`recall: shown ${m.id} fit=${lv} h=${window.innerHeight}`);
      else if (lv !== level.current) diagRef.current?.(`recall: refit ${m.id} fit=${lv} h=${window.innerHeight}`);
      level.current = lv;
      if (!answered) floor.current = lv;
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fit()) : null;
    ro?.observe(root);
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    return () => {
      live = false;
      ro?.disconnect();
    };
  }, [answered, keys, m.id]);
  return (
    <div
      ref={cardRef}
      className="recall no-callout"
      data-testid="recall-card"
      dir={dir}
      lang={ar ? 'ar' : 'en'}
      style={{ ['--area' as string]: AREA_COLOR[m.area] }}
      onPointerDown={stop}
      onPointerUp={stop}
      onTouchStart={(e) => {
        y.current = e.touches[0].clientY;
      }}
      onTouchEnd={(e) => {
        if (y.current === null) return;
        const v = recallSwipe(answered, e.changedTouches[0].clientY - y.current);
        if (v === 'close') onClose();
        else if (v === 'blocked' && !blocked.current) {
          blocked.current = true;
          onDiag?.(`recall: swipe blocked ${m.id}`);
        }
      }}
    >
      <div className="recall-source">
        {!noImg && <img src={thumbOf(m)} alt="" draggable={false} />}
        <div>
          <div className="recall-area" style={{ color: AREA_COLOR[m.area] }}>{AREA_LABEL[m.area]}</div>
          <div className="recall-speaker">{speaker}{review ? ' · again' : ''}</div>
        </div>
      </div>
      {origin && <RecallTag review={review} day={read} dir={dir} />}
      {origin && (
        <div className="recall-origin" data-testid="recall-hook">
          <RecallHook className="recall-hook" dir={originOf(m).dir} text={originOf(m).hook} />
          {originOf(m).source && <p className="recall-hooksrc" dir="auto">{originOf(m).source}</p>}
        </div>
      )}
      <h2 className="recall-q" data-testid="recall-question">{r.question}</h2>
      <div className="recall-options">
        {order.map((i, shown) => {
          const state = chosen === null ? '' : i === r.correct ? 'right' : i === chosen ? 'wrong' : 'rest';
          return (
            <button key={i} className={`recall-option ${state}`} data-testid="recall-option" data-correct={i === r.correct ? '1' : '0'} data-state={state} disabled={chosen !== null && state === 'rest' ? true : undefined} aria-pressed={chosen === i} onClick={() => pick(i)}>
              <span>{r.options[i]}</span>
              {/* Runde 24: jede Option hält den Platz des Hakens frei, damit der Text nach der Antwort nicht anders umbricht und die Antworten nicht springen */}
              {state === 'right' ? <Icon name="check" size="var(--icon-sm)" /> : !keys && <span className="recall-tick" aria-hidden="true" />}
              {keys && <kbd className="recall-key" aria-hidden="true">{shown + 1}</kbd>}
            </button>
          );
        })}
      </div>
      {/* Runde 28: kein Platzhalter im Fluss. Die Messkopie hat keine Höhe und liegt nicht im Fluss, sie dient nur der Stufenwahl (Erklärung und "Next" nach der Antwort). */}
      {chosen === null && !keys && (
        <div className="recall-probe" aria-hidden="true">
          <p className="recall-why">{r.why}</p>
          <div className="recall-primary">Next</div>
        </div>
      )}
      {chosen === null && !keys && onSkip && (
        <button type="button" className="recall-skip" data-testid="recall-skip" lang="en" onClick={onSkip}>
          Skip
        </button>
      )}
      {chosen !== null && (
        <>
          <p className="recall-why" data-testid="recall-why">{r.why}</p>
          <button className="recall-primary" data-testid="recall-next" onClick={onClose}>
            Next
            {keys && <kbd className="recall-key" aria-hidden="true">Enter</kbd>}
          </button>
        </>
      )}
    </div>
  );
}
