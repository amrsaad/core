import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { dayKey, now as clockNow } from '../lib/clock';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import type { AppState } from '../lib/state';
import { createPlayer, HLS, loadYT, offlineYT, STATE, type YTPlayer } from '../video/ytApi';
import { isYtId } from './contract';
import { browserPreloader } from './preloader';
import { netRank, PRELOAD_COUNT, streamKind } from './preload';
import { cursorFor, parseSaved, queueKey, releaseTail, reorderByRank, restoreQueue } from './queue';
import { leaveOf, newMomentCursor, nextMomentBlock, SIGNAL, type MomentCursor } from './mix';
import { applyEffect, confirmLine, signal, skip as skipRule, type Effect } from './learn';
import { clampRate, DEFAULT_SPEED, HOLD_SPEED, speedOf } from '../lib/state';
import { addSample } from './latency';
import { captionsShown } from './captions';
import { countGotIt, countSeen, todayLine } from './today';
import { answer, cardDue, pickRecall, type Recent } from './recall';
import { RecallCard, type RecallCtl } from './RecallCard';
import { CaptionSheet } from './CaptionSheet';
import { sourceLine } from './source';
import { NoteSheet, type NoteCtl } from './NoteSheet';
import { createWheel, deskKey, endsFast, TAB_KEYS, wheelPx, type DeskAction } from './desktop';
import { DeskPanel } from './DeskShell';
import { speakerLine } from './speaker';
import { buildIssue, chipEffect, CONFIRM_SHEET_MS, firstOpenOfDay, makeEntry, markSent, promptLine, unsent, type Chip } from './note';
import { HOOK_LINE_PT, hookStep } from './hook';
import { makeRng } from './rng';
import { addTap, CONFIRM_MS, HEART_MS, nextLiked, swipeOf } from './actions';
import { emptyFormLine, filterPool, formOf, FORM_LABEL, FORMS, momentText, textEndReached, type Form } from './form';
import { atEnd, BG_STALL_MS, countsSeenAtStart, EndLedger, isBackground, onLeave } from './background';
import { fullVideoUrl, isArabic, thumbOf, type Feedback, type Moment } from './types';

/** Desktop-Modus ab 900 px: Panel rechts, Übersicht, Seitenblatt. Fehlt das Feld, gilt das mobile Verhalten unverändert. */
export interface DeskProps {
  panel: HTMLElement | null;
  help: boolean;
  sheet: boolean;
  onHelp: () => void;
  onCloseSheet: () => void;
}

interface Props {
  pool: Moment[];
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  active: boolean;
  onPausedChange: (paused: boolean) => void;
  desk?: DeskProps;
}

interface Slot {
  host: HTMLDivElement | null;
  /** Rahmen des Slots, trägt data-live, solange der Player wirklich abspielt (Vorschaubild wird synchron ausgeblendet) */
  el: HTMLDivElement | null;
  player: YTPlayer | null;
  ready: boolean;
  index: number;
  st: number;
  /** Moment-ID, die gerade im Player steckt */
  mid: string;
}

const END_GUARD = 0.3;
const FOR_YOU_MS = 6000;
const POLL_MS = 150;
const TAP_MS = 260;
const LONG_MS = 520;
const LOG_MAX = 3000;
/** Warteschlange beim Start: der Vorrat soll 30 Momente vorhalten, dazu der aktuelle und ein paar Reserve */
const QUEUE_AHEAD = PRELOAD_COUNT + 2;

const load = (m: Moment) => ({ videoId: m.videoId, startSeconds: m.start, endSeconds: m.end });

/** Das Symbol "Ton aus" erscheint nur, solange in dieser Sitzung noch nie Ton an war. Danach nie wieder (Max, 29.10.2026). */
let soundSeenOn = false;

export function MomentFeed({ pool: allPool, state, update, active, onPausedChange, desk }: Props) {
  const single = state.settings.playerMode === 'single';
  const SLOTS = single ? 1 : 3;
  const stateRef = useRef(state);
  stateRef.current = state;
  const deskRef = useRef(desk);
  deskRef.current = desk;
  /** Abrufkarte beantwortet (Enter ist dann Next) */
  const recallAnswered = useRef(false);
  const recallCtl = useRef<RecallCtl | null>(null);
  const noteCtl = useRef<NoteCtl | null>(null);
  /** Das 2x kommt von der Tastatur (Shift+. gehalten) */
  const keyFast = useRef(false);
  const spaceHandled = useRef(false);
  const actRef = useRef<(a: DeskAction) => void>(() => {});
  const playRef = useRef<(want: boolean) => void>(() => {});
  const form: Form = state.settings.form ?? 'video';
  const pool = useMemo(() => filterPool(allPool, form), [allPool, form]);
  const textRef = useRef(form === 'text');
  textRef.current = form === 'text';
  /** Im Textmodus: Textende des aktuellen Moments war sichtbar */
  const textSeen = useRef(-1);
  const textBox = useRef<HTMLDivElement>(null);

  const queue = useRef<Moment[]>([]);
  const cursor = useRef<MomentCursor | null>(null);
  /** Offline-Vorrat (Cache API), null wo es keine Cache API gibt */
  const pre = useMemo(() => browserPreloader(), []);
  /** Netz schlecht (offline oder die letzten Starts langsam): die Mischung zieht Vorgeladenes und Text vor, YouTube nach hinten */
  const poorRef = useRef(false);
  const lastReplan = useRef(0);
  /** YouTube-API nicht ladbar (offline): Stub-Player, YouTube-Momente werden übersprungen */
  const ytStub = useRef(false);
  const [ytEpoch, setYtEpoch] = useState(0);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const idxRef = useRef(0);
  const slots = useRef<Slot[]>(Array.from({ length: 3 }, () => ({ host: null, el: null, player: null, ready: false, index: -1, st: STATE.UNSTARTED, mid: '' })));
  const soundOn = useRef(false);
  const userPaused = useRef(false);
  const since = useRef(Date.now());
  const endedAt = useRef(-1);
  const forYouRef = useRef(false);
  /** Abrufkarte offen: Player bleibt angehalten */
  const recallRef = useRef(false);
  const sessionSeen = useRef(0);
  const counted = useRef(new Set<string>());
  const recent = useRef<Recent[]>([]);
  const forYouTimer = useRef(0);
  const feedMs = useRef(0);
  const dragEl = useRef<HTMLDivElement>(null);
  const diag = useRef<string[]>([]);
  const bad = useRef(new Set<string>());
  // Hintergrund-Wiedergabe (Entscheidung 13)
  const ledger = useRef(new EndLedger());
  /** Abrufkarte, die im Hintergrund fällig wurde: kommt bei der Rückkehr */
  const pendingRecall = useRef<{ id: string; review: boolean } | null>(null);
  /** Beim Verlassen der Seite angehalten (YouTube, Text), nicht vom Menschen */
  const leftPaused = useRef(false);
  const bgStarted = useRef(new Set<string>());
  const visRef = useRef<(v: string) => void>(() => {});
  const msOnRef = useRef(false);
  /** Zum nächsten Moment springen, auch aus Code, der vor goTo definiert ist */
  const skipRef = useRef<() => void>(() => {});
  const everPlayed = useRef(false);
  /** Offene Messung Wisch bis erstes Bild */
  const swipe = useRef<{ j: number; t0: number; buffered: boolean } | null>(null);

  const [idx, setIdx] = useState(0);
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState(!soundSeenOn);
  const [paused, setPaused] = useState(false);
  const [fast, setFast] = useState(false);
  const rateRef = useRef(DEFAULT_SPEED);
  const fastRef = useRef(false);
  const endFast = () => {
    fastRef.current = false;
    for (const sl of slots.current) sl.player?.setPlaybackRate(clampRate(rateRef.current));
    setFast(false);
  };
  const [forYou, setForYou] = useState<Moment | null>(null);
  /** Herz an der Tippstelle (400 ms) und kurze Bestätigung am Knopf (150 ms) */
  const [capOpen, setCapOpen] = useState(false);
  const [note, setNote] = useState<Moment | null>(null);
  /** Zeile "N notes, send?" beim ersten Öffnen am Tag */
  const [prompt, setPrompt] = useState(false);
  const promptChecked = useRef(false);
  const noteRef = useRef<Moment | null>(null);
  noteRef.current = note;
  /** Bestätigungszeile am Blatt nach einem Chip, solange sie steht */
  const [confirmText, setConfirm] = useState<string | null>(null);
  const confirmRef = useRef(false);
  const confirmTimer = useRef(0);
  const confirmDone = useRef<() => void>(() => {});
  /** Weiterwischen nach einem Chip: die Wirkung des Chips ersetzt die Wertung nach Sehdauer */
  const silentLeave = useRef(false);
  const hookEl = useRef<HTMLDivElement>(null);
  const [heart, setHeart] = useState<{ x: number; y: number; k: number } | null>(null);
  const heartTimer = useRef(0);
  const [pulse, setPulse] = useState('');
  const pulseTimer = useRef(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);
  const waitSince = useRef(0);
  rateRef.current = speedOf(state.settings);

  const today = dayKey(clockNow());
  const show = (t: string) => {
    setFlash(t);
    window.setTimeout(() => setFlash(null), 900);
  };

  /** Warteschlange ablegen (pro Form und Tag), damit der Vorrat nach einem Neustart noch passt */
  const saveQueue = () => {
    try {
      const ids = queue.current.slice(Math.max(0, idxRef.current)).map((x) => x.id);
      localStorage.setItem(queueKey(form), JSON.stringify({ day: today, ids }));
    } catch {
      /* kein Speicher */
    }
  };

  const ensureQueue = useCallback(
    (upTo: number) => {
      const s = stateRef.current;
      if (!cursor.current) {
        // Heutige Warteschlange der letzten Sitzung übernehmen, dann passt der Vorrat noch (auch offline)
        let saved: Moment[] = [];
        try {
          saved = restoreQueue(parseSaved(localStorage.getItem(queueKey(form))), today, pool, { seen: s.momentSeen, mutedChannels: s.mutedChannels }, QUEUE_AHEAD);
        } catch {
          /* kein Speicher */
        }
        cursor.current = saved.length ? cursorFor(saved, false) : newMomentCursor(s.momentDay !== today);
        queue.current.push(...saved);
        poorRef.current = pre?.poor() ?? false;
      }
      const rank = poorRef.current && pre ? netRank(pre.has) : undefined;
      while (queue.current.length < upTo) {
        const b = nextMomentBlock(pool, { areaShares: s.settings.areaShares, weights: s.momentWeights, seen: s.momentSeen, mutedChannels: s.mutedChannels, now: clockNow().getTime(), rank }, cursor.current, rng.current);
        if (!b || !b.length) break;
        queue.current.push(...b.filter((m) => !bad.current.has(m.videoId)));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool, today, pre, form],
  );

  /** Vorrat bekommt die Warteschlange, Blob-URLs für die nahen Momente werden bereitgehalten */
  const syncPre = (at: number) => {
    if (!pre) return;
    pre.setQueue(queue.current, at);
    const w = pre.warmSet(queue.current, at);
    void pre.warm(w);
    pre.trimWarm(new Set(w.map((x) => x.id)));
    saveQueue();
  };

  const slotFor = (j: number) => slots.current[single ? 0 : ((j % 3) + 3) % 3];
  const current = () => slotFor(idxRef.current);
  const applySound = (p: YTPlayer) => (soundOn.current ? p.unMute() : p.mute());

  const assign = useCallback((slot: Slot, j: number, play: boolean) => {
    const m = queue.current[j];
    slot.index = j;
    // Text-Momente haben keinen Player
    if (!m || m.form === 'text' || !slot.player || !slot.ready) return;
    // Ohne YouTube-API (offline) tut ein YouTube-Moment nichts: merken und überspringen, nie hängen bleiben
    if (ytStub.current && streamKind(m) === 'youtube') {
      bad.current.add(m.videoId);
      if (play) window.setTimeout(() => skipRef.current(), 0);
      return;
    }
    try {
      // Vorladen ohne Ton, der aktuelle Moment bekommt den gewählten Ton
      if (play) applySound(slot.player);
      else slot.player.mute();
      if (slot.mid !== m.id) {
        slot.mid = m.id;
        slot.st = STATE.UNSTARTED;
        if (play) slot.player.loadVideoById(load(m));
        // YouTube lädt bei cue nur das Vorschaubild. Darum stumm laden, der Player hält beim ersten Bild an (siehe onState).
        else if (!HLS.has(m.videoId)) slot.player.loadVideoById(load(m));
        else slot.player.cueVideoById(load(m));
      } else if (play) slot.player.playVideo();
      else slot.player.pauseVideo();
    } catch (e) {
      // Ein einzelner Moment ließ sich nicht laden: merken und zum nächsten, nie die Fehlerseite
      diag.current.push(`assign ${m.id} failed ${e instanceof Error ? e.message : String(e)}`);
      bad.current.add(m.videoId);
      if (play) window.setTimeout(() => skipRef.current(), 0);
    }
  }, []);

  const log = (m: Moment, patch: { ended?: boolean; feedback?: Feedback }) =>
    update((s) => {
      const watched = Math.round((Date.now() - since.current) / 1000);
      const entries = [...s.momentLog];
      const i = entries.findIndex((e) => e.id === m.id && e.day === today);
      if (i >= 0) entries[i] = { ...entries[i], ...patch, watched: Math.max(entries[i].watched, watched) };
      else entries.push({ id: m.id, day: today, ended: false, watched, ...patch });
      return { ...s, momentLog: entries.slice(-LOG_MAX) };
    });

  const markSeen = (m: Moment | undefined) => {
    if (!m) return;
    update((s) => (s.momentSeen[m.id] ? { ...s, momentDay: today } : { ...s, momentDay: today, momentSeen: { ...s.momentSeen, [m.id]: Date.now() }, dayCount: countSeen(s.dayCount, today) }));
  };

  // Erkennt, ob der Browser die Wiedergabe mit Ton verweigert hat. Puffern (langsames Netz, Podcast-Stream) ist keine
  // Verweigerung, sonst stand "Tap for sound" bei laufendem Ton (28.10.). Dann später noch einmal prüfen.
  // Nach dem ersten Tipp bleibt der Ton an. Startet ein Moment nicht von selbst, wird noch einmal angestoßen und
  // der Zustand protokolliert. Nie mehr stummschalten, nie mehr "Tap for sound" zurückholen (Max, 28. und 29.10.).
  const soundGuard = (j: number, attempt = 0) => {
    window.setTimeout(() => {
      const sl = slotFor(j);
      if (idxRef.current !== j || userPaused.current || !sl.player || forYouRef.current || recallRef.current) return;
      if (sl.st === STATE.PLAYING || !soundOn.current) return;
      diag.current.push(`soundGuard slot${sl.index} st=${sl.st} attempt=${attempt}`);
      try { sl.player.playVideo(); } catch { /* Player noch nicht bereit */ }
      if (attempt < 3) soundGuard(j, attempt + 1);
    }, attempt === 0 ? 1500 : 2500);
  };

  const [recall, setRecall] = useState<{ m: Moment; review: boolean } | null>(null);
  const findMoment = (id: string): Moment | undefined => stateRef.current.savedMoments[id]?.moment ?? pool.find((x) => x.id === id);
  const rng = useRef<() => number>();
  rng.current ??= makeRng();
  const answerRecall = (got: boolean) => {
    const r = recall;
    recallAnswered.current = true;
    if (r) update((s) => ({ ...s, recall: answer(s.recall ?? {}, r.m.id, got, clockNow().getTime(), !!r.m.recallBoost), dayCount: got ? countGotIt(s.dayCount, today) : s.dayCount }));
  };
  const closeRecall = () => {
    recallRef.current = false;
    recallAnswered.current = false;
    setRecall(null);
    since.current = Date.now();
    if (!textRef.current && active && !userPaused.current) current().player?.playVideo();
  };

  const closeForYou = () => {
    window.clearTimeout(forYouTimer.current);
    forYouRef.current = false;
    setForYou(null);
  };

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next === idxRef.current) return;
      closeForYou();
      const from = idxRef.current + 1;
      const rest = queue.current.slice(from);
      const clean = rest.filter((x) => !bad.current.has(x.videoId));
      if (clean.length !== rest.length) {
        queue.current = [...queue.current.slice(0, from), ...clean];
        for (const sl of slots.current) if (sl.index >= from) sl.index = -1;
      }
      ensureQueue(next + QUEUE_AHEAD);
      if (next >= queue.current.length) return;
      syncPre(next);
      const prev = idxRef.current;
      const prevM = queue.current[prev];
      // Weitergewischt: Wertung nach geschautem Anteil (learn.ts). Unter 3 s ist ein Skip, zwei Skips desselben Kanals in Folge
      // sperren den Kanal 14 Tage. Jedes andere Weiterwischen unterbricht die Folge. Im Textmodus gibt es keine Wiedergabezeit,
      // darum keine Zeitwertung. Nach einem Chip ersetzt dessen Wirkung die Wertung (silentLeave).
      const nowMs = clockNow().getTime();
      if (next > prev && prevM) {
        const timed = endedAt.current !== prev && !textRef.current && !silentLeave.current;
        const lv = timed ? leaveOf((Date.now() - since.current) / 1000, prevM.end - prevM.start) : null;
        if (lv?.kind === 'skip')
          update((s) => {
            const r = skipRule(s.momentWeights, s.skipRun, prevM, nowMs);
            return { ...s, momentWeights: r.weights, skipRun: r.run };
          });
        else if (lv || stateRef.current.skipRun)
          update((s) => ({ ...s, momentWeights: lv ? signal(s.momentWeights, prevM, lv.f, nowMs) : s.momentWeights, skipRun: undefined }));
      }
      // Zurückgewischt, um etwas nochmal zu sehen: Plus für den Zielmoment
      const backM = queue.current[next];
      if (next < prev && backM) update((s) => ({ ...s, momentWeights: signal(s.momentWeights, backM, SIGNAL.back, nowMs), skipRun: undefined }));
      setCaption('');
      endFast();
      waitSince.current = 0;
      setLoading(false);
      // Für die Abrufkarte: geschauter Anteil des verlassenen Moments (Video: Position, Text: Ende erreicht)
      let recallNow: { id: string; review: boolean } | null = null;
      if (next > prev && prevM && !counted.current.has(prevM.id)) {
        counted.current.add(prevM.id);
        const len = prevM.end - prevM.start;
        const pos = (current().player?.getCurrentTime?.() ?? prevM.start) - prevM.start;
        const watched = endedAt.current === prev ? 1 : textRef.current ? (textSeen.current === prev ? 1 : 0) : Math.max(0, Math.min(1, pos / len));
        recent.current = [...recent.current, { id: prevM.id, watched }].slice(-8);
        sessionSeen.current += 1;
        if (cardDue(sessionSeen.current)) {
          const s0 = stateRef.current;
          recallNow = pickRecall(s0.recall ?? {}, recent.current, clockNow().getTime(), (id) => !!findMoment(id)?.recall);
        }
      }
      if (prevM && endedAt.current !== prev) log(prevM, {});
      current().player?.pauseVideo();
      idxRef.current = next;
      since.current = Date.now();
      endedAt.current = -1;
      userPaused.current = false;
      setPaused(false);
      setProgress(0);
      const target = slotFor(next);
      const nm = queue.current[next];
      // Gepuffert heißt: der Vorlade-Player hält genau diesen Moment schon angehalten am Start
      // Ein Stream-Moment (Podcast, Vorrat) hält angehalten im Zustand CUED und gilt als geladen, sobald das erste Bild Daten hat
      const ready = !single && !!nm && target.ready && target.mid === nm.id && (target.st === STATE.PAUSED || (target.st === STATE.CUED && !!target.player?.isBuffered?.()));
      swipe.current = { j: next, t0: performance.now(), buffered: ready };
      const play = !textRef.current;
      if (single) assign(slots.current[0], next, play);
      else {
        assign(slotFor(next), next, play);
        for (const j of [next + 1, next + 2]) if (slotFor(j).index !== j) assign(slotFor(j), j, false);
      }
      // Im Hintergrund zählt erst das Ende (finish), bei der Rückkehr der laufende Moment
      if (!textRef.current && countsSeenAtStart(isBackground(document.visibilityState))) markSeen(queue.current[next]);
      textSeen.current = -1;
      if (textBox.current) textBox.current.scrollTop = 0;
      if (!textRef.current) soundGuard(next);
      if (recallNow && isBackground(document.visibilityState)) {
        // Abrufkarte erst bei der Rückkehr, sonst bliebe der Ton im Hintergrund stehen
        pendingRecall.current = recallNow;
        recallNow = null;
      }
      if (recallNow) {
        const rm = findMoment(recallNow.id);
        if (rm) {
          recallRef.current = true;
          recallAnswered.current = false;
          current().player?.pauseVideo();
          setRecall({ m: rm, review: recallNow.review });
        }
      }
      setIdx(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ensureQueue, assign, single],
  );

  skipRef.current = () => goTo(idxRef.current + 1);

  /** Moment bis end geschaut: Signal, dann Für dich (falls gesetzt) oder direkt weiter */
  const finish = useCallback(() => {
    if (endedAt.current === idxRef.current) return;
    endedAt.current = idxRef.current;
    const m = queue.current[idxRef.current];
    current().player?.pauseVideo();
    if (!m) return;
    log(m, { ended: true });
    update((s) => ({ ...s, momentWeights: signal(s.momentWeights, m, SIGNAL.ended, clockNow().getTime()) }));
    const bg = isBackground(document.visibilityState);
    // Gesehen zählt beim Ende, höchstens einmal je Moment (auch nach der Rückkehr)
    if (ledger.current.first(m.id)) {
      if (bg) diag.current.push(`bg: ended ${m.id}`);
      markSeen(m);
    }
    if (atEnd(formOf(m), bg) === 'stop') {
      // Video-Reiter im Hintergrund: der Moment lief zu Ende, kein Auto-Weiter
      diag.current.push(`bg: stop after ${m.id}`);
      return;
    }
    if (bg) {
      // Auto-Weiter im Hintergrund: derselbe Weg wie der Wisch, ohne Für-dich-Karte. Gelingt der Start nicht, hält der Feed sauber an.
      const j = idxRef.current + 1;
      goTo(j);
      const nm = queue.current[idxRef.current];
      diag.current.push(idxRef.current === j && nm ? `bg: next ${nm.id}` : `bg: stalled at ${m.id} (no next)`);
      if (idxRef.current === j) {
        window.setTimeout(() => {
          if (!isBackground(document.visibilityState) || idxRef.current !== j || userPaused.current || current().st === STATE.PLAYING) return;
          diag.current.push(`bg: stalled at ${queue.current[j]?.id}`);
          current().player?.pauseVideo();
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
        }, BG_STALL_MS);
      }
    } else if (m.forYou) {
      forYouRef.current = true;
      setForYou(m);
      forYouTimer.current = window.setTimeout(() => goTo(idxRef.current + 1), FOR_YOU_MS);
    } else goTo(idxRef.current + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTo]);

  /**
   * Rest der Warteschlange ab from neu planen (Netz wurde schlecht): Die freigegebenen Momente stehen wieder zur Wahl,
   * nextMomentBlock füllt mit Rang auf (vorgeladen und Text zuerst, YouTube zuletzt). Blöcke, Anteile und Lernen bleiben wie sonst.
   */
  const replanTail = (from: number) => {
    const tail = queue.current.slice(from);
    if (!tail.length || !cursor.current) return;
    releaseTail(cursor.current, tail);
    queue.current = queue.current.slice(0, from);
    for (const sl of slots.current) if (sl.index >= from) sl.index = -1;
    ensureQueue(from + tail.length);
    if (!single) for (const j of [idxRef.current + 1, idxRef.current + 2]) if (j >= from && j < queue.current.length && slotFor(j).index !== j) assign(slotFor(j), j, false);
    diag.current.push(`replan from ${from} poor=${poorRef.current}`);
    syncPre(idxRef.current);
    rerender();
  };
  /** Mitten in der Sitzung: nur umsortieren (siehe reorderByRank), die schon vorgeladenen Momente bleiben in der Warteschlange */
  const reorderTail = (from: number) => {
    if (!pre) return;
    const tail = queue.current.slice(from);
    if (tail.length < 2) return;
    queue.current = [...queue.current.slice(0, from), ...reorderByRank(tail, netRank(pre.has))];
    for (const sl of slots.current) if (sl.index >= from) sl.index = -1;
    if (!single) for (const j of [idxRef.current + 1, idxRef.current + 2]) if (j >= from && j < queue.current.length && slotFor(j).index !== j) assign(slotFor(j), j, false);
    diag.current.push(`reorder from ${from}`);
    syncPre(idxRef.current);
    rerender();
  };
  const replanRef = useRef(replanTail);
  replanRef.current = replanTail;
  const reorderRef = useRef(reorderTail);
  reorderRef.current = reorderTail;

  /** Nach dem Wechsel von Stub zu echter YouTube-API: gesperrte YouTube-Momente wieder zulassen, Player neu anlegen */
  const ytBack = () => {
    if (!ytStub.current) return;
    ytStub.current = false;
    for (const id of [...bad.current]) if (isYtId(id)) bad.current.delete(id);
    setYtEpoch((e) => e + 1);
  };

  // Player anlegen
  useEffect(() => {
    let cancelled = false;
    ensureQueue(QUEUE_AHEAD);
    if (!queue.current.length) return;
    const begin = (YT: Awaited<ReturnType<typeof loadYT>>) => {
        if (cancelled) return;
        const failedCurrent: number[] = [];
        for (let s = 0; s < SLOTS; s++) {
          const slot = slots.current[s];
          const base = idxRef.current;
          const j = single ? base : base + ((((s - base) % 3) + 3) % 3);
          const m = queue.current[j];
          if (!slot.host || !m) continue;
          slot.index = j;
          slot.mid = '';
          const mount = (id: string) => {
            const target = document.createElement('div');
            slot.host!.replaceChildren(target);
            return createPlayer(YT, target, id, {
              onReady: () => {
                slot.ready = true;
                slot.player!.mute();
                assign(slot, slot.index, slot.index === idxRef.current && !textRef.current);
                if (slot.index === idxRef.current && !textRef.current && countsSeenAtStart(isBackground(document.visibilityState))) markSeen(queue.current[slot.index]);
                rerender();
              },
              onState: (st) => {
                diag.current.push(`slot${s} ${slot.mid} state ${st}`);
                slot.st = st;
                // Vorschaubild bleibt bis zum ersten Bild: ohne Umweg über React, damit kein Frame der YouTube-Oberfläche durchrutscht
                slot.el?.toggleAttribute('data-live', st === STATE.PLAYING);
                if (st === STATE.PLAYING) everPlayed.current = true;
                if (st === STATE.PLAYING && slot.index === idxRef.current && isBackground(document.visibilityState) && !bgStarted.current.has(slot.mid)) {
                  bgStarted.current.add(slot.mid);
                  diag.current.push(`bg: started ${slot.mid}`);
                }
                if (slot.index === idxRef.current && msOnRef.current && 'mediaSession' in navigator) {
                  if (st === STATE.PLAYING) navigator.mediaSession.playbackState = 'playing';
                  else if (st === STATE.PAUSED || st === STATE.ENDED) navigator.mediaSession.playbackState = 'paused';
                }
                const sw = swipe.current;
                if (st === STATE.PLAYING && sw && slot.index === sw.j && sw.j === idxRef.current) {
                  swipe.current = null;
                  const ms = Math.round(performance.now() - sw.t0);
                  diag.current.push(`first-frame ${ms}ms ${sw.buffered ? 'buffered' : 'cold'}${slot.player?.isLocal?.() ? ' local' : ''}`);
                  pre?.recordStart(ms, sw.buffered);
                  update((x) => ({ ...x, playLatency: addSample(x.playLatency, { ms, buffered: sw.buffered, at: Date.now() }) }));
                }
                // Standardtempo nach Fundament-Regel 11 (1,5x), gehaltenes 2x bleibt bis zum Loslassen
                if (st === STATE.PLAYING && !fastRef.current) slot.player?.setPlaybackRate(clampRate(rateRef.current));
                if (st === STATE.ENDED && slot.index === idxRef.current) finish();
                if (st === STATE.PLAYING && (slot.index !== idxRef.current || forYouRef.current || textRef.current || recallRef.current)) slot.player?.pauseVideo();
                rerender();
              },
              onError: (code) => {
                const m2 = queue.current[slot.index];
                diag.current.push(`slot${s} ${slot.mid} error ${code}`);
                if (m2) bad.current.add(m2.videoId);
                // Einzelne Fehler überspringen nur. Die Fehlerseite gibt es erst, wenn nie ein Video lief und acht Momente scheiterten.
                if (!everPlayed.current && bad.current.size >= 8) setError(`YouTube spielt gerade keine Videos ab (Fehler ${code})`);
                else if (slot.index === idxRef.current) goTo(idxRef.current + 1);
              },
            });
          };
          try {
            slot.player = mount(m.videoId);
          } catch (e) {
            // Der Player eines Moments ließ sich nicht anlegen: Moment merken und überspringen, Slot neutral neu bauen
            diag.current.push(`slot${s} ${m.id} player failed ${e instanceof Error ? e.message : String(e)}`);
            bad.current.add(m.videoId);
            try {
              slot.player = mount('');
            } catch (e2) {
              slot.player = null;
              diag.current.push(`slot${s} player failed again ${e2 instanceof Error ? e2.message : String(e2)}`);
            }
            if (j === idxRef.current) failedCurrent.push(j);
          }
        }
        if (failedCurrent.length) goTo(idxRef.current + 1);
    };
    void (async () => {
      if (pre) {
        // Vorrat gelesen: war das Netz schon beim Start schlecht (offline), kommen Vorgeladene und Text zuerst
        await pre.whenReady();
        poorRef.current = pre.poor();
        if (poorRef.current && idxRef.current === 0) replanRef.current(0);
        syncPre(idxRef.current);
        // Die nächsten Momente als Blob-URL bereit, bevor die Player ihre Quelle bekommen (höchstens 300 ms warten)
        await Promise.race([pre.warm(pre.warmSet(queue.current, idxRef.current)), new Promise<void>((r) => window.setTimeout(r, 300))]);
      }
      if (cancelled) return;
      // Ohne erreichbare YouTube-API (offline, blockiert) laufen Streams, Podcasts und Text trotzdem. Es gibt keine Fehlerseite mehr.
      const ready = loadYT();
      let YT: Awaited<ReturnType<typeof loadYT>> | null = null;
      try {
        YT = poorRef.current ? await Promise.race([ready, new Promise<null>((r) => window.setTimeout(() => r(null), 4000))]) : await ready;
      } catch {
        YT = null;
      }
      if (cancelled) return;
      if (YT) ytStub.current = false;
      else {
        ytStub.current = true;
        diag.current.push('yt stub');
        YT = offlineYT();
        ready.then(() => !cancelled && ytBack(), () => {});
      }
      begin(YT);
    })();
    return () => {
      cancelled = true;
      for (const s of slots.current) {
        s.player?.destroy();
        s.el?.removeAttribute('data-live');
        Object.assign(s, { player: null, ready: false, index: -1, st: STATE.UNSTARTED, mid: '' });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, pool.length > 0, ytEpoch]);

  // Netz: offline-Symbol, schlechtes Netz erkennen (offline oder die letzten Starts langsam), YouTube-API nachladen, sobald es wieder geht
  useEffect(() => {
    const check = () => {
      if (!pre) return;
      const poor = pre.poor();
      if (poor === poorRef.current) return;
      poorRef.current = poor;
      diag.current.push(`net poor=${poor}`);
      // Beim Wechsel ins schlechte Netz den Rest umsortieren, höchstens alle 20 s. Der Rückweg ändert nichts (kein Hin und Her).
      if (poor && Date.now() - lastReplan.current > 20_000) {
        lastReplan.current = Date.now();
        reorderRef.current(idxRef.current + 1);
      }
    };
    const onNet = () => {
      setOnline(navigator.onLine);
      check();
      if (navigator.onLine && ytStub.current) loadYT().then(() => ytBack(), () => {});
    };
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    const off = pre?.subscribe(check);
    check();
    return () => {
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pre]);

  // Ende genau bei end (Polling zusätzlich zu endSeconds), Fortschritt, Feed-Zeit
  useEffect(() => {
    let flushed = 0;
    const t = window.setInterval(() => {
      const sl = current();
      const p = sl.player;
      const m = queue.current[idxRef.current];
      if (!p || !sl.ready || !m || forYouRef.current || textRef.current || recallRef.current) return;
      const c = p.getCurrentTime?.() ?? 0;
      // Laden sichtbar machen, hängende Momente überspringen
      if (sl.st === STATE.PLAYING || userPaused.current) {
        waitSince.current = 0;
        setLoading(false);
      } else {
        waitSince.current ||= Date.now();
        const waited = Date.now() - waitSince.current;
        setLoading(waited > 400);
        // Nur wenn in dieser Sitzung schon etwas lief (sonst blockiert z.B. der Stromsparmodus Autoplay und alles würde übersprungen)
        if (everPlayed.current && waited > 12_000 && c < m.start + 1) {
          diag.current.push(`watchdog ${m.id}`);
          bad.current.add(m.videoId);
          waitSince.current = 0;
          goTo(idxRef.current + 1);
          return;
        }
      }
      if (sl.st === STATE.PLAYING || sl.st === STATE.PAUSED) {
        setProgress(Math.min(1, Math.max(0, (c - m.start) / (m.end - m.start))));
        const rel = c - m.start;
        let cue = '';
        if (m.cues) for (const [t, text] of m.cues) if (t <= rel + 0.1) cue = text; else break;
        setCaption(cue);
      }
      if (sl.st === STATE.PLAYING && c >= m.end - END_GUARD) finish();
      if (sl.st === STATE.PLAYING && document.visibilityState === 'visible') {
        feedMs.current += POLL_MS;
        if (feedMs.current - flushed >= 10_000) {
          const add = feedMs.current - flushed;
          flushed = feedMs.current;
          update((s) => ({ ...s, feedTime: { ...s.feedTime, [today]: (s.feedTime[today] ?? 0) + add } }));
        }
      }
    }, POLL_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish, today]);

  useEffect(() => {
    if (!active) current().player?.pauseVideo();
    else if (!userPaused.current && !forYouRef.current && !textRef.current && !recallRef.current) current().player?.playVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => onPausedChange(paused), [paused, onPausedChange]);

  // Formwechsel: Text hält den Player an, Video und Audio spielen weiter
  useEffect(() => {
    const p = current().player;
    if (form === 'text') {
      p?.pauseVideo();
      setCaption('');
      checkTextEnd();
    } else if (active && !userPaused.current && !forYouRef.current) {
      p?.playVideo();
      markSeen(queue.current[idxRef.current]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  /** Textmodus: gesehen erst, wenn das Ende des Textes sichtbar ist */
  const checkTextEnd = () => {
    const el = textBox.current;
    if (!textRef.current || !el || textSeen.current === idxRef.current) return;
    if (textEndReached(el.scrollTop, el.clientHeight, el.scrollHeight)) {
      textSeen.current = idxRef.current;
      markSeen(queue.current[idxRef.current]);
    }
  };
  useEffect(() => {
    if (form !== 'text') return;
    const t = window.setTimeout(checkTextEnd, 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, form]);

  const setForm = (f: Form) => update((s) => ({ ...s, settings: { ...s.settings, form: f } }));
  // Text: Wischen wechselt erst am Textende (oben am Anfang zurück), sonst scrollt der Text
  const tt = useRef({ x: 0, y: 0, top: false, end: false });

  // ---- Gesten ----
  const g = useRef({ x: 0, y: 0, t: 0, moved: false, long: 0, fired: false, tap: 0, lastUp: 0, dx: 0, dy: 0 });
  const setDrag = (px: number) => {
    dragEl.current?.style.setProperty('--drag', `${px}px`);
    if (!px) dragEl.current?.removeAttribute('data-drag');
  };

  const togglePlay = () => {
    if (textRef.current) return;
    const p = current().player;
    if (!p) return;
    if (!soundOn.current) {
      soundOn.current = true;
      for (const s of slots.current) s.player?.unMute();
      p.playVideo();
      userPaused.current = false;
      setPaused(false);
      soundSeenOn = true;
      setHint(false);
      return;
    }
    if (current().st === STATE.PLAYING) {
      p.pauseVideo();
      userPaused.current = true;
      setPaused(true);
    } else {
      p.playVideo();
      userPaused.current = false;
      setPaused(false);
    }
  };

  const confirm = (name: string) => {
    setPulse(name);
    window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setPulse(''), CONFIRM_MS);
  };

  /** Tipp bis Füllung: vom Ereignis bis zum ersten Bild nach dem Umschalten, Anzeige in Settings unter Player */
  const recordTap = (t0: number) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const ms = Math.max(0, Math.round(performance.now() - t0));
        update((s) => ({ ...s, tapMs: addTap(s.tapMs, { ms, at: Date.now() }) }));
      }),
    );

  const showHeart = (x: number, y: number) => {
    window.clearTimeout(heartTimer.current);
    setHeart({ x, y, k: Date.now() });
    heartTimer.current = window.setTimeout(() => setHeart(null), HEART_MS);
  };

  /** More like this: Doppeltipp (Herz an der Tippstelle) und Knopf haben dieselbe Wirkung. Der Knopf schaltet um. */
  const like = (via: 'double' | 'button', at?: { x: number; y: number }) => {
    const m = queue.current[idxRef.current];
    if (!m) return;
    const was = !!stateRef.current.momentLiked?.[m.id];
    const on = nextLiked(was, via);
    if (at) showHeart(at.x, at.y);
    if (on === was) return;
    navigator.vibrate?.(on ? 15 : 8);
    update((s) => {
      const liked = { ...(s.momentLiked ?? {}) };
      if (on) liked[m.id] = Date.now();
      else delete liked[m.id];
      return { ...s, momentLiked: liked, momentWeights: signal(s.momentWeights, m, on ? SIGNAL.more : 1 / SIGNAL.more, clockNow().getTime()) };
    });
    if (on) log(m, { feedback: 'mehr' });
  };
  const likeAt = (clientX: number, clientY: number) => {
    const r = dragEl.current?.getBoundingClientRect();
    like('double', { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) });
  };

  /** Save nur über die Spalte. Der Knopf füllt sich, ein zweiter Tipp nimmt zurück. */
  const toggleSave = () => {
    const m = queue.current[idxRef.current];
    if (!m) return;
    navigator.vibrate?.(10);
    if (!stateRef.current.savedMoments[m.id]) {
      update((s) => ({ ...s, savedMoments: { ...s.savedMoments, [m.id]: { moment: m, savedAt: new Date().toISOString() } }, momentWeights: signal(s.momentWeights, m, SIGNAL.save, clockNow().getTime()) }));
      return;
    }
    update((s) => {
      const x = { ...s.savedMoments };
      delete x[m.id];
      return { ...s, savedMoments: x };
    });
  };

  /** Log-Eintrag je Effekt (Wochenrückblick zählt schwach und falsch) */
  const FEEDBACK_OF: Record<Effect, Feedback | null> = { known: 'kenne', wrong: 'falsch', notForMe: 'schwach', weak: 'schwach', mute: null };

  /**
   * Rückmeldung: ein Tipp auf einen Chip speichert und lernt sofort lokal (learn.ts). Das Blatt bleibt kurz offen und zeigt eine
   * Bestätigungszeile ("Less Barbell Medicine"), dann schließt es und der Feed geht zum nächsten Moment. Done speichert nur den Text
   * und schließt sofort. Es gibt keinen Netzwerkaufruf und keinen Send-Knopf.
   */
  const saveNote = (m: Moment, chip: Chip | null, text: string) => {
    const entry = makeEntry({ id: m.id, hook: m.hook, tab: FORM_LABEL[form], commit: __APP_COMMIT__ }, chip ? [chip] : [], text, Date.now());
    if (!chip) {
      setNote(null);
      if (!entry) return;
      navigator.vibrate?.(10);
      update((s) => ({ ...s, feedbackNotes: [...(s.feedbackNotes ?? []), entry] }));
      if (m === queue.current[idxRef.current]) goTo(idxRef.current + 1);
      return;
    }
    // Zweiter Tipp während die Bestätigung steht: nichts doppelt lernen
    if (confirmRef.current || !entry) return;
    navigator.vibrate?.(15);
    const fx = chipEffect(chip);
    const at = clockNow().getTime();
    update((s) => ({
      ...s,
      feedbackNotes: [...(s.feedbackNotes ?? []), entry],
      momentWeights: fx ? applyEffect(s.momentWeights, fx, m, at) : s.momentWeights,
      skipRun: undefined,
    }));
    if (fx && FEEDBACK_OF[fx]) log(m, { feedback: FEEDBACK_OF[fx]! });
    if (fx === 'mute') muteChannel(m);
    if (fx === 'notForMe') dropTopic(m);
    setConfirm(confirmLine(fx, m));
    confirmRef.current = true;
    const done = () => {
      window.clearTimeout(confirmTimer.current);
      if (!confirmRef.current) return;
      confirmRef.current = false;
      setConfirm(null);
      setNote(null);
      if (m === queue.current[idxRef.current]) {
        silentLeave.current = true;
        goTo(idxRef.current + 1);
        silentLeave.current = false;
      }
    };
    confirmDone.current = done;
    confirmTimer.current = window.setTimeout(done, CONFIRM_SHEET_MS);
  };

  /** Blatt schließen (Tipp daneben, Esc): während die Bestätigung steht, geht der Feed trotzdem weiter */
  const cancelNote = () => {
    if (confirmRef.current) confirmDone.current();
    else setNote(null);
  };

  /** Ein einziges vorausgefülltes Issue in core-content aus allen ungesendeten Notizen, danach gelten sie als gesendet */
  const sendNotes = () => {
    const b = buildIssue(unsent(stateRef.current.feedbackNotes), today);
    if (!b) return;
    window.open(b.url, '_blank', 'noopener');
    update((s) => ({ ...s, feedbackNotes: markSent(s.feedbackNotes, b.keys, Date.now()) }));
  };

  /** Sprecher stumm: ab sofort nie mehr in der Warteschlange. Der Feed geht erst nach der Bestätigungszeile weiter (saveNote). */
  const muteChannel = (m: Moment) => {
    update((s) => ({ ...s, mutedChannels: { ...s.mutedChannels, [m.channel]: m.channel } }));
    stateRef.current = { ...stateRef.current, mutedChannels: { ...stateRef.current.mutedChannels, [m.channel]: m.channel } };
    const keep = queue.current.slice(0, idxRef.current + 1);
    queue.current = [...keep, ...queue.current.slice(idxRef.current + 1).filter((x) => x.channel !== m.channel)];
    for (const sl of slots.current) if (sl.index > idxRef.current) sl.index = -1;
  };

  /** Not for me: Momente desselben Themas fliegen sofort aus der tiefen Warteschlange, sonst hätte die Wertung viele Wischer lang keine Wirkung */
  const dropTopic = (m: Moment) => {
    const keep = queue.current.slice(0, idxRef.current + 1);
    queue.current = [...keep, ...queue.current.slice(idxRef.current + 1).filter((x) => x.topic !== m.topic)];
    for (const sl of slots.current) if (sl.index > idxRef.current) sl.index = -1;
  };

  const openFull = () => {
    const m = queue.current[idxRef.current];
    if (!m) return;
    confirm('source');
    current().player?.pauseVideo();
    userPaused.current = true;
    setPaused(true);
    // Öffnet die Quelle (YouTube-App, Podcast-Seite oder Artikel). Ohne Quelle passiert nichts.
    const href = fullVideoUrl(m);
    if (href) window.open(href, '_blank', 'noopener');
  };

  const onDown = (e: React.PointerEvent) => {
    const r = g.current;
    Object.assign(r, { x: e.clientX, y: e.clientY, t: Date.now(), moved: false, fired: false, dx: 0, dy: 0 });
    window.clearTimeout(r.long);
    r.long = window.setTimeout(() => {
      r.fired = true;
      navigator.vibrate?.(10);
      current().player?.setPlaybackRate(clampRate(HOLD_SPEED));
      fastRef.current = true;
      setFast(true);
    }, LONG_MS);
  };
  const onMove = (e: React.PointerEvent) => {
    const r = g.current;
    if (!r.t) return;
    r.dx = e.clientX - r.x;
    r.dy = e.clientY - r.y;
    if (Math.abs(r.dy) > 10 || Math.abs(r.dx) > 10) {
      r.moved = true;
      window.clearTimeout(r.long);
    }
    // Waagerechter Zug verschiebt den Feed nicht
    if (r.moved && !single && Math.abs(r.dy) >= Math.abs(r.dx)) {
      dragEl.current?.setAttribute('data-drag', '1');
      setDrag(r.dy);
    }
  };
  const onUp = () => {
    const r = g.current;
    window.clearTimeout(r.long);
    const wasDown = r.t;
    r.t = 0;
    if (r.fired) {
      r.fired = false;
      endFast();
      return;
    }
    if (!wasDown) return;
    // Jede erste Berührung (auch ein Wisch) gilt dem Browser als Geste: Ton sofort freischalten, damit nach einem
    // Neuladen der PWA nie ein Tipp nur für den Ton nötig ist und der Hinweis nicht zurückkommt (Max, 29.10.).
    const firstTouch = !soundOn.current && !textRef.current;
    if (firstTouch) {
      soundOn.current = true;
      for (const s of slots.current) s.player?.unMute();
      soundSeenOn = true;
      setHint(false);
    }
    if (r.moved) {
      setDrag(0);
      const sw = swipeOf(r.dx, r.dy);
      if (sw === 'next') goTo(idxRef.current + 1);
      else if (sw === 'prev') goTo(idxRef.current - 1);
      else if (sw === 'note') openNote();
      return;
    }
    // Ein Tipp, der nur den Ton freischaltet, pausiert nicht und zählt nicht als Doppeltipp (wie vor dem Freischalten bei jeder Berührung)
    if (firstTouch) {
      const p = current().player;
      if (p) p.playVideo();
      userPaused.current = false;
      setPaused(false);
      return;
    }
    const t = Date.now();
    if (t - r.lastUp < TAP_MS) {
      window.clearTimeout(r.tap);
      r.lastUp = 0;
      likeAt(r.x, r.y);
      return;
    }
    r.lastUp = t;
    if (!soundOn.current) {
      togglePlay();
      return;
    }
    r.tap = window.setTimeout(togglePlay, TAP_MS);
  };

  /** Wisch nach links: Blatt für den aktuellen Moment, nicht über Abrufkarte oder For-you-Karte */
  const openNote = () => {
    const m = queue.current[idxRef.current];
    if (!m || forYouRef.current || recallRef.current || noteRef.current) return;
    navigator.vibrate?.(10);
    setNote(m);
  };

  // Beim ersten Öffnen am Tag, wenn ungesendete Notizen vorliegen: Zeile "N notes, send?"
  useEffect(() => {
    if (!active || promptChecked.current) return;
    promptChecked.current = true;
    const s = stateRef.current;
    if (!firstOpenOfDay(s.notesPromptDay, today)) return;
    update((st) => ({ ...st, notesPromptDay: today }));
    if (unsent(s.feedbackNotes).length > 0) setPrompt(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ---- Desktop ab 900 px (Auftrag 28.10.2026). Mobil ist alles unten ohne Wirkung, solange desk fehlt. ----
  const capRef = useRef(false);
  capRef.current = capOpen;

  /** Abspielen oder anhalten, ohne den Ton zu berühren (anders als der erste Tipp mobil) */
  const setPlaying = (want: boolean) => {
    if (textRef.current) return;
    const p = current().player;
    if (!p) return;
    if (want) {
      p.playVideo();
      userPaused.current = false;
      setPaused(false);
    } else {
      p.pauseVideo();
      userPaused.current = true;
      setPaused(true);
    }
  };
  playRef.current = setPlaying;
  const togglePause = () => setPlaying(userPaused.current || current().st !== STATE.PLAYING);

  /** M: Ton an oder aus. Die Taste ist selbst die Geste, die der Browser für den Ton verlangt. */
  const toggleMute = () => {
    if (textRef.current) return;
    const on = !soundOn.current;
    soundOn.current = on;
    for (const sl of slots.current) {
      if (on) sl.player?.unMute();
      else sl.player?.mute();
    }
    soundSeenOn = true;
    setHint(false);
    show(on ? 'Sound on' : 'Muted');
  };

  /** Shift+. gehalten: 2x bis zum Loslassen, nie darüber (Regel 11) */
  const startFast = () => {
    if (fastRef.current || textRef.current) return;
    current().player?.setPlaybackRate(clampRate(HOLD_SPEED));
    fastRef.current = true;
    setFast(true);
  };

  /** Esc schließt die oberste Ebene: Übersicht, Seitenblatt, Rückmeldung, Abrufkarte (ohne Wertung), Caption */
  const closeTop = () => {
    const d = deskRef.current;
    if (!d) return;
    if (d.help) d.onHelp();
    else if (d.sheet) d.onCloseSheet();
    else if (noteRef.current) cancelNote();
    else if (recallRef.current) closeRecall();
    else if (capRef.current) setCapOpen(false);
  };

  const run = (a: DeskAction) => {
    const d = deskRef.current;
    if (!d) return;
    if (a.startsWith('tab')) {
      const f = TAB_KEYS[Number(a.slice(3)) - 1];
      if (f && f !== form) setForm(f);
      return;
    }
    if (a.startsWith('chip')) return noteCtl.current?.chip(Number(a.slice(4)) - 1);
    if (a.startsWith('pick')) return recallCtl.current?.pick(Number(a.slice(4)) - 1);
    switch (a) {
      case 'next':
        return goTo(idxRef.current + 1);
      case 'prev':
        return goTo(idxRef.current - 1);
      case 'pause':
        return togglePause();
      case 'mute':
        return toggleMute();
      case 'like':
        return like('button');
      case 'save':
        return toggleSave();
      case 'source':
        return openFull();
      case 'note':
        return openNote();
      case 'caption':
        return setCapOpen((o) => !o);
      case 'fastOn':
        keyFast.current = true;
        return startFast();
      case 'noteText':
        return noteCtl.current?.focusText();
      case 'recallNext':
        return closeRecall();
      case 'help':
        return d.onHelp();
      case 'close':
        return closeTop();
    }
  };
  actRef.current = run;

  useEffect(() => {
    const typingIn = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const key = (e: KeyboardEvent) => {
      const d = deskRef.current;
      if (!d) {
        // Mobil mit Hardware-Tastatur wie bisher
        if (!active || noteRef.current) return;
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return;
        if (e.key === 'ArrowDown' || e.key === 'j') goTo(idxRef.current + 1);
        if (e.key === 'ArrowUp' || e.key === 'k') goTo(idxRef.current - 1);
        if (e.key === ' ') togglePlay();
        return;
      }
      const a = deskKey(
        { typing: typingIn(e.target), help: d.help, sheet: d.sheet, note: !!noteRef.current, recall: recallRef.current ? (recallAnswered.current ? 'answered' : 'open') : null },
        { key: e.key, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey },
      );
      if (!a) return;
      // Die Taste gehört dem Feed: kein Klick auf einen fokussierten Knopf, kein Scrollen
      e.preventDefault();
      if (a === 'pause' && e.code === 'Space') spaceHandled.current = true;
      if (e.repeat && a !== 'fastOn') return;
      actRef.current(a);
    };
    const up = (e: KeyboardEvent) => {
      if (!deskRef.current) return;
      if (keyFast.current && endsFast(e)) {
        keyFast.current = false;
        endFast();
      }
      if (e.code === 'Space' && spaceHandled.current) {
        spaceHandled.current = false;
        e.preventDefault();
      }
    };
    const blur = () => {
      if (!keyFast.current) return;
      keyFast.current = false;
      endFast();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, goTo]);

  // Trackpad und Mausrad: zwei Finger senkrecht blättert (ein Wisch, ein Schritt), zwei Finger nach links öffnet die Rückmeldung
  useEffect(() => {
    if (!desk) return;
    const wheel = createWheel();
    const onWheel = (e: WheelEvent) => {
      const d = deskRef.current;
      if (!d || e.ctrlKey) return;
      const target = e.target as HTMLElement | null;
      // Panel, Leiste, Seitenblatt und Übersicht scrollen selbst
      if (target?.closest?.('[data-nowheel]')) return;
      if (!active || d.help || d.sheet || noteRef.current || recallRef.current) return;
      const { dx, dy } = wheelPx(e, window.innerHeight);
      const box = textRef.current ? textBox.current : null;
      const edge = box ? { top: box.scrollTop <= 0, end: textEndReached(box.scrollTop, box.clientHeight, box.scrollHeight) } : undefined;
      const out = wheel.feed({ dx, dy, t: e.timeStamp }, edge);
      if (out.consume) e.preventDefault();
      else if (box && !box.contains(target)) {
        // Zeiger neben dem Text: der Text scrollt trotzdem
        box.scrollTop += dy;
        e.preventDefault();
      }
      if (out.act === 'next') goTo(idxRef.current + 1);
      else if (out.act === 'prev') goTo(idxRef.current - 1);
      else if (out.act === 'note') openNote();
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!desk, active, goTo]);

  // Seite verlassen oder zurück (Entscheidung 13). Eigene Streams spielen weiter, YouTube und Text halten an.
  visRef.current = (vis) => {
    if (!active) return;
    const m = queue.current[idxRef.current];
    if (!m) return;
    const playable = !textRef.current && !forYouRef.current && !recallRef.current;
    if (isBackground(vis)) {
      diag.current.push(`bg: left ${m.id}`);
      if (playable && onLeave(formOf(m), !HLS.has(m.videoId)) === 'pause' && !userPaused.current) {
        current().player?.pauseVideo();
        leftPaused.current = true;
      }
      return;
    }
    diag.current.push(`bg: back ${m.id}`);
    // Der laufende Moment ist jetzt zu sehen: gesehen (einmal), dann Karte oder Ton wieder aufnehmen
    if (!textRef.current) markSeen(m);
    const pr = pendingRecall.current;
    if (pr) {
      pendingRecall.current = null;
      const rm = findMoment(pr.id);
      if (rm) {
        recallRef.current = true;
        recallAnswered.current = false;
        current().player?.pauseVideo();
        setRecall({ m: rm, review: pr.review });
        leftPaused.current = false;
        return;
      }
    }
    const wasLeft = leftPaused.current;
    leftPaused.current = false;
    if (!playable || userPaused.current || endedAt.current === idxRef.current) return;
    // Angehalten beim Verlassen, vom Betriebssystem pausiert oder im Hintergrund nicht gestartet: weiter am Stand
    if (wasLeft || current().st !== STATE.PLAYING) current().player?.playVideo();
  };
  useEffect(() => {
    const on = () => visRef.current(document.visibilityState);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // Fenstertitel (Desktop) und Medien-Anzeige des Betriebssystems: am Desktop immer, mobil im Audio-Reiter (Sperrbildschirm)
  const msOn = !!desk || form === 'audio';
  msOnRef.current = msOn;
  const curId = queue.current[idx]?.id;
  useEffect(() => {
    if (!msOn) return;
    const cur = queue.current[idx];
    if (desk) document.title = cur ? cur.hook : 'core';
    if (cur && 'mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({ title: cur.hook, artist: speakerLine(cur.channel), album: AREA_LABEL[cur.area], artwork: [{ src: thumbOf(cur) }] });
    }
    return () => {
      if (desk) document.title = 'core';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msOn, !!desk, curId]);

  // Medientasten und Sperrbildschirm: Pause, Weiter und Zurück (Weiter vom Sperrbildschirm zählt wie ein Wisch)
  useEffect(() => {
    if (!msOn || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a: MediaSessionAction, f: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(a, f);
      } catch {
        /* Aktion nicht unterstützt */
      }
    };
    set('play', () => playRef.current(true));
    set('pause', () => playRef.current(false));
    set('nexttrack', () => goTo(idxRef.current + 1));
    set('previoustrack', () => goTo(idxRef.current - 1));
    return () => {
      for (const a of ['play', 'pause', 'nexttrack', 'previoustrack'] as MediaSessionAction[]) set(a, null);
    };
  }, [msOn, goTo]);
  useEffect(() => {
    if (msOn && 'mediaSession' in navigator) navigator.mediaSession.playbackState = paused ? 'paused' : 'playing';
  }, [msOn, paused]);

  // Test-Hook für Playwright (liest nur App-Zustand, nicht den Cross-Origin-Player)
  useEffect(() => {
    (window as unknown as { __core?: unknown }).__core = {
      idx: () => idxRef.current,
      moment: () => queue.current[idxRef.current],
      state: () => current().st,
      time: () => current().player?.getCurrentTime?.() ?? 0,
      forYou: () => forYouRef.current,
      next: () => goTo(idxRef.current + 1),
      // Setzt die Schauzeit des laufenden Moments auf null (Tests prüfen die 3-Sekunden-Regel, ohne von der Geschwindigkeit des Runners abzuhängen)
      markStart: () => { since.current = Date.now(); },
      diag: () => diag.current.slice(-40),
      diagAll: () => diag.current.filter((x) => /^(replan|reorder|net poor|yt stub|first-frame)/.test(x)),
      slots: () => slots.current.slice(0, SLOTS).map((x) => ({ st: x.st, index: x.index })),
      latency: () => stateRef.current.playLatency ?? [],
      seen: (id: string) => !!stateRef.current.momentSeen[id],
      liked: (id: string) => !!stateRef.current.momentLiked?.[id],
      saved: (id: string) => !!stateRef.current.savedMoments[id],
      tapMs: () => stateRef.current.tapMs ?? [],
      skipRecall: () => closeRecall(),
      sound: () => soundOn.current,
      fast: () => fastRef.current,
      closeCaption: () => setCapOpen(false),
      notes: () => stateRef.current.feedbackNotes ?? [],
      weights: () => stateRef.current.momentWeights,
      skipRun: () => stateRef.current.skipRun ?? null,
      openNote: () => openNote(),
      recall: () => ({ open: recallRef.current, state: stateRef.current.recall ?? {}, sessionSeen: sessionSeen.current }),
      queue: () => queue.current.map((x) => x.id),
      preload: () => ({ ids: pre?.ids() ?? [], stats: pre?.stats() ?? { n: 0, bytes: 0 }, poor: poorRef.current, log: pre?.log.slice(-200) ?? [], net: pre?.netSamples() ?? [], local: slots.current.slice(0, SLOTS).map((x) => !!x.player?.isLocal?.()) }),
    };
  });

  if (pool.length && !queue.current.length) ensureQueue(QUEUE_AHEAD);

  useLayoutEffect(() => {
    // Hook nie kürzen: mehr als drei Zeilen in Normalgröße, dann eine Stufe kleiner
    const el = hookEl.current;
    if (!el) return;
    el.dataset.step = '0';
    el.dataset.step = String(hookStep(Math.round(el.scrollHeight / HOOK_LINE_PT[0])));
  }, [queue.current[idx]?.id, form, forYou]);
  // Im Desktop-Modus bleibt die Caption im Panel offen, bis man sie schließt
  useEffect(() => {
    if (!deskRef.current) setCapOpen(false);
  }, [idx, form]);

  if (!allPool.length) return <Empty text="No moments in the pool yet. The daily run fills it." />;
  if (!pool.length)
    return (
      <div className="vfeed" ref={dragEl}>
        <FormSwitch form={form} setForm={setForm} />
        <Empty text={emptyFormLine(form)} />
      </div>
    );
  if (error) return <Empty text={`${error}. Moments need internet.`} />;
  if (!queue.current.length) return <Empty text="You have seen every moment. New ones arrive with the next daily run." />;

  const m = queue.current[idx];
  const recallEl = recall ? <RecallCard key={recall.m.id + String(recall.review)} m={recall.m} review={recall.review} rng={rng.current!} onAnswer={answerRecall} onClose={closeRecall} keys={!!desk} ctl={recallCtl} /> : null;
  const saved = m && !!state.savedMoments[m.id];
  const liked = !!m && !!state.momentLiked?.[m.id];
  const captionsOn = !!m && form !== 'text' && captionsShown(form === 'audio' ? 'on' : state.settings.captionMode, m);

  return (
    <div className="vfeed" ref={dragEl} style={{ ['--area' as string]: m ? AREA_COLOR[m.area] : '#fff' }}>
      {slots.current.slice(0, SLOTS).map((slot, s) => {
        const j = slot.index;
        const mm = queue.current[j];
        const offset = single ? 0 : j - idx;
        const isCur = offset === 0;
        return (
          <div key={s} ref={(el) => (slot.el = el)} className={`vslot ${Math.abs(offset) <= 1 ? 'vslot-anim' : ''}`} style={{ ['--off' as string]: offset }} aria-hidden={!isCur}>
            <div className="vframe">
              <div ref={(el) => (slot.host = el)} />
            </div>
            {mm && mm.form !== 'text' && !mm.audio && <img key={mm.id} className="vposter" src={thumbOf(mm)} alt="" draggable={false} />}
            {mm && mm.form !== 'text' && mm.audio && (
              <div className="vaudio">
                <img key={`bg-${mm.id}`} className="vaudio-bg" src={thumbOf(mm)} alt="" draggable={false} />
                <img key={`art-${mm.id}`} className="vaudio-art" src={thumbOf(mm)} alt="" draggable={false} />
              </div>
            )}
            {isCur && paused && !forYou && (
              <svg className="vplay" width="72" height="72" viewBox="0 0 24 24" fill="#fff" aria-label="Pausiert">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </div>
        );
      })}

      <div className="vtrack" />
      <FormSwitch form={form} setForm={setForm} />
      {!online && (
        <div className="voffline pointer-events-none" data-testid="offline" role="img" aria-label="Offline">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8a15 15 0 0 0-9.4-4.7M5.5 12.6a10 10 0 0 1 3.1-1.8M18.5 12.6a10 10 0 0 0-4.2-2.3M8.9 16.4a5 5 0 0 1 6.2 0M12 20h.01M3 3l18 18" />
          </svg>
        </div>
      )}
      {form === 'text' && m && !forYou && (
        <div
          ref={textBox}
          className="vtext no-callout"
          data-testid="text-view"
          onScroll={checkTextEnd}
          onTouchStart={(e) => {
            const el = e.currentTarget;
            tt.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, top: el.scrollTop <= 0, end: textEndReached(el.scrollTop, el.clientHeight, el.scrollHeight) };
          }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - tt.current.x;
            const dy = e.changedTouches[0].clientY - tt.current.y;
            const sw = swipeOf(dx, dy);
            if (sw === 'note') openNote();
            else if (sw === 'next' && tt.current.end) goTo(idxRef.current + 1);
            else if (sw === 'prev' && tt.current.top) goTo(idxRef.current - 1);
          }}
          onDoubleClick={(e) => likeAt(e.clientX, e.clientY)}
        >
          {!desk && (
            <>
              <div className="vchannel">
                <span className="vdot" aria-hidden="true" />
                <span style={{ color: AREA_COLOR[m.area] }}>{AREA_LABEL[m.area]}</span>
                <span className="vspeaker">{speakerLine(m.channel)}</span>
              </div>
              <h2 className="vtext-hook">{m.hook}</h2>
            </>
          )}
          {(() => {
            const t = momentText(m);
            const ar = isArabic(t);
            return t ? (
              <p className={`vtext-body ${ar ? 'vtext-rtl' : ''}`} dir={ar ? 'rtl' : 'ltr'} lang={ar ? 'ar' : 'en'}>{t}</p>
            ) : (
              <p className="vtext-body text-[#B3B3B3]">No text for this moment yet.</p>
            );
          })()}
          {!desk && (() => {
            const sl = sourceLine(m);
            if (!sl) return null;
            const label = `${sl.prefix}${sl.text}`;
            return sl.url ? (
              <a className="vtext-source" data-testid="text-source" href={sl.url} target="_blank" rel="noopener noreferrer">{label}</a>
            ) : (
              <p className="vtext-source" data-testid="text-source">{label}</p>
            );
          })()}
          <div className="vtext-end" aria-hidden="true">{desk ? 'Next moment: J, Down, or two fingers up' : 'Swipe up for the next moment'}</div>
        </div>
      )}
      {!forYou && (
        <div className="vtoday pointer-events-none" data-testid="today">
          {todayLine(state.dayCount?.[today], true)}
        </div>
      )}
      <div className="vprogress" style={{ transform: `scaleX(${progress})` }} />
      {loading && !forYou && <div className="vloading" aria-label="Loading" />}

      <div
        className="vgesture no-callout"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          if (g.current.fired) endFast();
          g.current.fired = false;
          g.current.t = 0;
          setDrag(0);
          window.clearTimeout(g.current.long);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />

      {hint && !forYou && form !== 'text' && (
        <div className="vsound pointer-events-none" data-testid="sound-off" role="img" aria-label="Sound off">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H3v6h3l5 4z" fill="#fff" />
            <path d="m16 9 5 6M21 9l-5 6" />
          </svg>
        </div>
      )}

      {captionsOn && caption && !forYou && (
        <div className={`vcaption pointer-events-none ${m?.audio ? 'vcaption-audio' : form === 'audio' ? 'vcaption-big' : ''} ${isArabic(caption) ? 'vcaption-rtl' : ''}`} data-testid="caption">
          <span dir={isArabic(caption) ? 'rtl' : 'ltr'} lang={isArabic(caption) ? 'ar' : 'en'}>{caption}</span>
        </div>
      )}

      {m && !forYou && form !== 'text' && !desk && (
        <div className="vinfo pointer-events-none">
          <div
            className="vinfo-tap"
            data-testid="info-tap"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => { e.stopPropagation(); setCapOpen(true); }}
          >
            <div className="vchannel" data-testid="speaker-line">
              <span className="vdot" aria-hidden="true" />
              <span style={{ color: AREA_COLOR[m.area] }}>{AREA_LABEL[m.area]}</span>
              <span className="vspeaker">{speakerLine(m.channel)}</span>
            </div>
            <div className="vtitle" data-testid="hook" ref={hookEl}>{m.hook}</div>
          </div>
        </div>
      )}

      {capOpen && m && !forYou && form !== 'text' && !desk && <CaptionSheet m={m} speaker={speakerLine(m.channel)} onClose={() => setCapOpen(false)} />}

      {heart && (
        <svg key={heart.k} className="vheart pointer-events-none" data-testid="heart-burst" style={{ left: heart.x - 48, top: heart.y - 48 }} width="96" height="96" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
          <path d={HEART} />
        </svg>
      )}

      {!forYou && (
        <div className="vactions">
          <ActionButton testid="like" label="More" on={liked} onClick={(e) => { const t0 = e.timeStamp; like('button'); recordTap(t0); }}>
            <path d={HEART} />
          </ActionButton>
          <ActionButton testid="save" label="Save" on={saved} onClick={(e) => { const t0 = e.timeStamp; toggleSave(); recordTap(t0); }}>
            <path d="M7 4h10v16l-5-4-5 4z" />
          </ActionButton>
          {m && fullVideoUrl(m) && <ActionButton testid="source" label="Source" on={pulse === 'source'} fill={false} onClick={openFull}>
            <path d="M7 17 17 7M9 7h8v8" />
          </ActionButton>}
        </div>
      )}

      {recall && !desk && recallEl}
      {desk?.panel &&
        createPortal(
          <DeskPanel m={m} speaker={m ? speakerLine(m.channel) : ''} form={form} capOpen={capOpen} onCaption={() => setCapOpen((o) => !o)} onSource={openFull} recall={recall ? recallEl : null} />,
          desk.panel,
        )}

      {forYou && (
        <div
          className="foryou no-callout"
          data-testid="foryou"
          onPointerUp={() => goTo(idxRef.current + 1)}
          style={{ ['--area' as string]: AREA_COLOR[forYou.area] }}
        >
          <div className="foryou-label">FOR YOU</div>
          <p className="foryou-text">{forYou.forYou}</p>
          <div className="foryou-foot">
            <span>Tap to continue</span>
            <span>6 s</span>
          </div>
        </div>
      )}

      {fast && (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+16px)] z-30 flex justify-center">
          <span className="rounded-full bg-black/70 px-3 py-1 text-[14px] font-semibold text-white">2x</span>
        </div>
      )}

      {flash && (
        <div className="flash pointer-events-none absolute inset-x-0 bottom-40 z-30 flex justify-center">
          <span className="rounded-full bg-black/80 px-4 py-2 text-[15px] text-white">{flash}</span>
        </div>
      )}

      {prompt && !forYou && unsent(state.feedbackNotes).length > 0 && (
        <button type="button" className="vnotes" data-testid="notes-prompt" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={sendNotes}>
          {promptLine(unsent(state.feedbackNotes).length)}
        </button>
      )}

      {note && <NoteSheet key={note.id} m={note} speaker={speakerLine(note.channel)} onChip={(c, t) => saveNote(note, c, t)} onDone={(t) => saveNote(note, null, t)} onCancel={cancelNote} confirm={confirmText} keys={!!desk} ctl={noteCtl} />}
    </div>
  );
}

const HEART = 'M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z';

/** Ziel 48 pt, Bestätigung am Knopf (Füllung ohne Verzögerung, Pop 150 ms) */
function ActionButton({ label, aria, testid, onClick, on, fill = true, children }: { label: string; aria?: string; testid: string; onClick: (e: React.MouseEvent) => void; on?: boolean; fill?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={aria ?? label}
      aria-pressed={on === undefined || !fill ? undefined : on}
      data-testid={testid}
      data-on={on ? '1' : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onClick}
      className="vbtn no-callout flex min-h-[48px] min-w-[48px] flex-col items-center justify-center gap-0.5 text-white"
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill={on && fill ? '#fff' : 'none'} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' }}>
        {children}
      </svg>
      {label && <span className="vlabel">{label}</span>}
    </button>
  );
}

function FormSwitch({ form, setForm }: { form: Form; setForm: (f: Form) => void }) {
  return (
    <div className="vform" role="radiogroup" aria-label="Form" data-testid="form-switch" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        {FORMS.map((f) => (
          <button key={f} role="radio" aria-checked={form === f} className={form === f ? 'on' : ''} onClick={() => setForm(f)}>
            {FORM_LABEL[f]}
          </button>
        ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="pad flex h-[100dvh] items-center bg-black text-[17px] leading-[25px] text-[#B3B3B3]">{text}</div>;
}
