import { diagLog, netType } from '../lib/diag';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { dayKey, now as clockNow } from '../lib/clock';
import { AREA_COLOR, AREA_LABEL, topicLabel } from '../lib/labels';
import type { AppState } from '../lib/state';
import { audioDeck, createPlayer, deckClipOf, HLS, LOCAL, loadYT, offlineYT, STATE, type YTPlayer } from '../video/ytApi';
import { POOL_WINDOW, type DeckClip } from '../video/audioDeck';
import { canWarm, coverMs, onNonCurrentPlaying, roleOf, swipePlan, videoStats, WARM_MS, type SlotView, type WarmCtx, type WarmState } from '../video/warmup';
import { clearFirstGesturePointer, firstGesturePointer, gestureSeen, onGesture, type Gesture } from './gesture';
import { hintVisible, SOUND_NONE } from './soundHint';
import { errorAction, recoverDelay, resumePos } from './netrecover';
import { isYtId } from './contract';
import { beep, contextForTest, levelEnabled, probeHost, setTempo, unlockAudio } from './audioGraph';
import { loudLine, recordLoud } from './loudness';
import { browserPreloader } from './preloader';
import { isPreloadable, keyOf, netRank, queueAhead, streamKind } from './preload';
import { coldToday, countColdStart, pickHeads, startOrder } from './startHead';
import { depthPlan, lockMeta, lockNextPlan, LOCK_UNREGISTERED, previousPress, savedTitle, SAVED_TITLE_MS } from './lockScreen';
import { cursorFor, historyBefore, parseSaved, POOL_AHEAD, pruneAndHeal, pruneOnly, queueKey, recentFromLog, releaseTail, remixTail, replanStart, restoreQueue } from './queue';
import { leaveOf, newMomentCursor, nextMoment, sessionSkip, SIGNAL, type MomentCursor } from './mix';
import { attentionStep, makeCtx, newAttention, readConn, type Attention } from './context';
import { addMissed, bumpCell, bumpColdNetStart, bumpPair, hourKey } from './signals';
import { clearFocus, focusActive, focusFilter, inFocus, readFocus, subscribeFocus, type Focus } from './focus';
import { bumpStart, dropOverStarted, isQuickSkip, markRejected, quickSkip, resumeSaved, setTabCursor, START_MAX } from './tabs';
import { applyEffect, confirmLine, signal, skip as skipRule, type Effect } from './learn';
import { clampRate, DEFAULT_RATE, nextRate, rateOf, type Rate } from '../lib/state';
import { addSample } from './latency';
import { captionLines, captionsShown } from './captions';
import { CueClock, cueIndexAt } from './cueClock';
import { countGotIt, countSeen, todayLine } from './today';
import { answer, cardDue, pickRecall, recallQuiet, type Recent } from './recall';
import { RecallCard, type RecallCtl } from './RecallCard';
import { canShowRecall, onReturn, onSwipe, requeueOpen, type QueueEntry } from './recallqueue';
import { CaptionSheet } from './CaptionSheet';
import { sourceLine } from './source';
import { askUrl, markAsked } from './ask';
import { NoteSheet, type NoteCtl } from './NoteSheet';
import { createWheel, deskKey, TAB_KEYS, wheelPx, type DeskAction } from './desktop';
import { DeskPanel } from './DeskShell';
import { speakerLine } from './speaker';
import { chipEffect, CONFIRM_SHEET_MS, MUTE_UNDO_MS, firstOpenOfDay, inputConfirm, makeEntry, makeInputEntry, markSent, nextIssue, promptLine, unsent, type Chip, type InputChip } from './note';
import { HOOK_LINE_PT, hookStep } from './hook';
import { makeRng } from './rng';
import { addTap, CONFIRM_MS, HEART_MS, nextLiked, swipeOf } from './actions';
import { addFrames, atRest, commitVelocity, dragY, frameSample, release, SPRING_BACK, SPRING_COMMIT, stepSpring, Velocity, type Spring, type SpringState } from './swipe';
import { saveGate } from '../lib/useAppState';
import { blockedCount, emptyFormLine, END_SUB, endButtonLabel, endLine, filterPool, formOf, FORM_LABEL, momentText, otherForms, textEndReached, unseenCount, waitingLine, type Form } from './form';
import { atEnd, EndLedger, isBackground, onLeave } from './background';
import { PlayTracker } from './played';
import { setMood } from '../design/mood';
import { Status } from '../components/Status';
import { Head } from '../components/Head';
import { FocusSheet } from '../components/FocusSheet';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/icons';
import { atTime } from './hook';
import { focusTabText } from '../components/head';
import { statusOf } from '../components/status';
import { Ambient } from './Ambient';
import { fullVideoUrl, isArabic, thumbOf, type Feedback, type Moment } from './types';

/** Desktop-Modus ab 1181 px: Panel rechts, Übersicht, Seitenblatt. Fehlt das Feld, gilt das mobile Verhalten unverändert. */
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
  /** Fehlertext des letzten Syncs, für die Status-Zeile */
  syncError?: string | null;
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
  /** Netzfehler im Player: der Slot bleibt stehen und wird bei der Rückkehr an derselben Stelle wieder aufgenommen (Issue 9) */
  broken: boolean;
  /** Wiederaufnahmen seit dem letzten Spielen, danach gilt der Moment als nicht abspielbar */
  tries: number;
  /** Letzte gute Position im laufenden Moment (Quellzeit) */
  pos: number;
  /** Warmlauf (Issue 22, Entscheidung 29): idle, running (läuft stumm als nächster Moment) oder done (angehalten am Start, YouTube-Einblendung ist weg) */
  warm: WarmState;
  warmTimer: number;
  /** Zeitpunkt (performance.now) des ersten PLAYING im Warmlauf */
  warmAt: number;
  /** Der Slot war mit diesem Moment schon der aktuelle: kein neuer Warmlauf */
  visited: boolean;
  /** Eigene Fläche über Titelbereich und Logo (Entscheidung 29, Rückfall): Dauer nach PLAYING, Ende und Zeitgeber */
  coverMs: number;
  coverEnd: number;
  coverTimer: number;
  cover: HTMLDivElement | null;
  /** Puffer-Stopps nach dem ersten Bild des laufenden Moments */
  stalls: number;
  /** Zeitpunkt des ersten PLAYING als aktueller Moment (0: noch nicht gelaufen) */
  playedAt: number;
}
const newSlot = (): Slot => ({ host: null, el: null, player: null, ready: false, index: -1, st: STATE.UNSTARTED, mid: '', broken: false, tries: 0, pos: 0, warm: 'idle', warmTimer: 0, warmAt: 0, visited: false, coverMs: 0, coverEnd: 0, coverTimer: 0, cover: null, stalls: 0, playedAt: 0 });
/** Zeit, die der Start der Vorlade-Player nach dem Kaltstart höchstens hinter dem aktuellen Moment wartet (Issue 22) */
const GATE_MS = 3500;
/** Zwei Zeilen Abdeckfläche über dem YouTube-Titelbereich (60 px) und dem Logo-Bereich (48 px) des 16:9-Bildes */
const COVER_TOP = 60;
const COVER_BOTTOM = 48;

const END_GUARD = 0.3;
const FOR_YOU_MS = 6000;
const POLL_MS = 150;
const TAP_MS = 260;
const LONG_MS = 500;
const LOG_MAX = 3000;
/** Warteschlange beim Start: der Vorrat soll 30 Momente vorhalten, dazu der aktuelle und ein paar Reserve */

const load = (m: Moment) => ({ videoId: m.videoId, startSeconds: m.start, endSeconds: m.end, gainDb: m.gainDb });

/** Anzahl der Medien-Elemente mit gesetzter Quelle (Vorgabe: höchstens 3 gleichzeitig) */
const mediaWithSrc = (): number => (typeof document === 'undefined' ? 0 : [...document.querySelectorAll('audio,video')].filter((e) => !!e.getAttribute('src')).length);

export function MomentFeed({ pool: allPool, state, update, active, onPausedChange, syncError = null, desk }: Props) {
  const single = state.settings.playerMode === 'single';
  const SLOTS = single ? 1 : 3;
  const stateRef = useRef(state);
  stateRef.current = state;
  const activeRef = useRef(active);
  activeRef.current = active;
  const deskRef = useRef(desk);
  deskRef.current = desk;
  /** Abrufkarte beantwortet (Enter ist dann Next) */
  const recallAnswered = useRef(false);
  /** Eintrag der offenen Abrufkarte (für den Wechsel in den Hintergrund) */
  const recallEntry = useRef<QueueEntry | null>(null);
  const recallCtl = useRef<RecallCtl | null>(null);
  const noteCtl = useRef<NoteCtl | null>(null);
  /** Das 2x kommt von der Tastatur (Shift+. gehalten) */
  const spaceHandled = useRef(false);
  const actRef = useRef<(a: DeskAction) => void>(() => {});
  const playRef = useRef<(want: boolean) => void>(() => {});
  const form: Form = state.settings.form ?? 'video';
  // Temporärer Fokus (Entscheidung 39): harter Filter auf den Pool vor der Mischung, pro Gerät. Gewichte, Anteile und Lernen bleiben.
  const [focus, setFocus] = useState<Focus | null>(() => readFocus(clockNow().getTime()));
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const formPool = useMemo(() => filterPool(allPool, form), [allPool, form]);
  const pool = useMemo(() => focusFilter(formPool, focus, clockNow().getTime()), [formPool, focus]);
  useEffect(() => subscribeFocus(() => setFocus(readFocus(clockNow().getTime()))), []);
  // Fokus gesetzt, geändert oder gelöscht: der Rest hinter dem laufenden Moment wird aus dem neuen Pool gewählt (Gewichte und Anteile bleiben)
  const focusFirst = useRef(true);
  useEffect(() => {
    if (focusFirst.current) {
      focusFirst.current = false;
      return;
    }
    if (queue.current.length) replanRef.current(Math.min(queue.current.length, idxRef.current + 1));
    rerender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  const textRef = useRef(form === 'text');
  textRef.current = form === 'text';
  /** Im Textmodus: Textende des aktuellen Moments war sichtbar */
  const textSeen = useRef(-1);
  const textBox = useRef<HTMLDivElement>(null);

  const queue = useRef<Moment[]>([]);
  const cursor = useRef<MomentCursor | null>(null);
  /** Die zuletzt gespielten Momente aus der letzten Sitzung: Anfang des Verlaufs für die Mischung (nie dieselbe Folge innerhalb 10) */
  const seedHist = useRef<Moment[]>([]);
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
  const slots = useRef<Slot[]>(Array.from({ length: 3 }, newSlot));
  /** Ton gewünscht. Hat es auf der Seite schon irgendwo eine Geste gegeben (Reiter, Leiste), startet ein neu gebauter Feed mit Ton. */
  const soundOn = useRef(gestureSeen());
  const userPaused = useRef(false);
  const since = useRef(Date.now());
  const endedAt = useRef(-1);
  const forYouRef = useRef(false);
  /** Abrufkarte offen: Player bleibt angehalten */
  const recallRef = useRef(false);
  const sessionSeen = useRef(0);
  const sessionT0 = useRef(Date.now());
  const attention = useRef<Attention>(newAttention());
  /** Paare aufeinanderfolgender Momente dieser Sitzung, die schon gezählt sind (mixClump) */
  const pairsSeen = useRef(new Set<string>());
  const counted = useRef(new Set<string>());
  const recent = useRef<Recent[]>([]);
  const forYouTimer = useRef(0);
  const feedMs = useRef(0);
  const dragEl = useRef<HTMLDivElement>(null);
  const diag = useRef<{ push: (l: string) => void; slice: (n: number) => string[]; filter: (f: (x: string) => boolean) => string[] }>({
    push: (l) => diagLog.push(l),
    slice: (n) => diagLog.raw().slice(n),
    filter: (f) => diagLog.raw().filter(f),
  });
  /** Zeitpunkt des letzten Netzwechsels (online oder offline), für die Schonfrist der Hänge-Überwachung */
  const netAt = useRef(0);
  /** YouTube-API wieder erreichbar, der Neuaufbau der Player wartet, bis der laufende Moment nicht mehr spielt */
  const ytPending = useRef(false);
  /** Stelle, an der ein Moment nach dem Neuaufbau der Player weiterläuft */
  const resume = useRef<{ mid: string; pos: number } | null>(null);
  const bad = useRef(new Set<string>());
  // Hintergrund-Wiedergabe (Entscheidung 13)
  const ledger = useRef(new EndLedger());
  /** Beim Verlassen der Seite angehalten (YouTube, Text), nicht vom Menschen */
  const leftPaused = useRef(false);
  const bgStarted = useRef(new Set<string>());
  const visRef = useRef<(v: string) => void>(() => {});
  const msOnRef = useRef(false);
  /** Zum nächsten Moment springen, auch aus Code, der vor goTo definiert ist */
  const skipRef = useRef<() => void>(() => {});
  const everPlayed = useRef(false);
  /** Entscheidung 45: wie lange jeder Moment wirklich gespielt hat. Gesehen zählt erst nach einer Sekunde Spielzeit (Video und Audio). */
  const played = useRef(new PlayTracker());
  const seenMarked = useRef(new Set<string>());
  const unplayedNoted = useRef(new Set<string>());
  /** Verdeckt hängende Momente, für die schon "lock: stuck, stay" im Protokoll steht (Brief 14b): eine Zeile je Moment */
  const stuckNoted = useRef(new Set<string>());
  /** Vorrats-Tiefe, für die zuletzt "stock: low" kam, und Zeitpunkt des letzten Nachladens (Brief 14b, Schritt 1) */
  const lowDepth = useRef(-1);
  const lastResume = useRef(0);
  const poolHold = useRef(0);
  /** Offene Messung Wisch bis erstes Bild */
  const swipe = useRef<{ j: number; t0: number; buffered: boolean } | null>(null);
  /** Messung für die Zeile "video: ..." (Issue 22): Wisch bis Bereitschaft des Players und bis zum ersten PLAYING */
  const vstat = useRef<{ j: number; t0: number; readyAt: number | null; mode: string; done: boolean; start?: boolean } | null>(null);
  /** Zeiten Wisch bis erstes Bild der YouTube-Momente dieser Sitzung (Median und p90 im Protokoll) */
  const ytFrames = useRef<number[]>([]);
  /** Nach dem Kaltstart laden die Vorlade-Player erst, wenn der aktuelle Moment spielt (sonst teilen drei Player die Leitung) */
  const gateOpen = useRef(false);
  const gateTimer = useRef(0);
  const gateWait = useRef(new Set<Slot>());

  /** Wischübergang: Bühne mit den Seiten und Ebene mit den Overlays bewegen sich gemeinsam, nur transform, direkt geschrieben (ohne React) */
  const stageEl = useRef<HTMLDivElement>(null);
  const uiEl = useRef<HTMLDivElement>(null);
  const mot = useRef({ y: 0, raf: 0, busy: false });
  const dragging = useRef(false);
  const vel = useRef(new Velocity());
  const pendingRender = useRef(false);
  /** Wechsel mit Feder, auch aus Code, der vor der Definition von navigate steht (useCallback) */
  const navRef = useRef<(next: number) => void>(() => {});
  const upRef = useRef<(e: React.PointerEvent) => void>(() => {});
  const meter = useRef({ on: false, raf: 0, last: 0, deltas: [] as number[], tail: 0 });
  /** Während Ziehen und Auslaufen keine React-Arbeit: keine Neuzeichnung, kein Speichern, kein Polling */
  const moving = () => mot.current.busy || dragging.current;

  const [idx, setIdx] = useState(0);
  /** Issue 44: erzwingt ein Rendern, wenn die Oberfläche hinter dem Moment zurückliegt, auf dem Deck und Index stehen */
  const [, setUiTick] = useState(0);
  /** Moment, den die letzte Zeichnung gezeigt hat (Issue 44) */
  const shownId = useRef('');
  // Stimmung folgt dem Bereich des aktuellen Moments, außerhalb des Feeds gilt die neutrale Palette (Brief 06)
  const moodArea = queue.current[idx]?.area;
  useEffect(() => {
    setMood(active && moodArea ? moodArea : null);
    return () => setMood(null);
  }, [active, moodArea]);
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [progress, setProgress] = useState(0);
  /** Hinweis "Ton aus": nur aus dem Zustand des spielenden Elements (muted oder play abgelehnt), nie aus einem Berührungs-Flag */
  const [hint, setHint] = useState(false);
  const syncHint = () => {
    const p = slotFor(idxRef.current).player;
    const v = !!p && hintVisible(p.sound?.() ?? SOUND_NONE);
    setHint((h) => (h === v ? h : v));
  };
  const syncHintRef = useRef(syncHint);
  syncHintRef.current = syncHint;
  const [paused, setPaused] = useState(false);
  const rateRef = useRef<Rate>(DEFAULT_RATE);
  /** Tempo auf alle Slots legen (Streams: Media-Element, YouTube: setPlaybackRate). Läuft auch für Slots, die gerade pausieren. */
  const applyRate = () => {
    // Nur das eine spielende Element. Die anderen Slots bekommen das Tempo mit ihrer Quelle (getRate), nie ein Schreibzugriff auf ein Element ohne Quelle.
    slotFor(idxRef.current).player?.setPlaybackRate(clampRate(rateRef.current));
  };
  /** Pfeiler 17: 1x, 1.5x, 2x, 1x. Wert sofort in den Refs und in den Playern, dann in den State (Sync). */
  const cycleRate = () => {
    const next = nextRate(rateRef.current);
    rateRef.current = next;
    setTempo(clampRate(next));
    applyRate();
    // Der Vorrat lädt nach Zeit voraus: bei 2x doppelt so weit
    syncPre(idxRef.current);
    update((s) => ({ ...s, settings: { ...s.settings, playbackRate: next } }));
    diag.current.push(`rate: ${next}x`);
  };
  const [forYou, setForYou] = useState<Moment | null>(null);
  /** Herz an der Tippstelle (400 ms) und kurze Bestätigung am Knopf (150 ms) */
  const [capOpen, setCapOpen] = useState(false);
  /** Text-Reiter (Handy): der Text ist auf einen Bildschirm gekürzt, der Rest steht hinter "Read more" im Kontext (Entscheidung 25, Brief 17) */
  const [truncated, setTruncated] = useState(false);
  const truncRef = useRef(false);
  const [note, setNote] = useState<Moment | null>(null);
  /** Zeile "N notes, send?" beim ersten Öffnen am Tag */
  const [prompt, setPrompt] = useState(false);
  const promptChecked = useRef(false);
  const noteRef = useRef<Moment | null>(null);
  noteRef.current = note;
  /** Bestätigungszeile am Blatt nach einem Chip, solange sie steht */
  const [confirmText, setConfirm] = useState<string | null>(null);
  /** Sprecher, dessen Mute rückgängig gemacht werden kann, solange die Bestätigungszeile steht */
  const [undoChannel, setUndo] = useState<string | null>(null);
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
  // Untertitel (Issue 15): Uhr aus der Zeit des Elements, das Ton ausgibt, und Index der gezeigten Cue
  const clock = useRef(new CueClock());
  const shownCue = useRef(-2);
  const [loading, setLoading] = useState(false);
  /** Audio-Reiter: ein Netzstart wartet auf Daten (Pille "Loading, keep screen on") */
  const [deckWait, setDeckWait] = useState(false);
  const [focusSheet, setFocusSheet] = useState(false);
  /** Status "Playing in the background": Audio lief, während die Seite verborgen war, und bleibt nach der Rückkehr 4 s sichtbar (nur Anzeige, keine Wiedergabelogik) */
  const [bgShown, setBgShown] = useState(false);
  useEffect(() => {
    let t = 0;
    const on = () => {
      window.clearTimeout(t);
      if (isBackground(document.visibilityState)) setBgShown(stateRef.current.settings.form === 'audio');
      else t = window.setTimeout(() => setBgShown(false), 4000);
    };
    document.addEventListener('visibilitychange', on);
    return () => { window.clearTimeout(t); document.removeEventListener('visibilitychange', on); };
  }, []);
  const lastBack = useRef<number | null>(null);
  const lockPrevRef = useRef<() => void>(() => {});
  const waitSince = useRef(0);
  rateRef.current = rateOf(state.settings);
  setTempo(clampRate(rateRef.current));
  // Tempo aus Sync, Desktop-Leiste oder Settings erreicht auch pausierte und wartende Slots
  useEffect(() => {
    applyRate();
    // Das Vorrat-Fenster ist ein Zeitfenster (Issue 13): bei neuem Tempo das Vorladen neu planen. Die Warteschlange selbst wächst
    // erst mit dem nächsten Moment (goTo ruft ensureQueue mit dem Vorlauf zum Tempo), sonst verbraucht ein Tempowechsel allein den Tagesvorrat.
    if (queue.current.length) syncPre(idxRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateOf(state.settings)]);

  const today = dayKey(clockNow());
  // Startmoment des Reiters zählen (Entscheidung 36), nach dem ersten Aufbau der Warteschlange, einmal je Einblendung des Reiters
  const startCounted = useRef(false);
  useEffect(() => {
    const head = queue.current[idxRef.current];
    if (startCounted.current || !head) return;
    startCounted.current = true;
    update((s) => bumpStart(setTabCursor(s, form, head.id, today), head.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });
  const show = (t: string) => {
    setFlash(t);
    window.setTimeout(() => setFlash(null), 900);
  };

  /** Warteschlange ablegen (pro Form und Tag), damit der Vorrat nach einem Neustart noch passt */
  const saveQueue = () => {
    try {
      const ids = queue.current.slice(Math.max(0, idxRef.current)).map((x) => x.id);
      localStorage.setItem(queueKey(form), JSON.stringify({ day: today, ids }));
      // Die nächsten drei Audio-Momente bleiben über das Sitzungsende im Vorrat (Brief 02): beim nächsten Start ist Moment 1 lokal
      if (form === 'audio') pre?.setHeads(pickHeads(queue.current, idxRef.current, isPreloadable, keyOf));
    } catch {
      /* kein Speicher */
    }
  };

  /** Kontextgewicht (Issue 26): Tageszeit aus den eigenen Signalen, Aufmerksamkeit der Sitzung, Netzart. Zeitfenster einmal je Aufruf gerechnet. */
  const ctxOf = (s: AppState) => makeCtx({ signals: s.signals, today, hour: clockNow().getHours(), attention: attention.current, position: () => queue.current.length, conn: readConn() });

  const ensureQueue = useCallback(
    (upTo: number) => {
      const s = stateRef.current;
      const firstBuild = !cursor.current;
      if (!cursor.current) {
        // Heutige Warteschlange der letzten Sitzung übernehmen, dann passt der Vorrat noch (auch offline)
        let saved: Moment[] = [];
        try {
          // Entscheidung 36: der Reiter macht dort weiter, wo er verlassen wurde. Abgelehnte Momente stehen in momentSeen. Kein Moment ist öfter als zweimal Startmoment.
          saved = restoreQueue(resumeSaved(parseSaved(localStorage.getItem(queueKey(form))), s.tabCursor?.[form], today), today, pool, { seen: s.momentSeen, mutedChannels: s.mutedChannels }, queueAhead(rateRef.current));
          saved = dropOverStarted(saved, s.startShown);
        } catch {
          /* kein Speicher */
        }
        cursor.current = saved.length ? cursorFor(saved, false, clockNow().getTime()) : newMomentCursor(s.momentDay !== today);
        seedHist.current = recentFromLog(s.momentLog, pool);
        queue.current.push(...saved);
        poorRef.current = pre?.poor() ?? false;
      }
      const rank = poorRef.current && pre ? netRank(pre.has) : undefined;
      const ctx = ctxOf(s);
      // Moment für Moment (Entscheidung 33): jeder Moment wird gegen die letzten 10 gewählt. Gescheiterte Momente verbrauchen eine Wahl, kommen aber nicht in die Schlange.
      for (let guard = 0; queue.current.length < upTo && guard < upTo + pool.length; guard++) {
        const m = nextMoment(pool, { areaShares: s.settings.areaShares, weights: s.momentWeights, seen: s.momentSeen, mutedChannels: s.mutedChannels, now: clockNow().getTime(), rank, ctx }, cursor.current, historyBefore(queue.current, queue.current.length, seedHist.current), rng.current);
        if (!m) break;
        if (!bad.current.has(m.videoId)) queue.current.push(m);
      }
      // Audio-Reiter, Start (Brief 02): der erste Moment kommt aus dem Vorrat. Innerhalb der nächsten 3 der Mischung wird ein lokaler vorgezogen,
      // sonst kommt ein gehaltener Kopf der letzten Sitzung an die erste Stelle.
      if (firstBuild && form === 'audio' && pre && queue.current.length) {
        const held = (m: Moment) => pre.held(m.id) || LOCAL.has(keyOf(m));
        const heads = pre
          .startHeads()
          .map((h) => pool.find((m) => m.id === h.id))
          .filter((m): m is Moment => !!m && !s.momentSeen[m.id] && !s.mutedChannels[m.channel] && (s.startShown?.[m.id] ?? 0) < START_MAX);
        // Entscheidung 45: reichen die Köpfe nicht (gesehen, stumm, nicht mehr im Vorrat), kommt irgendein zulässiger Moment aus dem Vorrat
        const reserve = pre
          .heldIds()
          .map((id) => pool.find((m) => m.id === id))
          .filter((m): m is Moment => !!m && formOf(m) === 'audio' && !s.momentSeen[m.id] && !s.mutedChannels[m.channel] && (s.startShown?.[m.id] ?? 0) < START_MAX);
        const r = startOrder(queue.current, held, heads, reserve);
        queue.current = r.queue;
        diag.current.push(`deck: start order ${r.how} first=${queue.current[0]?.id ?? 'none'} heads=${pre.startHeads().length} usable=${heads.length} stock=${reserve.length}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool, today, pre, form],
  );

  /**
   * Hosts der nächsten Momente auf CORS prüfen, bevor ein Moment sie braucht (ein winziger Abruf je Host, Ergebnis wird gemerkt).
   * So ist beim Abspielen und beim Anbinden nach der ersten Berührung schon klar, ob die geregelte Spur sicher ist.
   */
  const probeAhead = (at: number) => {
    if (!levelEnabled()) return;
    for (let j = Math.max(0, at); j <= at + 8 && j < queue.current.length; j++) {
      const m = queue.current[j];
      const url = m?.gainDb && m.form !== 'text' ? HLS.get(m.videoId) : undefined;
      if (url) void probeHost(url);
    }
  };

  /** Vorrat bekommt die Warteschlange, Blob-URLs für die nahen Momente werden bereitgehalten */
  const syncPre = (at: number) => {
    probeAhead(at);
    if (!pre) return;
    pre.setQueue(queue.current, at, rateRef.current);
    const w = pre.warmSet(queue.current, at, rateRef.current);
    // Audio-Reiter (Brief 11, Schritt 9, Brief 14b): die ersten drei Vorrats-Momente der nächsten 6 halten ihre Blob-URL, damit der Element-Vorrat sie lokal laden
    // kann (die Vorrats-Tiefe verlangt 3 von 6) und nach einem Tausch sofort ein lokaler Kandidat da ist. Ein widerrufener Blob würde dem Element die Quelle nehmen.
    if (form === 'audio') for (const m of queue.current.slice(at + 1, at + 1 + POOL_WINDOW).filter((x) => pre.held(x.id)).slice(0, 3)) if (!w.includes(m)) w.push(m);
    void pre.warm(w);
    pre.trimWarm(new Set(w.map((x) => x.id)));
    saveQueue();
  };

  /** Pro gespieltem Moment eine Zeile "loud: lufs X, gain Y dB": gemessen und wirklich angewendet. Ändert sich der Weg (Rückfall), kommt die neue Zeile dazu. */
  const loudSeen = useRef(new Map<string, string>());
  const noteLoud = (slot: Slot, s: number) => {
    const m = queue.current[slot.index];
    if (!m || m.form === 'text') return;
    const info = slot.player?.loud?.();
    const line = loudLine(m.lufs, info?.db ?? 0, info?.how ?? 'unchanged');
    if (loudSeen.current.get(m.id) === line) return;
    loudSeen.current.set(m.id, line);
    recordLoud(m.id, line);
    diag.current.push(`slot${s} ${m.id} ${line}`);
  };

  /**
   * Erste Berührung: Web Audio starten. Der laufende Moment wird sofort an die geregelte Spur gehängt (Max, 30.10.2026), an der aktuellen Stelle.
   * Das ist ein Quellwechsel mit kurzer Lücke, und die Berührung schaltet den Ton ohnehin erst jetzt frei. Die Slots, die schon vor der Berührung
   * vorbereitet wurden und noch nicht laufen, bekommen ihren Moment neu, damit auch sie auf die geregelte Spur kommen.
   */
  const unlockLevel = () => {
    void unlockAudio().then(() => {
      const cur = current();
      const cm = queue.current[cur.index];
      if (cur.player && cur.index === idxRef.current && cm?.gainDb && HLS.has(cm.videoId)) cur.player.relevel?.();
      for (const sl of slots.current) {
        const nm = queue.current[sl.index];
        if (!sl.player || !sl.ready || sl.index <= idxRef.current || !nm?.gainDb || !HLS.has(nm.videoId)) continue;
        sl.mid = '';
        assign(sl, sl.index, false);
      }
    });
  };

  const slotFor = (j: number) => slots.current[single ? 0 : ((j % 3) + 3) % 3];
  const current = () => slotFor(idxRef.current);
  const applySound = (p: YTPlayer) => (soundOn.current ? p.unMute() : p.mute());

  // ---- Video-Reiter: Warmlauf, Abdeckfläche, Vorlade-Gate (Issue 22, Entscheidung 29). Nur Referenzen, damit auch ältere Closures stimmen. ----
  /** Kontext für die Warmlauf-Regeln (warmup.ts) */
  const warmCtxOf = (j: number): WarmCtx => {
    const m = queue.current[j];
    return {
      youtube: !!m && m.form !== 'text' && !m.audio && !ytStub.current && streamKind(m) === 'youtube',
      lenS: m ? m.end - m.start : 0,
      text: textRef.current || m?.form === 'text',
      forYou: forYouRef.current,
      recall: recallRef.current,
      visible: typeof document === 'undefined' || document.visibilityState === 'visible',
      single: stateRef.current.settings.playerMode === 'single',
    };
  };
  const setCover = (slot: Slot, on: boolean) => {
    if (slot.cover) slot.cover.style.visibility = on ? 'visible' : 'hidden';
  };
  /** Die Fläche liegt nur, solange der Moment spielt, aktuell ist und die Frist läuft. Pause und Standbild brauchen sie nicht (das Vorschaubild deckt alles). */
  const syncCover = (slot: Slot) => setCover(slot, slot.index === idxRef.current && slot.st === STATE.PLAYING && slot.coverEnd > performance.now());
  /** Erstes PLAYING des aktuellen Moments: Frist der Abdeckfläche beginnt (Kaltstart, zu früher Wisch). Nach einem fertigen Warmlauf ist coverMs 0. */
  const startCover = (slot: Slot) => {
    if (slot.coverMs <= 0) return;
    if (!slot.coverEnd) {
      slot.coverEnd = performance.now() + slot.coverMs;
      window.clearTimeout(slot.coverTimer);
      slot.coverTimer = window.setTimeout(() => syncCover(slot), slot.coverMs + 20);
      diag.current.push(`video: cover on ${slot.mid} ${slot.coverMs} ms`);
    }
    syncCover(slot);
  };
  /** Neuer Moment im Slot: Warmlauf, Abdeckfläche und Zähler zurück auf Anfang */
  const resetWarm = (slot: Slot) => {
    window.clearTimeout(slot.warmTimer);
    window.clearTimeout(slot.coverTimer);
    Object.assign(slot, { warm: 'idle', warmTimer: 0, warmAt: 0, visited: false, stalls: 0, playedAt: 0, coverMs: 0, coverEnd: 0, coverTimer: 0 });
    setCover(slot, false);
  };
  /**
   * Der nächste Moment läuft stumm bis die YouTube-Einblendung weg ist (WARM_MS nach PLAYING), dann angehalten und zurück auf den Start.
   * Beim Wisch wird er nur noch hörbar und weitergespielt. Hat der Wisch den Slot vorher erreicht, kommt hier nichts mehr an.
   */
  const startWarmTimer = (slot: Slot) => {
    if (slot.warmTimer) return;
    slot.warmAt = performance.now();
    const mid = slot.mid;
    const n = slots.current.indexOf(slot);
    const arm = (ms: number, tries: number) => {
      slot.warmTimer = window.setTimeout(() => {
        slot.warmTimer = 0;
        const m = queue.current[slot.index];
        if (!m || slot.mid !== mid || slot.warm !== 'running' || roleOf(slot.index, idxRef.current) !== 'next') return;
        const played = (slot.player?.getCurrentTime?.() ?? m.start) - m.start;
        // Kaum gelaufen (Puffern): zweimal noch etwas warten, dann so abschließen
        if (played < 1.5 && tries < 2) {
          arm(1500, tries + 1);
          return;
        }
        slot.warm = 'done';
        try {
          slot.player?.pauseVideo();
          slot.player?.seekTo?.(m.start, true);
        } catch {
          /* Player nicht bereit */
        }
        diag.current.push(`video: warm done slot${n} ${mid} played ${played.toFixed(1)}s net ${netType()}`);
      }, ms);
    };
    arm(WARM_MS, 0);
  };
  /** Nach dem Wisch ist der übernächste Moment der nächste: sein Warmlauf beginnt jetzt. Wartet er noch am ersten Bild, läuft er an, sonst kommt er von selbst. */
  const promoteWarm = (slot: Slot, n: number) => {
    slot.warm = 'running';
    slot.warmAt = 0;
    diag.current.push(`video: warm start slot${n} ${slot.mid} st=${slot.st}`);
    if (slot.player && slot.ready && slot.st === STATE.PAUSED) {
      try {
        slot.player.mute();
        slot.player.playVideo();
      } catch {
        /* Player nicht bereit */
      }
    }
  };
  /**
   * Erstes Bild des aktuellen Moments nach dem Wisch (oder nach dem Kaltstart): Zeile first-frame (unverändert), Messung für die Einstellungen,
   * dazu die Zeile "video: swipe→ready .., →playing .., net .." (Issue 22) und alle fünf Messungen Median und p90 der letzten 20.
   */
  const frameDone = (slot: Slot) => {
    const sw = swipe.current;
    if (sw && slot.index === sw.j && sw.j === idxRef.current) {
      swipe.current = null;
      const ms = Math.round(performance.now() - sw.t0);
      diag.current.push(`first-frame ${ms}ms ${sw.buffered ? 'buffered' : 'cold'}${slot.player?.isLocal?.() ? ' local' : ''}`);
      pre?.recordStart(ms, sw.buffered);
      update((x) => ({ ...x, playLatency: addSample(x.playLatency, { ms, buffered: sw.buffered, at: Date.now() }) }));
    }
    const vs = vstat.current;
    const m = queue.current[slot.index];
    if (!vs || vs.done || slot.index !== vs.j || vs.j !== idxRef.current || !m || streamKind(m) !== 'youtube') return;
    vs.done = true;
    const playing = Math.round(performance.now() - vs.t0);
    diag.current.push(`video: ${vs.start ? 'start' : 'swipe'}→ready ${vs.readyAt ?? playing}ms, →playing ${playing}ms, net ${netType()}, ${vs.mode}`);
    if (vs.start) return; // der Kaltstart zählt nicht in Median und p90 der Wische
    ytFrames.current.push(playing);
    const n = ytFrames.current.length;
    if (n % 5 === 0) {
      const st = videoStats(ytFrames.current.slice(-20));
      diag.current.push(`video: median ${st.median}ms, p90 ${st.p90}ms over last ${st.n} swipes`);
    }
  };
  /** Kaltstart: die Vorlade-Player laden erst, wenn der aktuelle Moment spielt (oder GATE_MS vergangen sind) */
  const openGate = (why: string) => {
    if (gateOpen.current) return;
    gateOpen.current = true;
    window.clearTimeout(gateTimer.current);
    const waiting = [...gateWait.current];
    gateWait.current.clear();
    diag.current.push(`video: preload gate open (${why}), ${waiting.length} waiting`);
    for (const sl of waiting) if (sl.index >= 0 && sl.player && sl.ready) assign(sl, sl.index, false);
  };

  const openGateRef = useRef(openGate);
  openGateRef.current = openGate;

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
    // Kaltstart (Issue 22): der aktuelle YouTube-Moment bekommt die Leitung zuerst, die Vorlade-Player warten bis er spielt
    if (!play && !gateOpen.current) {
      const cm = queue.current[idxRef.current];
      if (cm && cm.form !== 'text' && streamKind(cm) === 'youtube' && streamKind(m) === 'youtube') {
        gateWait.current.add(slot);
        return;
      }
      gateOpen.current = true;
    }
    try {
      // Vorladen ohne Ton, der aktuelle Moment bekommt den gewählten Ton
      if (play) applySound(slot.player);
      else slot.player.mute();
      if (slot.mid !== m.id) {
        slot.mid = m.id;
        slot.st = STATE.UNSTARTED;
        slot.broken = false;
        slot.tries = 0;
        resetWarm(slot);
        // Der nächste Moment läuft nach dem Laden stumm warm, der übernächste hält am ersten Bild. Ein aktueller Moment ohne Warmlauf bekommt die Abdeckfläche.
        if (!play && canWarm(roleOf(j, idxRef.current), warmCtxOf(j))) slot.warm = 'running';
        slot.coverMs = play && streamKind(m) === 'youtube' ? coverMs('idle', 0) : 0;
        // Nach dem Neuaufbau der Player (YouTube-API kam zurück) läuft der Moment an derselben Stelle weiter, nicht von vorn
        const at = resume.current?.mid === m.id ? resume.current.pos : undefined;
        if (at !== undefined) resume.current = null;
        slot.pos = at ?? m.start;
        const arg = at === undefined ? load(m) : { ...load(m), startSeconds: resumePos(at, m) };
        if (play) slot.player.loadVideoById(arg);
        // YouTube lädt bei cue nur das Vorschaubild. Darum stumm laden, der Player hält beim ersten Bild an (siehe onState).
        else if (!HLS.has(m.videoId)) slot.player.loadVideoById(arg);
        else slot.player.cueVideoById(arg);
      } else if (play) {
        // Wisch während des Warmlaufs: der Moment lief schon stumm weiter und beginnt wieder am Anfang des Ausschnitts
        if (slot.warm === 'running') slot.player.seekTo?.(m.start, true);
        slot.player.playVideo();
      } else slot.player.pauseVideo();
      if (play) slot.visited = true;
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
    update((s) => (s.momentSeen[m.id] ? { ...s, momentDay: today } : bumpCell({ ...s, momentDay: today, momentSeen: { ...s.momentSeen, [m.id]: Date.now() }, dayCount: countSeen(s.dayCount, today) }, today, hourKey(clockNow()), m, 'seen')));
  };

  const markSeenRef = useRef(markSeen);
  markSeenRef.current = markSeen;
  /** Ein Moment, der nie gespielt hat (Hänge-Überwachung, Netzfehler, Autoplay verweigert), bleibt ungesehen (Entscheidung 45). Eine Zeile je Moment. */
  const noteUnplayed = (m: Moment) => {
    if (played.current.enough(m.id) || stateRef.current.momentSeen[m.id] || unplayedNoted.current.has(m.id)) return;
    unplayedNoted.current.add(m.id);
    diag.current.push(`skipped (not seen) ${m.id}`);
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
  // Abrufkarten nehmen nur Momente aus dem Fokus (Entscheidung 39)
  const findMoment = (id: string): Moment | undefined => {
    const m = stateRef.current.savedMoments[id]?.moment ?? pool.find((x) => x.id === id);
    const f = focusRef.current;
    return m && focusActive(f, clockNow().getTime()) && !inFocus(m, f) ? undefined : m;
  };
  const rng = useRef<() => number>();
  rng.current ??= makeRng();
  const answerRecall = (got: boolean) => {
    const r = recall;
    recallAnswered.current = true;
    // Richtig beantwortet ist ein starkes Plus für Kanal und Thema (Issue 24). Falsch ändert die Gewichte nicht.
    if (r) {
      const at = clockNow().getTime();
      const q = r.m.recall;
      update((s) => {
        const next: AppState = { ...s, recall: answer(s.recall ?? {}, r.m.id, got, at, !!r.m.recallBoost), dayCount: got ? countGotIt(s.dayCount, today) : s.dayCount, momentWeights: got ? signal(s.momentWeights, r.m, SIGNAL.recall, at) : s.momentWeights };
        // Falsch beantwortet: für die Leseliste "Missed" im Sonntags-Digest vormerken (Entscheidung 35, höchstens 20)
        return !got && q ? addMissed(next, { id: r.m.id, question: q.question, correct: q.options[q.correct], why: q.why, ...(fullVideoUrl(r.m) ? { source: fullVideoUrl(r.m) } : {}), ...(r.m.videoTitle ? { videoTitle: r.m.videoTitle } : {}), at }) : next;
      });
    }
  };
  const closeRecall = () => {
    recallRef.current = false;
    recallAnswered.current = false;
    recallEntry.current = null;
    setRecall(null);
    since.current = Date.now();
    if (!textRef.current && active && !userPaused.current) current().player?.playVideo();
    // Tempo nach der Karte erneut setzen, YouTube fällt nach Pause auf 1x zurück (Max 31.10.)
    applyRate();
  };

  const closeForYou = () => {
    window.clearTimeout(forYouTimer.current);
    forYouRef.current = false;
    setForYou(null);
  };

  /**
   * Audio-Reiter, Entscheidung 45: Ein Moment, der erreichbar ist und die Bedingung erfüllt, rückt an die Stelle idx+1. Sichtbar innerhalb der nächsten drei,
   * verdeckt aus dem ganzen Rest. Gibt den Ausgang zurück (held, pulled, net, none) und setzt bei pulled die Warteschlange um.
   */
  const pullBy = (held: (m: Moment) => boolean, hidden: boolean) => {
    if (form !== 'audio' || !pre) return { how: 'none' as const };
    const r = lockNextPlan(queue.current, idxRef.current, held, hidden);
    if (r.how === 'pulled') applyQueue(r.queue);
    return r;
  };
  /** Neue Reihenfolge ab idx+1 übernehmen: Slots hinter dem laufenden Moment neu belegen, Vorrat und Blob-URLs auf das neue Fenster */
  const applyQueue = (q: Moment[]) => {
    queue.current = q;
    for (const sl of slots.current) if (sl.index >= idxRef.current + 1) sl.index = -1;
    if (!single) for (const k of [idxRef.current + 1, idxRef.current + 2]) if (k < queue.current.length && slotFor(k).index !== k) assign(slotFor(k), k, false);
    syncPre(idxRef.current);
  };
  /** Nachfolger aus dem Vorrat (Blob oder Cache), nie vom Netz, solange einer erreichbar ist (Entscheidung 45) */
  const pullStock = (hidden: boolean) => (pre ? pullBy((m) => LOCAL.has(keyOf(m)) || pre.held(m.id), hidden) : { how: 'none' as const });

  /**
   * Element-Vorrat füllen (Entscheidung 52, Brief 14): solange die App sichtbar ist, halten fünf Audio-Elemente die nächsten fünf Momente fertig geladen, lokal
   * bevorzugt, sonst Netz. Aufruf nach jedem Wisch, nach jedem "deck play ok", beim Wechsel in den Audio-Reiter und bei der Rückkehr in die App. Verdeckt
   * tut er nichts (iOS lädt dann nichts nach, die Warteschlange bleibt stehen).
   */
  const warmTried = useRef(new Set<string>());
  const fillPool = () => {
    if (form !== 'audio' || !pre || !activeRef.current) return;
    if (isBackground(document.visibilityState)) return;
    pruneBad();
    ensureQueue(idxRef.current + 1 + POOL_AHEAD + 3);
    // Schwaches Netz und der Nachfolger liegt nicht im Vorrat: ein Vorrats-Moment aus den nächsten drei rückt nach idx+1, damit das erste Element lokal wird
    const first = queue.current[idxRef.current + 1];
    if (first && !pre.held(first.id) && pre.poor()) pullBy((m) => pre.held(m.id), false);
    // Mindestens 3 der nächsten 6 liegen im Vorrat, sonst rücken Vorrats-Momente von weiter hinten in die ersten Plätze (idx+1 bleibt)
    const d = depthPlan(queue.current, idxRef.current, (m) => pre.held(m.id), 3, POOL_WINDOW);
    if (d.moved > 0) {
      applyQueue(d.queue);
      diag.current.push(`stock: depth ${d.have} of 6 (pulled ${d.moved})`);
    }
    // Brief 14b, Schritt 1: hält der Vorrat weniger als 3 der nächsten 6, wird sichtbar sofort nachgeladen (Vorrats-Logik aus Brief 02: Fehlversuche vergessen,
    // nächstgelegene fehlende Momente zuerst). Höchstens alle 5 s, damit ein Host ohne Antwort nicht gehämmert wird. Neuer Vorrat löst über das Abo unten einen neuen fillPool aus.
    if (d.have < 3) {
      if (lowDepth.current !== d.have) {
        lowDepth.current = d.have;
        diag.current.push(`stock: low ${d.have} of 6, loading`);
      }
      if (Date.now() - lastResume.current > 5000) {
        lastResume.current = Date.now();
        pre.resume();
      }
    } else lowDepth.current = -1;
    // Kandidaten für den Element-Vorrat: die nächsten 6 (nicht mehr nur 5), das Deck wählt daraus lokale zuerst
    const next: Moment[] = [];
    for (let j = idxRef.current + 1; j < queue.current.length && next.length < POOL_WINDOW; j++) {
      const m = queue.current[j];
      if (!bad.current.has(m.videoId) && formOf(m) === 'audio' && deckClipOf(m)) next.push(m);
    }
    // Ein Vorrats-Moment ohne Blob-URL bekommt sie zuerst (keine zweite Netzverbindung neben dem Vorrat, Entscheidung 45), dann lädt sein Element lokal.
    // Einmal je Moment: kommt die Blob-URL nicht, lädt er danach vom Netz.
    const wait = next.filter((m) => !LOCAL.has(keyOf(m)) && pre.held(m.id) && !warmTried.current.has(m.id));
    if (wait.length) {
      for (const m of wait) warmTried.current.add(m.id);
      void pre.warm(wait).then(() => fillPoolRef.current());
    }
    const netOk = !pre.poor();
    // Brief 20, Schritt 2: der Vorrat hat Vorrang. Solange er dünn ist (unter 3 der nächsten 6) und gerade lädt, startet der Pool keine NEUEN Netz-Elemente,
    // höchstens 3 s ab dem ersten Warten. Danach (oder sobald der Vorrat reicht) lädt er wie gehabt vom Netz. Schon laufende Elemente bleiben unberührt.
    const thin = d.have < 3 && pre.busy();
    if (!thin) poolHold.current = 0;
    else if (!poolHold.current) {
      poolHold.current = Date.now();
      window.setTimeout(() => fillPoolRef.current(), 3050);
    }
    const holding = thin && Date.now() - poolHold.current < 3000;
    const inPool = holding ? new Set(audioDeck.poolInfo().map((p) => p.key)) : null;
    const clips: DeckClip[] = [];
    for (const m of next) {
      if (!LOCAL.has(keyOf(m)) && (wait.includes(m) || !netOk)) continue;
      if (inPool && !LOCAL.has(keyOf(m)) && !inPool.has(keyOf(m))) continue;
      const c = deckClipOf(m);
      if (c) clips.push(c);
    }
    audioDeck.fill(clips);
  };
  const fillPoolRef = useRef(fillPool);
  fillPoolRef.current = fillPool;

  /** Der Moment, auf den das Deck getauscht hat (Schlüssel), rückt an idx+1, falls er dort noch nicht steht: danach liest goTo dieselbe Stelle */
  const placeNext = (key: string) => {
    const at = idxRef.current + 1;
    const j = queue.current.findIndex((x, i) => i >= at && keyOf(x) === key);
    if (j === at) return;
    const q = [...queue.current];
    const m = j >= 0 ? q.splice(j, 1)[0] : pool.find((x) => keyOf(x) === key);
    if (!m) {
      diag.current.push(`bg: swap target not in queue ${key}`);
      return;
    }
    q.splice(at, 0, m);
    applyQueue(q);
  };

  const placeNextRef = useRef(placeNext);
  placeNextRef.current = placeNext;

  /** Das Deck hat im Hintergrund selbst getauscht (Ende eines Moments): der Schlüssel des Moments, der jetzt spielt. Fehlt er, stand kein Element bereit. */
  const advancedTo = useRef<string | null>(null);
  /** Der Moment endete verdeckt ohne bereites Element: bei der Rückkehr geht es mit dem nächsten weiter */
  const resumeNext = useRef(false);

  /**
   * Weiter vom Sperrbildschirm oder der Medientaste (Brief 14, Entscheidung 52): das Deck tauscht auf das erste bereite Element des Vorrats, es wird nichts geladen
   * und keine Quelle gewechselt. Ist keins bereit, geschieht verdeckt nichts: der laufende Moment spielt zu Ende, nichts wird gezählt, nie ein Netzstart
   * verdeckt. Sichtbar ohne bereites Element gilt der normale Weg (Vorrat zuerst, sonst Netz mit der Laden-Pille).
   */
  const lockNext = () => {
    const hidden = isBackground(document.visibilityState);
    if (form !== 'audio' || !pre) {
      goTo(idxRef.current + 1);
      return;
    }
    pruneBad();
    const c = audioDeck.swapNext();
    if (c) {
      placeNext(c.key);
      goTo(idxRef.current + 1);
      return;
    }
    if (hidden) {
      diag.current.push('lock next: stay (pool empty)');
      return;
    }
    ensureQueue(idxRef.current + 1 + queueAhead(rateRef.current));
    const s = pullStock(false);
    if (s.how === 'pulled') diag.current.push(`lock next: pulled ${s.id}`);
    else if (s.how === 'net') diag.current.push(`lock next: net ${s.id}`);
    else if (s.how === 'held') diag.current.push(`lock next: held ${s.id}`);
    goTo(idxRef.current + 1);
  };
  const lockNextRef = useRef(lockNext);
  lockNextRef.current = lockNext;

  /**
   * Hänge-Überwachung verdeckt (Brief 14b, Issue 40, Entscheidung 45): ein Moment, der nach 12 s nicht anspielt, wird verdeckt nie übersprungen. Ist ein anderes
   * Element des Vorrats bereit, tauscht das Deck darauf (wie Weiter am Sperrbildschirm, lokale zuerst). Sonst bleibt alles stehen, nichts wird geladen, nichts gezählt.
   * Der hängende Moment bleibt ungesehen: er bekommt nur die Sitzungs-Sperre und eine eigene Zeile statt "skipped (not seen)".
   * Zurück zum vorigen Element gibt es nicht: der Tausch hat es angehalten, und ein Schritt zurück verschöbe Warteschlange, Zähler und Signale.
   */
  const hungHidden = (m: Moment) => {
    if (form === 'audio' && audioDeck.hungAction() === 'swap') {
      const c = audioDeck.swapNext();
      if (c) {
        bad.current.add(m.videoId);
        unplayedNoted.current.add(m.id);
        placeNext(c.key);
        goTo(idxRef.current + 1);
        diag.current.push(`lock: stuck ${m.id}, not seen, swapped to ${queue.current[idxRef.current]?.id ?? c.id}`);
        return;
      }
    }
    if (!stuckNoted.current.has(m.id)) {
      stuckNoted.current.add(m.id);
      diag.current.push('lock: stuck, stay');
    }
  };
  const hungHiddenRef = useRef(hungHidden);
  hungHiddenRef.current = hungHidden;

  /**
   * Gescheiterte Momente aus dem Rest der Warteschlange nehmen (Wisch und Auto-Weiter lesen danach dieselbe Stelle). Verdeckt im Audio-Reiter nur entfernen, nie
   * umstellen: die nächsten fünf Momente stecken schon in Elementen des Vorrats (Brief 14, Schritt 3).
   */
  const pruneBad = () => {
    const from = idxRef.current + 1;
    // Entscheidung 45: fehlt ein Nachbar an idx+1 oder idx+2, füllt der nächste Moment mit anderem Bereich die Lücke (pruneAndHeal)
    const prune = form === 'audio' && isBackground(document.visibilityState) ? pruneOnly : pruneAndHeal;
    const next = prune(queue.current, idxRef.current, (x) => bad.current.has(x.videoId));
    if (next.length !== queue.current.length) {
      queue.current = next;
      for (const sl of slots.current) if (sl.index >= from) sl.index = -1;
    }
  };

  /** Media Session: Zustand setzen und jeden Wechsel mit Grund ins Protokoll (Issue 13: pausiert die App die Session im Hintergrund?) */
  const setPlaybackState = (s: 'playing' | 'paused', why: string) => {
    const ms = navigator.mediaSession;
    if (ms.playbackState !== s) diag.current.push(`bg: mediasession ${ms.playbackState} to ${s} (${why}) hidden=${isBackground(document.visibilityState)}`);
    ms.playbackState = s;
  };

  /** Anzeige des Betriebssystems (Sperrbildschirm) sofort setzen, nicht erst nach dem nächsten Rendern, das im Hintergrund gedrosselt wird */
  const setMeta = (cur: Moment | undefined) => {
    if (!cur || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    // Audio-Reiter: Hook, Kanal, Folge und das Bild des Reiters (Entscheidung 24). Sonst wie bisher.
    navigator.mediaSession.metadata = new MediaMetadata(
      form === 'audio' ? lockMeta(cur, import.meta.env.BASE_URL, location.origin) : { title: cur.hook, artist: speakerLine(cur.channel), album: AREA_LABEL[cur.area], artwork: [{ src: thumbOf(cur) }] },
    );
  };

  /** Darf jetzt eine Abrufkarte erscheinen? Feed-Reiter offen, Seite sichtbar, kein Blatt, keine Übersicht (Pfeiler 19) */
  const recallCtx = () => ({ active: activeRef.current, visible: !isBackground(document.visibilityState), note: !!noteRef.current, sheet: !!(deskRef.current?.help || deskRef.current?.sheet) });
  const openRecall = (e: QueueEntry, fromQueue: boolean) => {
    const rm = findMoment(e.id);
    if (!rm) return false;
    recallRef.current = true;
    recallAnswered.current = false;
    recallEntry.current = e;
    current().player?.pauseVideo();
    setRecall({ m: rm, review: e.review });
    if (fromQueue) diag.current.push(`recall: shown ${e.id} from queue`);
    return true;
  };
  /** Warteschlange und Wiedervorlage in den State, sofort auch in stateRef (mehrere Schritte im selben Takt) */
  const putQueue = (queue: QueueEntry[], recall: AppState['recall']) => {
    stateRef.current = { ...stateRef.current, recallQueue: queue, recall };
    update((s) => ({ ...s, recallQueue: queue, recall }));
  };
  /** Ein Wisch nach vorn: neue Karte (oder keine) und Warteschlange in einem Schritt */
  const stepRecall = (pick: { id: string; review: boolean } | null) => {
    const s0 = stateRef.current;
    const q0 = s0.recallQueue ?? [];
    if (!pick && !q0.length) return;
    let step = onSwipe(q0, s0.recall ?? {}, pick, canShowRecall(recallCtx()), clockNow().getTime());
    // Eine Karte, deren Moment nicht mehr im Pool ist, kann nicht erscheinen: nächste aus der Warteschlange
    while (step.show && !findMoment(step.show.id)) step = onSwipe(step.queue, step.recall, null, true, clockNow().getTime());
    if (pick && step.queue.some((x) => x.id === pick.id)) diag.current.push(`recall: queued ${pick.id}${isBackground(document.visibilityState) ? ' (bg)' : ''}`);
    if (step.queue !== q0 || step.recall !== (s0.recall ?? {})) putQueue(step.queue, step.recall);
    if (step.show) openRecall(step.show, step.fromQueue);
  };
  /** Zurück im Feed: eine Karte sofort, vor dem nächsten Wisch */
  const showFromQueue = () => {
    if (recallRef.current || forYouRef.current) return;
    let q = stateRef.current.recallQueue ?? [];
    while (q.length) {
      const r = onReturn(q, canShowRecall(recallCtx()));
      if (!r.show) return;
      q = r.queue;
      putQueue(q, stateRef.current.recall ?? {});
      if (openRecall(r.show, true)) return;
    }
  };

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next === idxRef.current) return;
      // Ein abgelaufener Fokus endet bei jedem Wechsel (Entscheidung 39)
      if (focusRef.current && !focusActive(focusRef.current, clockNow().getTime())) clearFocus();
      closeForYou();
      pruneBad();
      ensureQueue(next + queueAhead(rateRef.current));
      // Genau hinter dem letzten Moment liegt die Endseite (idx = Länge). Weiter geht es nicht.
      if (next > queue.current.length) return;
      syncPre(next);
      const prev = idxRef.current;
      diag.current.push(`go ${prev}->${next}`);
      const prevM = queue.current[prev];
      // Entscheidung 45: der verlassene Moment ist gesehen, wenn er mindestens eine Sekunde gespielt hat, sonst bleibt er ungesehen im Pool
      if (prevM && !textRef.current) {
        played.current.set(prevM.id, false);
        if (played.current.enough(prevM.id)) markSeen(prevM);
        else noteUnplayed(prevM);
      }
      // Weitergewischt: Wertung nach geschautem Anteil (learn.ts). Unter 3 s ist ein Skip (Kanal und Thema mal 0,97), zwei Skips derselben
      // Folge in 7 Tagen setzen die Folge 7 Tage auf 0,5 (Entscheidung 38). Im Textmodus gibt es keine Wiedergabezeit,
      // darum keine Zeitwertung. Nach einem Chip ersetzt dessen Wirkung die Wertung (silentLeave).
      const nowMs = clockNow().getTime();
      let dampened = false;
      let attentionStarted = false;
      const silent = silentLeave.current; // gilt für genau diesen Wechsel (er kommt mit der Feder erst am Ende der Animation)
      silentLeave.current = false;
      if (next > prev && prevM) {
        const timed = endedAt.current !== prev && !textRef.current && !silent;
        const watchedSec = (Date.now() - since.current) / 1000;
        const lv = timed ? leaveOf(watchedSec, prevM.end - prevM.start) : null;
        // Zweimal vor 5 s weggewischt: abgelehnt, gilt als gesehen, kommt nie wieder (Entscheidung 36)
        if (timed && isQuickSkip(watchedSec) && played.current.any(prevM.id)) update((s) => quickSkip(s, prevM, nowMs).state);
        // Drei Skips unter 3 s in Folge: die nächsten 10 Momente ohne lange Momente und ohne Brain-Text (Issue 26), Rest der Schlange neu gewählt
        if (timed) {
          const st = attentionStep(attention.current, lv?.kind === 'skip', prev);
          attention.current = st.att;
          if (st.started) attentionStarted = true;
        }
        if (lv?.kind === 'skip') {
          // Zwei Skips beim selben Kanal oder Thema dämpfen beide für den Rest der Sitzung (Issue 24), siehe Ende dieser Funktion
          dampened = !!cursor.current && sessionSkip(cursor.current, prevM);
          update((s) => {
            const r = skipRule({ weights: s.momentWeights, taps: s.tapLog ?? {} }, prevM, nowMs);
            return bumpCell({ ...s, momentWeights: r.weights, tapLog: r.taps }, today, hourKey(clockNow()), prevM, 'skips');
          });
        }
        else if (lv) update((s) => ({ ...s, momentWeights: signal(s.momentWeights, prevM, lv.f, nowMs) }));
      }
      // Gezeigtes Paar zählen (Digest mixClump), jedes Paar der Sitzung einmal
      const shownNext = queue.current[next];
      if (next === prev + 1 && prevM && shownNext) {
        const pk = `${prevM.id}>${shownNext.id}`;
        if (!pairsSeen.current.has(pk)) {
          pairsSeen.current.add(pk);
          update((s) => bumpPair(s, today, prevM, shownNext));
        }
      }
      // Position des Reiters merken (Entscheidung 36)
      if (shownNext) update((s) => setTabCursor(s, form, shownNext.id, today));
      // Zurückgewischt, um etwas nochmal zu sehen: Plus für den Zielmoment
      const backM = queue.current[next];
      if (next < prev && backM) update((s) => ({ ...s, momentWeights: signal(s.momentWeights, backM, SIGNAL.back, nowMs) }));
      setCaption('');
      shownCue.current = -2;
      clock.current.reset();
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
        if (cardDue(sessionSeen.current) && !recallQuiet(rateRef.current, Date.now() - sessionT0.current)) {
          const s0 = stateRef.current;
          const queued = new Set((s0.recallQueue ?? []).map((x) => x.id));
          recallNow = pickRecall(s0.recall ?? {}, recent.current, clockNow().getTime(), (id) => !queued.has(id) && !s0.momentRejected?.[id] && !!findMoment(id)?.recall);
        }
      }
      if (prevM && endedAt.current !== prev) log(prevM, {});
      current().player?.pauseVideo();
      idxRef.current = next;
      if (msOnRef.current) setMeta(queue.current[next]);
      since.current = Date.now();
      endedAt.current = -1;
      userPaused.current = false;
      setPaused(false);
      setProgress(0);
      const target = slotFor(next);
      const nm = queue.current[next];
      // Gepuffert heißt: der Vorlade-Player hält genau diesen Moment schon angehalten am Start
      // Ein Stream-Moment (Podcast, Vorrat) hält angehalten im Zustand CUED und gilt als geladen, sobald das erste Bild Daten hat
      const holds = !single && !!nm && target.mid === nm.id;
      const ready = !single && !!nm && target.ready && holds && (target.warm === 'done' || target.st === STATE.PAUSED || (target.st === STATE.CUED && !!target.player?.isBuffered?.()));
      const t0 = performance.now();
      swipe.current = { j: next, t0, buffered: ready };
      // Warmlauf, Abdeckfläche und Nachrücken (warmup.ts), bevor assign den Slot anfasst
      const plan = single
        ? null
        : swipePlan(next, slots.current.slice(0, SLOTS).map((x): SlotView => ({ index: x.index, warm: x.warm, visited: x.visited, warmPlayedMs: x.warm === 'running' && x.warmAt ? t0 - x.warmAt : 0 })), warmCtxOf);
      vstat.current = { j: next, t0, readyAt: ready ? 0 : null, mode: holds ? (target.warm === 'done' ? 'warm' : target.warm === 'running' ? 'warming' : ready ? 'paused' : 'cold') : 'cold', done: false };
      const play = !textRef.current;
      // Lief der Vorlade-Player schon (Warmlauf), kommt kein neues PLAYING: die Spielzeit beginnt jetzt
      if (play && holds && nm && target.st === STATE.PLAYING) played.current.set(nm.id, true);
      if (single) assign(slots.current[0], next, play);
      else {
        assign(slotFor(next), next, play);
        for (const j of [next + 1, next + 2]) if (slotFor(j).index !== j) assign(slotFor(j), j, false);
      }
      if (plan) {
        const tgt = slots.current[plan.target];
        if (tgt.index === next) {
          // Der Slot ist jetzt der aktuelle: kein Warmlauf mehr, die Abdeckfläche (Rest oder voll) beginnt mit PLAYING
          window.clearTimeout(tgt.warmTimer);
          tgt.warmTimer = 0;
          window.clearTimeout(tgt.coverTimer);
          tgt.coverMs = plan.coverMs;
          tgt.coverEnd = 0;
          setCover(tgt, false);
          tgt.warm = 'done';
          // Lief der Warmlauf noch, spielt der Slot schon: es kommt kein neues PLAYING, also hier starten und das erste Bild melden
          if (tgt.st === STATE.PLAYING && play) {
            tgt.playedAt ||= t0;
            startCover(tgt);
            frameDone(tgt);
          }
        }
        if (plan.promote !== null) promoteWarm(slots.current[plan.promote], plan.promote);
      }
      // Gesehen zählt nicht beim Ankommen (Entscheidung 45), sondern nach einer Sekunde Spielzeit (Abfrage unten) oder beim Ende (finish)
      textSeen.current = -1;
      if (textBox.current) textBox.current.scrollTop = 0;
      if (!textRef.current) soundGuard(next);
      // Pfeiler 19: nie eine Karte, solange der Feed nicht im Vordergrund und sichtbar ist. Dann Warteschlange, je eine Karte pro Wisch.
      if (next > prev && prevM) stepRecall(recallNow);
      fillPoolRef.current();
      syncHint();
      // Gedämpfter Kanal oder gedämpftes Thema: der Rest hinter den zwei vorgeladenen Momenten wird neu gewählt
      if (dampened || attentionStarted) replanRef.current(next + 3);
      const nSrc = mediaWithSrc();
      if (nSrc > POOL_AHEAD + 1) diag.current.push(`media: ${nSrc} elements with src (limit ${POOL_AHEAD + 1})`);
      // Issue 44: verdeckt (Sperrbildschirm, Weiter, Ende des Ausschnitts) wartet die Oberfläche nicht auf das Rendern im Hintergrund, das iOS drosselt:
      // Index, Artwork, Hook und Quelle werden sofort gezeichnet, damit nach dem Entsperren kein alter Moment steht. Geladen wird dabei nichts.
      if (form === 'audio' && isBackground(document.visibilityState)) {
        try {
          flushSync(() => setIdx(next));
        } catch {
          setIdx(next);
        }
        diag.current.push(`ui: synced to ${queue.current[next]?.id ?? next} after swap`);
      } else setIdx(next);
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
    update((s) => bumpCell({ ...s, momentWeights: signal(s.momentWeights, m, SIGNAL.ended, clockNow().getTime()) }, today, hourKey(clockNow()), m, 'done'));
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
      // Auto-Weiter im Hintergrund: derselbe Weg wie der Wisch, ohne Für-dich-Karte. Im Audio-Reiter hat das Deck den Tausch schon vollzogen (Brief 14, Schritt 4).
      const j = idxRef.current + 1;
      if (form === 'audio') {
        const to = advancedTo.current;
        advancedTo.current = null;
        if (!to) {
          // Kein bereites Element: verdeckt wird nichts geladen. Die Rückkehr startet den nächsten Moment.
          diag.current.push(`bg: stalled at ${m.id} (pool empty)`);
          resumeNext.current = true;
          return;
        }
        placeNextRef.current(to);
      }
      goTo(j);
      const nm = queue.current[idxRef.current];
      diag.current.push(idxRef.current === j && nm ? `bg: next ${nm.id}` : `bg: stalled at ${m.id} (no next)`);
      // Kein Stopp-Zeitgeber mehr (Issue 11). Verweigert der Browser play(), steht "bg: play rejected" im Protokoll und die Rückkehr startet sofort.
    } else if (m.forYou) {
      forYouRef.current = true;
      setForYou(m);
      forYouTimer.current = window.setTimeout(() => navRef.current(idxRef.current + 1), FOR_YOU_MS);
    } else navRef.current(idxRef.current + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTo]);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Audio-Reiter (Issue 11): das eine Audio-Element wechselt im Hintergrund selbst zum Nachfolger, danach folgt hier die Buchführung
  // (gesehen beim Ende, Signale, Warteschlange). Beim Verlassen des Reiters gibt der Feed das Element frei.
  useEffect(() => {
    if (form !== 'audio') return;
    audioDeck.diag = (line) => diag.current.push(line);
    // Brief 20: jedes Ergebnis des Vorrats-Ladens (+1, fail, 6 of 6) steht im Protokoll
    pre?.setDiag((line) => diag.current.push(line));
    audioDeck.onAdvance = (_from, to) => {
      advancedTo.current = to.key;
      finishRef.current();
    };
    // Nach jedem erfüllten play() den Vorrat auffüllen (Brief 14, Schritt 2). Verdeckt tut das nichts.
    audioDeck.onPlayed = () => fillPoolRef.current();
    audioDeck.onNeedFill = () => fillPoolRef.current();
    // Kaltstart: auf die Blob-URL aus dem Vorrat warten statt vom Netz zu starten
    audioDeck.pending = (id, key) => pre?.pendingWarm(id, key) ?? null;
    // Zähler coldNetStarts: jeder Start einer Quelle vom Netz, pro Tag
    audioDeck.onMedia = (e) => lockHandlersRef.current(e);
    audioDeck.onStart = ({ clip, local }) => {
      if (local) return;
      let store: Storage | null = null;
      try {
        store = localStorage;
      } catch {
        store = null;
      }
      const day = dayKey(clockNow());
      const n = countColdStart(store, day);
      // Im Sync-Stand pro Tag (signals.days[Tag].coldNetStarts, Brief 03), der lokale Zähler bleibt für die Diagnose und die Tests
      update((st) => bumpColdNetStart(st, day));
      diag.current.push(`signals: coldNetStarts ${n} today (net start ${clip.id})`);
    };
    // Netzstart ohne Daten: Hinweis nach 500 ms, bis canplay kommt
    let waitTimer = 0;
    audioDeck.onLoading = (on) => {
      window.clearTimeout(waitTimer);
      if (on) waitTimer = window.setTimeout(() => setDeckWait(true), 500);
      else setDeckWait(false);
    };
    // Brief 14b, Schritt 1: kommt Vorrat dazu, wird einer warm oder fällt welcher weg, ordnet sich der Element-Vorrat neu (lokale zuerst). Sonst bliebe ein Vorrats-Moment, der erst
    // nach dem letzten Füllen ankam, bis zum nächsten Wisch im Netz. fillPool tut verdeckt nichts. Nur wenn sich die Zahl ändert, kurz gebündelt.
    const stockSig = () => (pre ? `${pre.stats().n}:${pre.warmCount()}` : '');
    let stockN = stockSig();
    let stockTimer = 0;
    const offStock = pre?.subscribe(() => {
      const n = stockSig();
      if (n === stockN) return;
      stockN = n;
      window.clearTimeout(stockTimer);
      stockTimer = window.setTimeout(() => fillPoolRef.current(), 250);
    });
    return () => {
      window.clearTimeout(waitTimer);
      window.clearTimeout(stockTimer);
      offStock?.();
      pre?.setDiag(null);
      audioDeck.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wechsel in den Audio-Reiter: der Element-Vorrat füllt sich sofort (Brief 14, Schritt 2)
  useEffect(() => {
    if (active && form === 'audio') fillPoolRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /**
   * Rest der Warteschlange ab from neu planen (Netz wurde schlecht): Die freigegebenen Momente stehen wieder zur Wahl,
   * nextMoment füllt mit Rang als Gewicht auf (vorgeladen und Text mal 3). Verlauf, Regeln, Anteile und Lernen bleiben wie sonst.
   */
  const replanTail = (fromAsked: number) => {
    // Verdeckt stecken die nächsten fünf Momente im Element-Vorrat des Decks: Neuplanen beginnt frühestens hinter ihnen (Entscheidung 42, Brief 14 Schritt 3)
    const from = form === 'audio' ? replanStart(fromAsked, idxRef.current, isBackground(document.visibilityState)) : fromAsked;
    const tail = queue.current.slice(from);
    if (!tail.length || !cursor.current) return;
    releaseTail(cursor.current, tail, clockNow().getTime());
    queue.current = queue.current.slice(0, from);
    for (const sl of slots.current) if (sl.index >= from) sl.index = -1;
    ensureQueue(from + tail.length);
    if (!single) for (const j of [idxRef.current + 1, idxRef.current + 2]) if (j >= from && j < queue.current.length && slotFor(j).index !== j) assign(slotFor(j), j, false);
    diag.current.push(`replan from ${from} poor=${poorRef.current}`);
    syncPre(idxRef.current);
    fillPoolRef.current();
    rerender();
  };
  /** Mitten in der Sitzung: nur neu mischen (siehe remixTail), die schon vorgeladenen Momente bleiben in der Warteschlange */
  const reorderTail = (fromAsked: number) => {
    if (!pre) return;
    const from = form === 'audio' ? replanStart(fromAsked, idxRef.current, isBackground(document.visibilityState)) : fromAsked;
    const tail = queue.current.slice(from);
    if (tail.length < 2) return;
    const s0 = stateRef.current;
    queue.current = [...queue.current.slice(0, from), ...remixTail(tail, historyBefore(queue.current, from, seedHist.current), { areaShares: s0.settings.areaShares, weights: s0.momentWeights, seen: s0.momentSeen, mutedChannels: s0.mutedChannels, now: clockNow().getTime(), rank: netRank(pre.has), ctx: ctxOf(s0) }, rng.current)];
    for (const sl of slots.current) if (sl.index >= from) sl.index = -1;
    if (!single) for (const j of [idxRef.current + 1, idxRef.current + 2]) if (j >= from && j < queue.current.length && slotFor(j).index !== j) assign(slotFor(j), j, false);
    diag.current.push(`reorder from ${from}`);
    syncPre(idxRef.current);
    fillPoolRef.current();
    rerender();
  };
  const replanRef = useRef(replanTail);
  replanRef.current = replanTail;
  const reorderRef = useRef(reorderTail);
  reorderRef.current = reorderTail;

  /** Nach dem Wechsel von Stub zu echter YouTube-API: gesperrte YouTube-Momente wieder zulassen, Player neu anlegen */
  const ytBack = () => {
    if (!ytStub.current) return;
    ytPending.current = true;
    tryYtRebuild();
  };
  /**
   * Der Neuaufbau zerstört alle Player und bringt neue Elemente, auf denen iOS den Ton nicht ohne neuen Tipp freigibt. Darum
   * wartet er, bis der Moment nicht mehr spielt (Pause, Ende, Text) oder ein YouTube-Moment dran ist, den der Ersatz ohnehin nicht spielen kann.
   * Der Moment läuft danach an derselben Stelle weiter (resume).
   */
  const tryYtRebuild = () => {
    if (!ytPending.current || !ytStub.current) return;
    const cs = current();
    const cm = queue.current[idxRef.current];
    const idle = !cm || textRef.current || cs.st === STATE.PAUSED || cs.st === STATE.ENDED || streamKind(cm) === 'youtube';
    if (!idle) return;
    ytPending.current = false;
    ytStub.current = false;
    if (cm && cs.mid === cm.id && cs.pos > cm.start) resume.current = { mid: cm.id, pos: cs.pos };
    for (const id of [...bad.current]) if (isYtId(id)) bad.current.delete(id);
    diag.current.push('net: players rebuilt');
    setYtEpoch((e) => e + 1);
  };
  const ytRebuildRef = useRef(tryYtRebuild);
  ytRebuildRef.current = tryYtRebuild;
  const ytBackRef = useRef(ytBack);
  ytBackRef.current = ytBack;

  /** Slot nach einem Netzfehler an derselben Stelle wieder aufnehmen: gleicher Moment, gleiches Cover, gleiche Untertitel, gleicher Ton */
  const recoverSlot = (slot: Slot, why: string) => {
    const n = slots.current.indexOf(slot);
    const m = queue.current[slot.index];
    if (!slot.player || !slot.ready || !m || m.form === 'text' || !slot.mid || slot.mid !== m.id) return;
    const isCur = slot.index === idxRef.current;
    const play = isCur && active && !userPaused.current && !textRef.current && !forYouRef.current && !recallRef.current;
    try {
      if (!slot.player.recoverAt) throw new Error('no recoverAt');
      if (play) applySound(slot.player);
      else slot.player.mute();
      slot.player.recoverAt(resumePos(slot.pos, m), play);
      slot.broken = false;
      diag.current.push(`net: recover slot${n} ${m.id} ok`);
      if (play) soundGuard(slot.index);
    } catch (e) {
      slot.broken = true;
      diag.current.push(`net: recover slot${n} ${m.id} fail`);
      diag.current.push(`recover cause ${why}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const recoverRef = useRef(recoverSlot);
  recoverRef.current = recoverSlot;

  // Player anlegen
  useEffect(() => {
    let cancelled = false;
    ensureQueue(queueAhead(rateRef.current));
    if (!queue.current.length) return;
    const begin = (YT: Awaited<ReturnType<typeof loadYT>>) => {
        if (cancelled) return;
        // Issue 22: Vorlade-Player warten, bis der aktuelle Moment spielt (höchstens GATE_MS), Messung Start bis erstes Bild
        gateOpen.current = false;
        gateWait.current.clear();
        window.clearTimeout(gateTimer.current);
        gateTimer.current = window.setTimeout(() => openGateRef.current('timeout'), GATE_MS);
        vstat.current = { j: idxRef.current, t0: performance.now(), readyAt: null, mode: 'cold start', done: false, start: true };
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
            const pl = createPlayer(YT, target, id, {
              onDiag: (line) => diag.current.push(`slot${s} ${line}`),
              getRate: () => clampRate(rateRef.current),
              onTime: (t, rate, playing) => {
                if (slot.index === idxRef.current) clock.current.sample(t, performance.now(), rate, playing);
              },
              onSound: () => {
                if (slot.index === idxRef.current) syncHintRef.current();
              },
              onReady: () => {
                slot.ready = true;
                const vsr = vstat.current;
                if (vsr && slot.index === vsr.j && vsr.readyAt === null) vsr.readyAt = Math.round(performance.now() - vsr.t0);
                slot.player!.mute();
                assign(slot, slot.index, slot.index === idxRef.current && !textRef.current);
                rerender();
              },
              onState: (st) => {
                diag.current.push(`slot${s} ${slot.mid} state ${st}`);
                slot.st = st;
                // Spielzeit des aktuellen Moments (Entscheidung 45)
                const pm = queue.current[slot.index];
                if (pm && slot.index === idxRef.current && !textRef.current) played.current.set(pm.id, st === STATE.PLAYING);
                // Vorschaubild bleibt bis zum ersten Bild: ohne Umweg über React, damit kein Frame der YouTube-Oberfläche durchrutscht
                slot.el?.toggleAttribute('data-live', st === STATE.PLAYING);
                // Issue 22: Bereitschaft des Zielmoments (erster Zustand nach dem Wisch), Gate der Vorlade-Player, Abdeckfläche, Puffer-Stopps
                const vs0 = vstat.current;
                if (vs0 && slot.index === vs0.j && vs0.readyAt === null && st !== STATE.UNSTARTED) vs0.readyAt = Math.round(performance.now() - vs0.t0);
                if (slot.index === idxRef.current) {
                  if (st === STATE.PLAYING) {
                    slot.playedAt ||= performance.now();
                    openGate('first playing');
                    startCover(slot);
                  } else {
                    syncCover(slot);
                    if (st === STATE.BUFFERING && slot.playedAt) {
                      slot.stalls++;
                      diag.current.push(`video: stall #${slot.stalls} ${slot.mid} after ${Math.round((performance.now() - slot.playedAt) / 100) / 10}s, net ${netType()}`);
                    }
                  }
                }
                if (st === STATE.PLAYING) {
                  everPlayed.current = true;
                  slot.broken = false;
                  slot.tries = 0;
                }
                // Der Warmlauf kam vor dem Ablauf der Zeit ans Ende des Ausschnitts: zurück auf den Start und fertig (Sicherheitsnetz, kurze Momente laufen nicht warm)
                if (st === STATE.ENDED && slot.index !== idxRef.current && slot.warm === 'running') {
                  window.clearTimeout(slot.warmTimer);
                  slot.warmTimer = 0;
                  slot.warm = 'done';
                  const mw = queue.current[slot.index];
                  try {
                    if (mw) slot.player?.seekTo?.(mw.start, true);
                    slot.player?.pauseVideo();
                  } catch {
                    /* Player nicht bereit */
                  }
                  diag.current.push(`video: warm ended early slot${s} ${slot.mid}`);
                }
                if (st === STATE.PLAYING && slot.index === idxRef.current) noteLoud(slot, s);
                if (st === STATE.PLAYING && slot.index === idxRef.current && isBackground(document.visibilityState) && !bgStarted.current.has(slot.mid)) {
                  bgStarted.current.add(slot.mid);
                  diag.current.push(`bg: started ${slot.mid}`);
                }
                if (slot.index === idxRef.current && msOnRef.current && 'mediaSession' in navigator) {
                  if (st === STATE.PLAYING) setPlaybackState('playing', 'player state playing');
                  else if (st === STATE.PAUSED || st === STATE.ENDED) setPlaybackState('paused', st === STATE.ENDED ? 'player state ended' : 'player state paused');
                }
                if (st === STATE.PLAYING) frameDone(slot);
                // Gespeichertes Tempo (Pfeiler 17) bei jedem Start, auch nach Neuaufbau oder Wiederaufnahme eines Players
                if (st === STATE.PLAYING && slot.index === idxRef.current) slot.player?.setPlaybackRate(clampRate(rateRef.current));
                if (slot.index === idxRef.current) syncHintRef.current();
                if (st === STATE.ENDED && slot.index === idxRef.current) finish();
                if (st === STATE.PLAYING && (slot.index !== idxRef.current || forYouRef.current || textRef.current || recallRef.current)) {
                  // Der nächste Moment läuft stumm weiter (Warmlauf, bis die YouTube-Einblendung weg ist), jeder andere hält am ersten Bild
                  const role = roleOf(slot.index, idxRef.current);
                  if (slot.index !== idxRef.current && onNonCurrentPlaying(slot.warm, role, canWarm(role, warmCtxOf(slot.index))) === 'hold') startWarmTimer(slot);
                  else slot.player?.pauseVideo();
                }
                if (moving()) pendingRender.current = true;
                else rerender();
              },
              onError: (code) => {
                const m2 = queue.current[slot.index];
                diag.current.push(`slot${s} ${slot.mid} error ${code}`);
                // Netzfehler setzen den Slot nicht zurück und wechseln den Moment nie (Issue 9): warten oder an derselben Stelle weiter.
                // Nur Inhaltsfehler und wiederholtes Scheitern überspringen den Moment.
                const act = errorAction(code, navigator.onLine, slot.tries);
                if (act !== 'skip') {
                  slot.broken = true;
                  if (act === 'recover') {
                    slot.tries++;
                    const mid = slot.mid;
                    window.setTimeout(() => {
                      if (slot.mid === mid && slot.broken) recoverRef.current(slot, 'error');
                    }, 1000 * recoverDelay(slot.tries - 1));
                  }
                  return;
                }
                if (m2) bad.current.add(m2.videoId);
                fillPoolRef.current();
                // Einzelne Fehler überspringen nur. Die Fehlerseite gibt es erst, wenn nie ein Video lief und acht Momente scheiterten.
                if (!everPlayed.current && bad.current.size >= 8) setError(`YouTube spielt gerade keine Videos ab (Fehler ${code})`);
                else if (slot.index === idxRef.current) goTo(idxRef.current + 1);
              },
            });
            // Das Vorschaubild liegt über dem IFrame in jedem Zustand außer PLAYING (Auftrag Max 29.10.2026). Der Zustandswechsel kommt
            // vom IFrame asynchron, also fällt data-live schon beim Befehl, der das Spielen beendet oder einen anderen Inhalt lädt.
            // Issue 46 (Brief 20): Nach einem Pausebefehl zeigt der IFrame auf dem iPhone seine eigene Pausenansicht (Logo, Titel, Avatar, nächste Folge) über dem Standbild,
            // denn sein Video-Layer liegt dort über dem DOM-Nachbarn. Darum ist der IFrame selbst unsichtbar (data-hold, CSS in feed.css), vom Pausebefehl bis zum nächsten
            // Befehl, der etwas abspielt oder lädt. Gesetzt wird es hier beim Befehl, ohne React-Umweg.
            for (const k of ['pauseVideo', 'loadVideoById', 'cueVideoById'] as const) {
              const f = pl[k].bind(pl) as (a?: never) => void;
              pl[k] = ((arg?: never) => {
                slot.el?.removeAttribute('data-live');
                if (k === 'pauseVideo') slot.el?.setAttribute('data-hold', '');
                else slot.el?.removeAttribute('data-hold');
                setCover(slot, false);
                f(arg);
              }) as never;
            }
            {
              const play = pl.playVideo.bind(pl);
              pl.playVideo = () => {
                slot.el?.removeAttribute('data-hold');
                play();
              };
            }
            return pl;
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
        fillPoolRef.current();
    };
    void (async () => {
      if (pre) {
        // Vorrat gelesen: war das Netz schon beim Start schlecht (offline), kommen Vorgeladene und Text zuerst
        await pre.whenReady();
        poorRef.current = pre.poor();
        if (poorRef.current && idxRef.current === 0) {
          // Entscheidung 42: Die Startreihenfolge aus dem Vorrat gilt vor dem Neuplanen. Ein erster Moment, der schon lokal liegt, bleibt stehen, solange nichts gespielt wurde.
          const first = queue.current[0];
          replanRef.current(first && (pre.held(first.id) || LOCAL.has(keyOf(first))) ? 1 : 0);
        }
        syncPre(idxRef.current);
        // Die nächsten Momente als Blob-URL bereit, bevor die Player ihre Quelle bekommen (höchstens 300 ms warten)
        await Promise.race([pre.warm(pre.warmSet(queue.current, idxRef.current, rateRef.current)), new Promise<void>((r) => window.setTimeout(r, 300))]);
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
        ready.then(() => !cancelled && ytBackRef.current(), () => {});
      }
      begin(YT);
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(gateTimer.current);
      gateWait.current.clear();
      for (const s of slots.current) {
        window.clearTimeout(s.warmTimer);
        window.clearTimeout(s.coverTimer);
        s.player?.destroy();
        s.el?.removeAttribute('data-live');
        s.el?.removeAttribute('data-hold');
        Object.assign(s, { player: null, ready: false, index: -1, st: STATE.UNSTARTED, mid: '', broken: false, tries: 0, pos: 0, warm: 'idle', warmTimer: 0, warmAt: 0, visited: false, coverMs: 0, coverEnd: 0, coverTimer: 0, stalls: 0, playedAt: 0 });
        if (s.cover) s.cover.style.visibility = 'hidden';
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
      // Entscheidung 42: Der laufende Moment und die zwei nächsten bleiben stehen, neu gemischt wird erst ab idx+3 (Issue 9 und 31).
      if (poor && Date.now() - lastReplan.current > 20_000) {
        lastReplan.current = Date.now();
        reorderRef.current(idxRef.current + 3);
      }
    };
    const onNet = () => {
      const on = navigator.onLine;
      setOnline(on);
      netAt.current = Date.now();
      check();
      if (!on) return;
      if (ytStub.current) loadYT().then(() => ytBackRef.current(), () => {});
      // Ein Slot mit Netzfehler läuft sofort an derselben Stelle weiter. Ein Slot, der nur stehen blieb (Puffern), bekommt kurz Zeit und wird dann angestoßen.
      for (const sl of slots.current) if (sl.broken) recoverRef.current(sl, 'online');
      for (const wait of [2000, 8000]) {
        window.setTimeout(() => {
          const cs = current();
          if (!navigator.onLine || userPaused.current || textRef.current || forYouRef.current || recallRef.current || !queue.current[idxRef.current]) return;
          if (cs.st !== STATE.PLAYING && cs.st !== STATE.ENDED && cs.st !== STATE.PAUSED) recoverRef.current(cs, 'stalled');
        }, wait);
      }
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
      if (moving()) return;
      const sl = current();
      const p = sl.player;
      const m = queue.current[idxRef.current];
      if (!p || !sl.ready || !m || forYouRef.current || textRef.current || recallRef.current) return;
      const c = p.getCurrentTime?.() ?? 0;
      // Gesehen: mindestens eine Sekunde gespielt (Entscheidung 45). Im Hintergrund zählt das Ende (finish) oder die Rückkehr.
      if (!isBackground(document.visibilityState) && !seenMarked.current.has(m.id) && played.current.enough(m.id)) {
        seenMarked.current.add(m.id);
        markSeenRef.current(m);
      }
      // Laden sichtbar machen, hängende Momente überspringen
      if (sl.st === STATE.PLAYING || userPaused.current) {
        waitSince.current = 0;
        setLoading(false);
      } else {
        waitSince.current ||= Date.now();
        // Ohne Netz, mit Netzfehler im Slot oder kurz nach einem Netzwechsel läuft die Hänge-Überwachung nicht: der Moment wartet, er wird nie übersprungen (Issue 9)
        if (!navigator.onLine || sl.broken || Date.now() - netAt.current < 20_000) waitSince.current = Date.now() - 1000;
        const waited = Date.now() - waitSince.current;
        setLoading(waited > 400);
        // Nur wenn in dieser Sitzung schon etwas lief (sonst blockiert z.B. der Stromsparmodus Autoplay und alles würde übersprungen)
        if (everPlayed.current && waited > 12_000 && c < m.start + 1) {
          // Verdeckt nie überspringen (Brief 14b): tauschen auf ein bereites Element oder stehen bleiben, nächste Prüfung in 12 s
          if (isBackground(document.visibilityState)) {
            diag.current.push(`watchdog ${m.id} (hidden)`);
            waitSince.current = Date.now();
            hungHiddenRef.current(m);
            return;
          }
          diag.current.push(`watchdog ${m.id}`);
          bad.current.add(m.videoId);
          // Nie als gesehen: der Moment bekommt nur die Sitzungs-Sperre und kommt wieder, sobald er lädt (Entscheidung 45)
          noteUnplayed(m);
          waitSince.current = 0;
          goTo(idxRef.current + 1);
          return;
        }
      }
      // Eine Stelle vor dem Start des Moments ist eine Quelle, die gerade neu lädt: Untertitel und Fortschritt bleiben, wie sie waren
      if ((sl.st === STATE.PLAYING || sl.st === STATE.PAUSED) && c >= m.start - 0.5) {
        if (sl.st === STATE.PLAYING) sl.pos = c;
        setProgress(Math.min(1, Math.max(0, (c - m.start) / (m.end - m.start))));
        // Untertitel kommen aus der Uhr (rAF-Schleife unten). Die Abfrage misst nur nach, das ist für YouTube die einzige Quelle.
        // Audio-Reiter: nur das Deck misst (Elementzeit und echtes playbackRate, siehe onTime). Eine zweite Quelle mit dem Tempo der App würde beim Tempowechsel gegenhalten (Issue 15).
        if (!(form === 'audio' && audioDeck.holds(keyOf(m)))) clock.current.sample(c, performance.now(), clampRate(rateRef.current), sl.st === STATE.PLAYING);
      }
      ytRebuildRef.current();
      // Im Hintergrund wechselt im Audio-Reiter das Audio-Element selbst am Ende. Die Abfrage (gedrosselt) greift nur noch als Netz, wenn der Wechsel ausblieb.
      const deckBg = form === 'audio' && isBackground(document.visibilityState);
      if (sl.st === STATE.PLAYING && c >= (deckBg ? m.end + 0.5 : m.end - END_GUARD)) finish();
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

  // Untertitel: Cue-Auswahl nur aus der Zeit des Elements, das Ton ausgibt (timeupdate-Messung plus Weiterrechnen mit playbackRate pro Bild), nie aus Date.now
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (textRef.current || forYouRef.current || recallRef.current || moving()) return;
      const sl = current();
      const m = queue.current[idxRef.current];
      if (!m?.cues || !sl.player || !sl.ready || !clock.current.seen) return;
      if (sl.st !== STATE.PLAYING && sl.st !== STATE.PAUSED) return;
      const t = clock.current.now(performance.now());
      // Eine Stelle vor dem Start des Moments ist eine Quelle, die gerade neu lädt: Untertitel bleiben, wie sie waren
      if (t < m.start - 0.5) return;
      const i = cueIndexAt(m.cues, t - m.start);
      if (i === shownCue.current) return;
      shownCue.current = i;
      setCaption(i >= 0 ? m.cues[i][1] : '');
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  /** Textmodus: gesehen erst, wenn das Ende des Textes sichtbar ist */
  const markTextSeen = () => {
    if (textSeen.current === idxRef.current) return;
    textSeen.current = idxRef.current;
    markSeen(queue.current[idxRef.current]);
  };
  const checkTextEnd = () => {
    const el = textBox.current;
    if (!textRef.current || !el || textSeen.current === idxRef.current) return;
    // Handy: der Text steht gekürzt auf einem Bildschirm. Das Ende ist sichtbar, wenn nichts gekürzt wurde, sonst erst am Ende des Kontexts ("Read more").
    // Desktop: der Text scrollt, gesehen am Ende des Scrollwegs.
    if (deskRef.current ? textEndReached(el.scrollTop, el.clientHeight, el.scrollHeight) : !truncRef.current) markTextSeen();
  };
  useEffect(() => {
    if (form !== 'text') return;
    const t = window.setTimeout(checkTextEnd, 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, form]);

  const setForm = (f: Form) => {
    // Der Tipp auf den Reiter ist die Geste, die das Audio-Element für späteres play() ohne Geste freischaltet (Hintergrund, Sperrbildschirm)
    if (f === 'audio') audioDeck.unlock();
    update((s) => ({ ...s, settings: { ...s.settings, form: f } }));
  };
  // Text: Wischen wechselt erst am Textende (oben am Anfang zurück), sonst scrollt der Text
  const tt = useRef({ x: 0, y: 0, top: false, end: false });

  // ---- Gesten ----
  const g = useRef({ x: 0, y: 0, t: 0, moved: false, axis: '' as '' | 'v' | 'h', base: 0, h: 0, long: 0, fired: false, tap: 0, lastUp: 0, dx: 0, dy: 0 });
  // ---- Wischübergang (Auftrag Max 29.10.2026) ----
  // Der Moment folgt dem Finger 1:1. Beim Loslassen entscheiden Strecke (25 Prozent der Höhe) und Tempo (0,4 px/ms), der Rest ist eine Feder mit
  // Geschwindigkeitsübernahme. Am Anfang und Ende des Feeds Gummiband. Animiert wird nur transform. Player-Arbeit (goTo: laden, cue, Vorladen)
  // läuft erst, wenn die Feder zur Ruhe kam, nie währenddessen.
  const paint = (y: number) => {
    mot.current.y = y;
    const t = y || moving() ? `translate3d(0, ${y}px, 0)` : '';
    if (stageEl.current) stageEl.current.style.transform = t;
    if (uiEl.current) uiEl.current.style.transform = t;
  };
  /** Ebenen nur bewegen, solange gewischt wird (will-change per Attribut, siehe index.css) */
  const setMoving = (on: boolean) => {
    if (on) dragEl.current?.setAttribute('data-moving', '');
    else dragEl.current?.removeAttribute('data-moving');
  };
  const stopMotion = () => {
    window.cancelAnimationFrame(mot.current.raf);
    mot.current.raf = 0;
  };
  const canNext = () => idxRef.current < queue.current.length;
  const canPrev = () => idxRef.current > 0;
  /** Ruhe: Bühne auf 0, Ebenen frei geben, aufgeschobene Arbeit nachholen */
  const endMotion = () => {
    mot.current.busy = false;
    paint(0);
    setMoving(false);
    flushDeferred();
  };
  const flushDeferred = () => {
    saveGate.busy = false;
    if (pendingRender.current) {
      pendingRender.current = false;
      rerender();
    }
  };
  const springTo = (target: number, v0: number, sp: Spring, onEnd: () => void) => {
    stopMotion();
    mot.current.busy = true;
    saveGate.busy = true;
    let st: SpringState = { x: mot.current.y - target, v: v0 };
    let last = performance.now();
    const frame = (now: number) => {
      st = stepSpring(st, (now - last) / 1000, sp);
      last = now;
      if (atRest(st)) {
        mot.current.raf = 0;
        paint(target);
        onEnd();
        return;
      }
      paint(target + st.x);
      mot.current.raf = window.requestAnimationFrame(frame);
    };
    mot.current.raf = window.requestAnimationFrame(frame);
  };
  /** Seite wechseln (dir 1 nach oben, -1 nach unten) oder zurückfedern (0). v in px/ms, negativ nach oben. */
  const settle = (dir: 1 | -1 | 0, v: number) => {
    const H = g.current.h || dragEl.current?.clientHeight || window.innerHeight;
    if (dir === 0) {
      springTo(0, v * 1000, SPRING_BACK, () => {
        endMotion();
        endMeter(true);
      });
      return;
    }
    const target = -dir * H;
    springTo(target, commitVelocity(mot.current.y - target, v * 1000), SPRING_COMMIT, () => {
      const next = idxRef.current + dir;
      // Erst jetzt die Arbeit: Player laden, Nachbarn vorladen, Zustand schreiben. Die Bühne bleibt bis zur neuen Zeichnung am Ziel stehen.
      goTo(next);
      if (idxRef.current !== next) {
        // goTo hat abgelehnt (Ende der Liste): Bühne zurück
        endMotion();
      }
      endMeter(true);
    });
  };
  /** Wechsel ohne Finger (Moment zu Ende, Rückmeldung, For-you-Karte): mit derselben Feder, aus der Ruhe. Desktop, Text, Einzelplayer und reduzierte Bewegung wechseln sofort. */
  const navigate = (next: number) => {
    const cur = idxRef.current;
    const dir = next - cur;
    const still = !deskRef.current && !single && !textRef.current && !moving() && !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!still || (dir !== 1 && dir !== -1)) return goTo(next);
    ensureQueue(cur + 5);
    if (dir === 1 ? cur >= queue.current.length : cur <= 0) return goTo(next);
    g.current.h = dragEl.current?.clientHeight || window.innerHeight;
    startMeter();
    settle(dir, 0);
  };
  navRef.current = navigate;

  // Messung: verlorene Frames von Aufsetzen bis 600 ms nach dem Loslassen (gleiches Fenster wie tests/e2e/swipe.mjs)
  const startMeter = () => {
    const m = meter.current;
    window.clearTimeout(m.tail);
    setMoving(true);
    if (m.on) return;
    m.on = true;
    m.last = 0;
    m.deltas = [];
    const loop = (t: number) => {
      if (!m.on) return;
      if (m.last) m.deltas.push(t - m.last);
      m.last = t;
      m.raf = window.requestAnimationFrame(loop);
    };
    m.raf = window.requestAnimationFrame(loop);
  };
  const stopMeter = (keep: boolean) => {
    const m = meter.current;
    window.clearTimeout(m.tail);
    if (!dragging.current && !mot.current.busy) {
      setMoving(false);
      if (mot.current.y === 0) paint(0);
    }
    if (!m.on) return;
    m.on = false;
    window.cancelAnimationFrame(m.raf);
    // Hängt die Seite im Hintergrund (ein Abstand über 1 s), zählt die Messung nicht
    if (!keep || m.deltas.length < 10 || m.deltas.some((d) => d > 1000)) return;
    const sample = frameSample(m.deltas, Date.now());
    update((x) => ({ ...x, swipeFrames: addFrames(x.swipeFrames, sample) }));
  };
  const endMeter = (keep: boolean) => {
    window.clearTimeout(meter.current.tail);
    meter.current.tail = window.setTimeout(() => stopMeter(keep), 600);
  };

  const togglePlay = () => {
    if (textRef.current) return;
    const p = current().player;
    if (!p) return;
    if (!soundOn.current) {
      soundOn.current = true;
      unlockLevel();
      for (const s of slots.current) s.player?.unMute();
      p.playVideo();
      userPaused.current = false;
      setPaused(false);
      syncHint();
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
      update((s) => bumpCell({ ...s, savedMoments: { ...s.savedMoments, [m.id]: { moment: m, savedAt: new Date().toISOString() } }, momentWeights: signal(s.momentWeights, m, SIGNAL.save, clockNow().getTime()) }, today, hourKey(clockNow()), m, 'saves'));
      return;
    }
    update((s) => {
      const x = { ...s.savedMoments };
      delete x[m.id];
      return { ...s, savedMoments: x };
    });
  };

  /**
   * Zurück auf Sperrbildschirm und Medientasten im Audio-Reiter (Entscheidung 24): Save (nie Rücknahme), Titel 2 s "Saved · Hook", kurzer Ton.
   * Ein zweiter Druck binnen 1,5 s ist More like this. Der Ton läuft über den Web-Audio-Kontext des Decks, ohne Kontext bleibt er aus.
   */
  lockPrevRef.current = () => {
    const m = queue.current[idxRef.current];
    if (!m) return;
    const now = Date.now();
    const kind = previousPress(now, lastBack.current);
    lastBack.current = now;
    let title = savedTitle(m.hook);
    if (kind === 'more') {
      like('double');
      title = `More like this · ${m.hook}`;
    } else if (!stateRef.current.savedMoments[m.id]) toggleSave();
    diag.current.push(`lock: back ${kind} ${m.id} tone=${beep(kind === 'more' ? 1175 : 880)}`);
    try {
      if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') navigator.mediaSession.metadata = new MediaMetadata({ ...lockMeta(m, import.meta.env.BASE_URL, location.origin), title });
      window.setTimeout(() => {
        if (msOnRef.current) setMeta(queue.current[idxRef.current]);
      }, SAVED_TITLE_MS);
    } catch {
      /* Anzeige nicht möglich */
    }
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
      if (m === queue.current[idxRef.current]) navRef.current(idxRef.current + 1);
      return;
    }
    // Zweiter Tipp während die Bestätigung steht: nichts doppelt lernen
    if (confirmRef.current || !entry) return;
    navigator.vibrate?.(15);
    const fx = chipEffect(chip);
    const at = clockNow().getTime();
    // Entscheidung 38: jede Rückmeldung wirkt auf die kleinste Einheit, die sie erklärt (learn.ts). Known und Not for me werfen den Moment weg.
    update((s) => {
      const r = fx ? applyEffect({ weights: s.momentWeights, taps: s.tapLog ?? {} }, fx, m, at) : null;
      const next: AppState = { ...s, feedbackNotes: [...(s.feedbackNotes ?? []), entry], ...(r ? { momentWeights: r.weights, tapLog: r.taps } : {}) };
      return fx === 'known' || fx === 'notForMe' ? markRejected(next, m.id, at) : next;
    });
    if (fx && FEEDBACK_OF[fx]) log(m, { feedback: FEEDBACK_OF[fx]! });
    // Zahl der Momente, die mit dem Sprecher wegfallen (noch nicht gesehen, nicht abgelehnt), für die Bestätigungszeile
    const mutedCount = fx === 'mute' ? pool.filter((x) => x.channel === m.channel && !stateRef.current.momentSeen[x.id]).length : undefined;
    if (fx === 'mute') muteChannel(m);
    if (fx === 'notForMe') dropEpisode(m);
    setConfirm(confirmLine(fx, m, mutedCount));
    setUndo(fx === 'mute' ? m.channel : null);
    confirmRef.current = true;
    const done = () => {
      window.clearTimeout(confirmTimer.current);
      if (!confirmRef.current) return;
      confirmRef.current = false;
      setConfirm(null);
      setNote(null);
      if (m === queue.current[idxRef.current]) {
        silentLeave.current = true;
        navRef.current(idxRef.current + 1);
        window.setTimeout(() => { silentLeave.current = false; }, 1500);
      }
    };
    confirmDone.current = done;
    confirmTimer.current = window.setTimeout(done, fx === 'mute' ? MUTE_UNDO_MS : CONFIRM_SHEET_MS);
  };

  /** Mute speaker rückgängig (Entscheidung 38 e): der Sprecher ist wieder zugelassen, der Feed bleibt auf dem Moment */
  const undoMute = () => {
    const ch = undoChannel;
    if (!ch || !confirmRef.current) return;
    window.clearTimeout(confirmTimer.current);
    update((s) => {
      const x = { ...s.mutedChannels };
      delete x[ch];
      return { ...s, mutedChannels: x };
    });
    stateRef.current = { ...stateRef.current, mutedChannels: Object.fromEntries(Object.entries(stateRef.current.mutedChannels).filter(([k]) => k !== ch)) };
    confirmRef.current = false;
    setConfirm(null);
    setUndo(null);
    setNote(null);
  };

  /**
   * Source oder Topic (Entscheidung 20): Wert aus dem Textfeld wird eine Notiz mit Präfix "source:" bzw. "topic:", ohne Chip-Wirkung auf die Gewichte.
   * Das Blatt zeigt die Bestätigungszeile wie bei den anderen Chips und schließt dann. Der Feed bleibt auf dem Moment, die Notiz beurteilt ihn nicht.
   */
  const saveInput = (m: Moment, chip: InputChip, value: string) => {
    if (confirmRef.current) return;
    const entry = makeInputEntry({ id: m.id, hook: m.hook, tab: FORM_LABEL[form], commit: __APP_COMMIT__ }, chip, value, Date.now());
    if (!entry) return;
    navigator.vibrate?.(15);
    update((s) => ({ ...s, feedbackNotes: [...(s.feedbackNotes ?? []), entry] }));
    setConfirm(inputConfirm(chip));
    confirmRef.current = true;
    const done = () => {
      window.clearTimeout(confirmTimer.current);
      if (!confirmRef.current) return;
      confirmRef.current = false;
      setConfirm(null);
      setNote(null);
    };
    confirmDone.current = done;
    confirmTimer.current = window.setTimeout(done, CONFIRM_SHEET_MS);
  };

  /** Blatt schließen (Tipp daneben, Esc): während die Bestätigung steht, geht der Feed trotzdem weiter */
  const cancelNote = () => {
    if (confirmRef.current) confirmDone.current();
    else setNote(null);
  };

  /**
   * Ein Tipp öffnet ein vorausgefülltes Issue in core-content. Zuerst das Sammel-Issue der normalen Rückmeldungen, danach je Source oder Topic ein eigenes Issue
   * (Label source bzw. topic). Die Zeile "N notes, send?" bleibt stehen, bis alles gesendet ist, denn der Browser öffnet pro Tipp nur ein Fenster.
   */
  const sendNotes = () => {
    const b = nextIssue(unsent(stateRef.current.feedbackNotes), today);
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

  /** Not for me: Momente derselben Folge fliegen sofort aus der tiefen Warteschlange, sonst hätte die Wertung viele Wischer lang keine Wirkung. Das Thema bleibt (Entscheidung 38). */
  const dropEpisode = (m: Moment) => {
    const keep = queue.current.slice(0, idxRef.current + 1);
    queue.current = [...keep, ...queue.current.slice(idxRef.current + 1).filter((x) => x.videoId !== m.videoId)];
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

  /**
   * Ask (Entscheidung 18): öffnet claude.ai mit vorausgefülltem Prompt zu diesem Moment (iPhone: die Claude-App, falls installiert).
   * Zählt wie More (markAsked), setzt askedAt im Zustand (wandert per Sync) und schließt das Blatt. Der Moment bleibt stehen
   * und angehalten, wie bei Source, der Feed geht nicht weiter. Das Fenster öffnet im selben Klick, sonst blockt es der Browser.
   */
  const ask = (target?: Moment | null) => {
    const m = target ?? queue.current[idxRef.current];
    if (!m || forYouRef.current || recallRef.current || confirmRef.current) return;
    navigator.vibrate?.(10);
    window.open(askUrl(m), '_blank', 'noopener');
    update((s) => markAsked(s, m, Date.now(), clockNow().getTime()));
    if (m === queue.current[idxRef.current]) {
      current().player?.pauseVideo();
      userPaused.current = true;
      setPaused(true);
    }
    setNote(null);
  };

  /** Der Griff begann auf der Infozeile (Hook): ein Tipp öffnet den Kontext, ein Wisch oder langes Drücken gilt wie überall */
  const infoDown = useRef(false);
  /** Der Griff begann auf der Steuerzeile des Audio-Reiters (Brief 17 legt sie in die Mitte der Spalte): Wisch und langes Drücken gelten wie überall,
   *  ein Tipp gehört der Taste. Ein Wisch oder langes Drücken löst die Taste nicht aus (gestureUsed, bis zum nächsten Griff). */
  const ctrlDown = useRef(false);
  const gestureUsed = useRef(false);
  const onDown = (e: React.PointerEvent) => {
    infoDown.current = false;
    ctrlDown.current = false;
    gestureUsed.current = false;
    const r = g.current;
    // Der Seitenwechsel wird gerade übernommen (eine Zeichnung lang): kein neuer Griff
    if (mot.current.busy && !mot.current.raf) return;
    // Der Finger fängt die laufende Feder, die Seite bleibt, wo sie ist
    const grabbed = !!mot.current.raf;
    if (grabbed) {
      stopMotion();
      mot.current.busy = false;
    }
    Object.assign(r, { x: e.clientX, y: e.clientY, t: Date.now(), moved: grabbed, axis: grabbed ? 'v' : '', base: mot.current.y, h: dragEl.current?.clientHeight || window.innerHeight, fired: false, dx: 0, dy: 0 });
    vel.current.reset();
    vel.current.push(e.timeStamp, e.clientY);
    if (!single && !textRef.current) startMeter();
    if (grabbed) dragging.current = true;
    window.clearTimeout(r.long);
    r.long = window.setTimeout(() => {
      r.fired = true;
      gestureUsed.current = true;
      navigator.vibrate?.(10);
      // Abrufkarte, Text-Reiter und For-you-Karte bleiben unberührt (Pfeiler 17)
      if (textRef.current || recallRef.current || forYouRef.current) return;
      cycleRate();
    }, LONG_MS);
  };
  const cancelGesture = () => {
    infoDown.current = false;
    ctrlDown.current = false;
    g.current.fired = false;
    g.current.t = 0;
    window.clearTimeout(g.current.long);
    if (dragging.current) {
      dragging.current = false;
      settle(0, 0);
    } else stopMeter(false);
  };
  const onMove = (e: React.PointerEvent) => {
    const r = g.current;
    if (!r.t) return;
    r.dx = e.clientX - r.x;
    r.dy = e.clientY - r.y;
    vel.current.push(e.timeStamp, e.clientY);
    if (Math.abs(r.dy) > 10 || Math.abs(r.dx) > 10) {
      r.moved = true;
      gestureUsed.current = true;
      window.clearTimeout(r.long);
    }
    // Achse wird nach 4 px festgelegt. Senkrecht folgt die Seite dem Finger ab dem ersten Pixel, waagerecht verschiebt sie den Feed nicht (Rückmeldung).
    if (!r.axis && (Math.abs(r.dy) > 4 || Math.abs(r.dx) > 4)) {
      r.axis = Math.abs(r.dy) >= Math.abs(r.dx) ? 'v' : 'h';
      if (r.axis === 'v' && !single && !textRef.current) {
        dragging.current = true;
        saveGate.busy = true;
      }
    }
    if (dragging.current && r.axis === 'v') paint(dragY(r.base + r.dy, r.h, canNext(), canPrev()));
  };
  const onUp = (e: React.PointerEvent) => {
    const r = g.current;
    window.clearTimeout(r.long);
    const wasDown = r.t;
    r.t = 0;
    if (r.fired) {
      r.fired = false;
      if (dragging.current) {
        dragging.current = false;
        paint(0);
        flushDeferred();
      }
      stopMeter(false);
      return;
    }
    if (!wasDown) return;
    // Ein Tipp auf die Steuerzeile gehört der Taste (onClick), die Gesten-Ebene tut nichts (kein Pausentipp, kein Doppeltipp-Herz)
    if (ctrlDown.current) {
      ctrlDown.current = false;
      if (!dragging.current && !r.moved) {
        stopMeter(false);
        return;
      }
    }
    // Jede erste Berührung (auch ein Wisch) gilt dem Browser als Geste: Ton sofort freischalten, damit nach einem
    // Neuladen der PWA nie ein Tipp nur für den Ton nötig ist und der Hinweis nicht zurückkommt (Max, 29.10.).
    // Die erste Geste irgendwo im Dokument hat den Ton schon freigeschaltet (gesture.ts). Dieselbe Berührung ist hier trotzdem kein Pausentipp.
    const firstTouch = !textRef.current && (!soundOn.current || e.pointerId === firstGesturePointer());
    if (e.pointerId === firstGesturePointer()) clearFirstGesturePointer();
    if (form === 'audio') audioDeck.unlock();
    if (firstTouch) {
      soundOn.current = true;
      unlockLevel();
      for (const s of slots.current) s.player?.unMute();
      syncHint();
    }
    if (dragging.current) {
      dragging.current = false;
      if (r.moved) {
        vel.current.push(e.timeStamp, e.clientY);
        const v = vel.current.at(e.timeStamp);
        const y = mot.current.y;
        const res = release(y, v, r.h, canNext(), canPrev());
        settle(res === 'next' ? 1 : res === 'prev' ? -1 : 0, v);
        return;
      }
      // Weniger als 10 px: ein Tipp, kein Wisch
      paint(0);
      flushDeferred();
    }
    if (r.moved) {
      stopMeter(false);
      const sw = swipeOf(r.dx, r.dy);
      if (sw === 'next') goTo(idxRef.current + 1);
      else if (sw === 'prev') goTo(idxRef.current - 1);
      else if (sw === 'note') openNote();
      return;
    }
    stopMeter(false);
    // Tipp auf die Tempo-Anzeige: die Anzeige selbst nimmt keine Zeiger an (CSS), damit Wische über ihr durchgehen. Der Tipp wird hier erkannt.
    const chipEl = document.querySelector('[data-testid=rate]');
    if (chipEl) {
      const b = chipEl.getBoundingClientRect();
      if (e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom) {
        cycleRate();
        return;
      }
    }
    // Ein Tipp, der nur den Ton freischaltet, pausiert nicht und zählt nicht als Doppeltipp (wie vor dem Freischalten bei jeder Berührung)
    if (firstTouch) {
      const p = current().player;
      if (p) p.playVideo();
      userPaused.current = false;
      setPaused(false);
      if (infoDown.current) {
        infoDown.current = false;
        setCapOpen(true);
      }
      return;
    }
    if (infoDown.current) {
      infoDown.current = false;
      setCapOpen(true);
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

  upRef.current = onUp;
  // Der Griff endet immer: geht das Loslassen auf einer Ebene verloren, die es nicht weitergibt (Maus über einer Karte oder Schaltfläche, die sich unter den Zeiger geschoben hat),
  // bliebe der Wisch offen und der Feed hinge in der Mitte. Das Fenster sieht das Loslassen zuerst; onUp ist danach für dieselbe Geste wirkungslos (r.t ist null).
  useEffect(() => {
    const fin = (e: PointerEvent) => {
      if (g.current.t) upRef.current(e as unknown as React.PointerEvent);
    };
    window.addEventListener('pointerup', fin, true);
    return () => window.removeEventListener('pointerup', fin, true);
  }, []);

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

  // ---- Desktop ab 1181 px (Auftrag 28.10.2026). Mobil ist alles unten ohne Wirkung, solange desk fehlt. ----
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
    if (on) unlockLevel();
    for (const sl of slots.current) {
      if (on) sl.player?.unMute();
      else sl.player?.mute();
    }
    syncHint();
    show(on ? 'Sound on' : 'Muted');
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
      case 'ask':
        return ask(noteRef.current);
      case 'caption':
        return setCapOpen((o) => !o);
      case 'tempo':
        if (textRef.current || recallRef.current) return;
        return cycleRate();
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
      if (e.repeat) return;
      actRef.current(a);
    };
    const up = (e: KeyboardEvent) => {
      if (!deskRef.current) return;
      if (e.code === 'Space' && spaceHandled.current) {
        spaceHandled.current = false;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', up);
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
    if (isBackground(vis) && recallRef.current) {
      // Eine offene Karte hielte den Ton an, und im gesperrten Telefon beantwortet sie niemand: zurück in die Warteschlange (Rückkehr zeigt sie), Ton läuft weiter
      const e = recallEntry.current;
      if (e && !recallAnswered.current) {
        const r = requeueOpen(stateRef.current.recallQueue ?? [], stateRef.current.recall ?? {}, e);
        putQueue(r.queue, r.recall);
        diag.current.push(`recall: queued ${e.id} (bg)`);
      }
      recallRef.current = false;
      recallAnswered.current = false;
      recallEntry.current = null;
      setRecall(null);
      if (!textRef.current && !userPaused.current && !forYouRef.current) current().player?.playVideo();
    }
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
    // Issue 44: Zeigt die Oberfläche nicht den Moment, auf dem Deck und Index stehen (Rendern verdeckt nicht gelaufen), sofort nachziehen, noch vor dem ersten Bild nach dem Entsperren
    if (shownId.current && shownId.current !== m.id) {
      try {
        flushSync(() => setUiTick((n) => n + 1));
      } catch {
        setUiTick((n) => n + 1);
      }
      diag.current.push(`ui: synced to ${m.id} after swap (on return)`);
    }
    // Sichtbar: der Element-Vorrat füllt sich wieder (Brief 14, Schritt 2)
    fillPoolRef.current();
    // Der laufende Moment ist jetzt zu sehen: gesehen (einmal), dann Karte oder Ton wieder aufnehmen
    if (!textRef.current && played.current.enough(m.id)) markSeen(m);
    if (!recallRef.current && (stateRef.current.recallQueue?.length ?? 0) > 0) {
      showFromQueue();
      if (recallRef.current) {
        leftPaused.current = false;
        return;
      }
    }
    const wasLeft = leftPaused.current;
    leftPaused.current = false;
    // Der Moment endete verdeckt ohne bereites Element: jetzt mit dem nächsten weiter, sichtbar und mit der normalen Ladeanzeige
    if (resumeNext.current) {
      resumeNext.current = false;
      if (playable && !userPaused.current) {
        navRef.current(idxRef.current + 1);
        return;
      }
    }
    if (!playable || userPaused.current || endedAt.current === idxRef.current) return;
    // Angehalten beim Verlassen, vom Betriebssystem pausiert oder im Hintergrund nicht gestartet: weiter am Stand
    if (wasLeft || current().st !== STATE.PLAYING) current().player?.playVideo();
    // Tempo nach Rückkehr erneut setzen, YouTube fällt nach App-Wechsel auf 1x zurück (Max 31.10.)
    applyRate();
  };
  // Pfeiler 19: Settings, Saved, Feedback-Blatt oder Übersicht zu: eine Karte aus der Warteschlange sofort, vor dem nächsten Wisch
  useEffect(() => {
    if (queue.current.length) showFromQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, !!note, !!desk?.help, !!desk?.sheet, queue.current.length > 0]);
  useEffect(() => {
    const on = () => visRef.current(document.visibilityState);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // Erste Geste irgendwo im Dokument (auch auf den Reitern und der Leiste) schaltet den Ton frei, nicht nur ein Tipp im Feed (gesture.ts).
  // Jede weitere Geste hebt eine vom Browser verworfene Stummschaltung auf (iOS zählt erst touchend und click, pointerdown reicht dafür nicht).
  const gestureRef = useRef<(g: Gesture) => void>(() => {});
  gestureRef.current = (g) => {
    if (g.first) {
      soundOn.current = true;
      unlockLevel();
      for (const sl of slots.current) sl.player?.unMute();
      const cs = current();
      if (cs.st !== STATE.PLAYING && !userPaused.current && !textRef.current && activeRef.current && !forYouRef.current && !recallRef.current) cs.player?.playVideo();
    } else if (soundOn.current) {
      const cp = current().player;
      if (cp?.isMuted?.()) cp.unMute();
    }
    syncHint();
  };
  useEffect(() => onGesture((g) => gestureRef.current(g)), []);

  // Fenstertitel (Desktop) und Medien-Anzeige des Betriebssystems: am Desktop immer, mobil im Audio-Reiter (Sperrbildschirm)
  const msOn = !!desk || form === 'audio';
  msOnRef.current = msOn;
  const curId = queue.current[idx]?.id;
  useEffect(() => {
    if (!msOn) return;
    const cur = queue.current[idx];
    if (desk) document.title = cur ? cur.hook : 'core';
    setMeta(cur);
    return () => {
      if (desk) document.title = 'core';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msOn, !!desk, curId]);

  // Medientasten und Sperrbildschirm: Pause, Weiter und Zurück (Weiter vom Sperrbildschirm zählt wie ein Wisch).
  // Issue 35: Die Handler werden einmal gesetzt und bleiben, solange msOn gilt. Ein Aufräumen auf null bei jeder neuen Identität von goTo ließ iOS auf die
  // 10-Sekunden-Sprünge zurückfallen. goTo und form kommen über Refs. Nach jedem playing und loadedmetadata des Deck-Elements wird alles neu gesetzt,
  // weil iOS Now Playing beim Quellwechsel zurücksetzt.
  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  const formRef = useRef(form);
  formRef.current = form;
  const lockSet = useRef(new Set<string>());
  const setLockHandlers = (reason: string) => {
    if (!msOnRef.current || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a: MediaSessionAction, f: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(a, f);
        if (f) lockSet.current.add(a);
        else lockSet.current.delete(a);
      } catch {
        /* Aktion nicht unterstützt */
      }
    };
    // Jede Aktion vom Sperrbildschirm oder den Medientasten steht im Protokoll (Issue 13: kommt die Pause vom Betriebssystem?)
    const act = (a: string, f: () => void) => () => {
      diag.current.push(`bg: mediasession action ${a} hidden=${isBackground(document.visibilityState)}`);
      f();
    };
    set('play', act('play', () => playRef.current(true)));
    set('pause', act('pause', () => playRef.current(false)));
    set('nexttrack', act('nexttrack', () => lockNextRef.current()));
    // Audio-Reiter (Entscheidung 24): Zurück speichert, ein zweiter Druck binnen 1,5 s ist More like this. Sonst springt Zurück zum vorigen Moment.
    set('previoustrack', act('previoustrack', () => (formRef.current === 'audio' ? lockPrevRef.current() : goToRef.current(idxRef.current - 1))));
    // Keine Sprünge um 10 Sekunden: der Sperrbildschirm zeigt dann Weiter und Zurück
    for (const a of LOCK_UNREGISTERED) set(a as MediaSessionAction, null);
    if (reason !== 'mount') {
      setMeta(queue.current[idxRef.current]);
      setPlaybackState(userPaused.current ? 'paused' : 'playing', `handlers ${reason}`);
    }
    diag.current.push(`lock: handlers set (${reason})`);
  };
  const lockHandlersRef = useRef(setLockHandlers);
  lockHandlersRef.current = setLockHandlers;
  useEffect(() => {
    if (!msOn || !('mediaSession' in navigator)) return;
    lockHandlersRef.current('mount');
    return () => {
      // Nur beim Verlassen von Audio und Desktop (msOn wird false), nie dazwischen
      for (const a of ['play', 'pause', 'nexttrack', 'previoustrack'] as MediaSessionAction[]) {
        try {
          navigator.mediaSession.setActionHandler(a, null);
        } catch {
          /* Aktion nicht unterstützt */
        }
        lockSet.current.delete(a);
      }
    };
  }, [msOn]);
  useEffect(() => {
    if (msOn && 'mediaSession' in navigator) setPlaybackState(paused ? 'paused' : 'playing', `feed paused=${paused}`);
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
      motion: () => ({ busy: mot.current.busy, drag: dragging.current, raf: mot.current.raf, y: mot.current.y }),
      markStart: () => { since.current = Date.now(); },
      diag: () => diag.current.slice(-400),
      /** Angewendete Lautheit je Slot (Tests, Entscheidung 16) */
      /** Nur Tests: der Web-Audio-Kontext, um ihn anzuhalten (iOS-Unterbrechung nachstellen) */
      ctx: () => contextForTest(),
      gain: () => slots.current.slice(0, SLOTS).map((x) => ({ index: x.index, loud: x.player?.loud?.() ?? null })),
      diagAll: () => diag.current.filter((x) => /^(replan|reorder|net poor|yt stub|first-frame|video:)/.test(x)),
      /** Nur Tests (Issue 22): Zeiten Wisch bis erstes Bild je YouTube-Moment, Warmlauf und Abdeckfläche je Slot, Gate der Vorlade-Player */
      video: () => ({
        frames: [...ytFrames.current],
        gate: gateOpen.current,
        slots: slots.current.slice(0, SLOTS).map((x) => ({ index: x.index, mid: x.mid, warm: x.warm, st: x.st, cover: x.cover?.style.visibility ?? null })),
      }),
      slots: () => slots.current.slice(0, SLOTS).map((x) => ({ st: x.st, index: x.index })),
      // Audio-Reiter: Schlüssel der Ausschnitte, die das eine Audio-Element geladen hat, und ob es vorhanden ist (Tests)
      deck: () => ({ history: [...audioDeck.history], exists: audioDeck.exists, pool: audioDeck.poolInfo(), ready: audioDeck.readyCount(), pos: audioDeck.lastPos }),
      /** Sperrbildschirm (Brief 02, Tests): Handler registriert, Metadaten, Positionsstatus, Zähler coldNetStarts des Tages */
      lock: () => {
        const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
        const md = ms?.metadata;
        return { title: md?.title ?? null, artist: md?.artist ?? null, album: md?.album ?? null, artwork: md ? md.artwork.map((a) => `${a.sizes} ${a.src}`) : [], state: ms?.playbackState ?? null, pos: audioDeck.lastPos, cold: coldToday(localStorage, dayKey(clockNow())), cloud: stateRef.current.signals?.days?.[dayKey(clockNow())]?.coldNetStarts ?? 0 };
      },
      /** Zurück vom Sperrbildschirm nachstellen (Tests) */
      lockBack: () => lockPrevRef.current(),
      /** Registrierte Sperrbildschirm-Aktionen (Issue 35, Tests) */
      lockHandlers: () => [...lockSet.current].sort(),
      /** Vorrat-Köpfe (Tests) */
      heads: () => pre?.startHeads() ?? [],
      /** Medien-Elemente mit gesetzter Quelle (Vorgabe höchstens 3) und der Hinweis "Ton aus" aus dem Zustand des Elements */
      media: () => mediaWithSrc(),
      /** Untertitel (Issue 15): Index der gezeigten Cue, Index laut Elementzeit, Elementzeit und Tempo */
      cue: () => {
        const m = queue.current[idxRef.current];
        const t = current().player?.getCurrentTime?.() ?? 0;
        return { shown: shownCue.current, byElement: m ? cueIndexAt(m.cues, t - m.start) : -1, t, rel: m ? t - m.start : 0, rate: clampRate(rateRef.current) };
      },
      hint: () => hintVisible(slotFor(idxRef.current).player?.sound?.() ?? SOUND_NONE),
      slotInfo: () => slots.current.slice(0, SLOTS).map((x) => ({ index: x.index, mid: x.mid, st: x.st, muted: x.player?.isMuted?.() ?? null, t: x.player?.getCurrentTime?.() ?? 0 })),
      latency: () => stateRef.current.playLatency ?? [],
      seen: (id: string) => !!stateRef.current.momentSeen[id],
      rejected: (id: string) => !!stateRef.current.momentRejected?.[id],
      muted: (ch: string) => !!stateRef.current.mutedChannels[ch],
      liked: (id: string) => !!stateRef.current.momentLiked?.[id],
      asked: (id: string) => stateRef.current.momentAsked?.[id] ?? 0,
      saved: (id: string) => !!stateRef.current.savedMoments[id],
      tapMs: () => stateRef.current.tapMs ?? [],
      swipeFrames: () => stateRef.current.swipeFrames ?? [],
      skipRecall: () => closeRecall(),
      sound: () => soundOn.current,
      rate: () => rateRef.current,
      closeCaption: () => setCapOpen(false),
      notes: () => stateRef.current.feedbackNotes ?? [],
      weights: () => stateRef.current.momentWeights,
      taps: () => stateRef.current.tapLog ?? {},
      openNote: () => openNote(),
      recallQueue: () => stateRef.current.recallQueue ?? [],
      recall: () => ({ open: recallRef.current, state: stateRef.current.recall ?? {}, sessionSeen: sessionSeen.current }),
      queue: () => queue.current.map((x) => x.id),
      /** Nur Tests (Brief 14): die genannten Momente an idx+1, idx+2 ... legen und den Vorrat neu füllen */
      arrange: (ids: string[]) => {
        const at = idxRef.current;
        const have = ids.filter((id) => queue.current.slice(at + 1).some((x) => x.id === id));
        const rest = queue.current.slice(at + 1).filter((x) => !have.includes(x.id));
        applyQueue([...queue.current.slice(0, at + 1), ...have.map((id) => queue.current.find((x) => x.id === id)!), ...rest]);
        fillPoolRef.current();
        return have.length;
      },
      preload: () => ({ ids: pre?.ids() ?? [], stats: pre?.stats() ?? { n: 0, bytes: 0 }, poor: poorRef.current, log: pre?.log.slice(-200) ?? [], net: pre?.netSamples() ?? [], local: slots.current.slice(0, SLOTS).map((x) => !!x.player?.isLocal?.()) }),
    };
  });

  if (pool.length && !queue.current.length) ensureQueue(queueAhead(rateRef.current));

  // Neuer Index: die Seiten bekommen neue Versätze, die Bühne geht im selben Commit auf 0. Das Bild bleibt pixelgleich.
  useLayoutEffect(() => {
    if (mot.current.raf || dragging.current) return;
    endMotion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);
  useEffect(
    () => () => {
      stopMotion();
      saveGate.busy = false;
      window.cancelAnimationFrame(meter.current.raf);
      window.clearTimeout(meter.current.tail);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Text-Reiter (Handy): Zeilenlimit nach dem Platz zwischen Hook und Leiste. Gemessen wird der volle Text, danach wird er auf die passenden Zeilen gekürzt.
  useLayoutEffect(() => {
    if (form !== 'text' || deskRef.current) {
      truncRef.current = false;
      setTruncated(false);
      return;
    }
    const col = textBox.current?.querySelector<HTMLElement>('.vtext-col');
    const body = col?.querySelector<HTMLElement>('.vtext-body');
    if (!col || !body) return;
    const fit = () => {
      body.removeAttribute('data-clamp');
      const avail = body.clientHeight;
      const lh = parseFloat(getComputedStyle(body).lineHeight) || 27;
      const cut = body.scrollHeight > avail + 1;
      if (cut) {
        body.style.setProperty('--lines', String(Math.max(1, Math.floor(avail / lh))));
        body.setAttribute('data-clamp', '1');
      }
      truncRef.current = cut;
      setTruncated(cut);
    };
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(col);
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.current[idx]?.id, form, forYou, truncated]);
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

  const focusOn = focusActive(focus, clockNow().getTime());
  const headEl = (
    <Head form={form} setForm={setForm} rate={rateOf(state.settings)} onRate={cycleRate} focusText={focusOn && focus ? focusTabText(focus, clockNow().getTime()) : null} onClearFocus={() => clearFocus()} onFocusSheet={() => setFocusSheet(true)} />
  );
  // Entscheidung 45: sind alle ungesehenen Momente der Form in dieser Sitzung gesperrt, wartet die Endseite aufs Netz (Video und Audio)
  const unseenHere = unseenCount(allPool, form, state.momentSeen, state.mutedChannels);
  const blockedHere = blockedCount(allPool, form, state.momentSeen, state.mutedChannels, bad.current);
  const waiting = blockedHere > 0 && blockedHere === unseenHere ? blockedHere : 0;
  const endCounts = Object.fromEntries(otherForms(form).map((f) => [f, unseenCount(allPool, f, state.momentSeen, state.mutedChannels)])) as Record<Form, number>;
  if (!allPool.length) return <Empty text="No moments in the pool yet. The daily run fills it." />;
  if (!formPool.length)
    return (
      <div className="vfeed" ref={dragEl}>
        {headEl}
        <Empty text={emptyFormLine(form)} />
      </div>
    );
  // Leerer Fokus: sauberes Ende mit "Clear focus" (Entscheidung 39)
  if (!pool.length)
    return (
      <div className="vfeed" ref={dragEl}>
        {headEl}
        <EndPage form={form} counts={endCounts} waiting={waiting} setForm={setForm} focus onClearFocus={() => clearFocus()} />
      </div>
    );
  if (error) return <Empty text={`${error}. Moments need internet.`} />;
  if (!queue.current.length)
    return (
      <div className="vfeed" ref={dragEl}>
        {headEl}
        <EndPage form={form} counts={endCounts} waiting={waiting} setForm={setForm} focus={focusOn} onClearFocus={() => clearFocus()} />
      </div>
    );

  const statusKind = statusOf({ offline: !online, syncError, loading: loading || (deckWait && form === 'audio'), background: bgShown && form === 'audio', muted: hint && form !== 'text' });
  const m = queue.current[idx];
  shownId.current = m?.id ?? '';
  const recallEl = recall ? <RecallCard key={recall.m.id + String(recall.review)} m={recall.m} review={recall.review} rng={rng.current!} onAnswer={answerRecall} onClose={closeRecall} keys={!!desk} ctl={recallCtl} /> : null;
  const saved = m && !!state.savedMoments[m.id];
  const liked = !!m && !!state.momentLiked?.[m.id];
  const captionsOn = !!m && form !== 'text' && captionsShown(form === 'audio' ? 'on' : state.settings.captionMode, m);
  /** Audio-Reiter (Handy): Untertitel, Fortschritt, Transport, Quellzeile und Hook stehen in einer Spalte im Fluss, jede Ebene mit eigenem Platz (Brief 17, Issue 38) */
  const stackOn = form === 'audio' && !desk && !!m && !forYou;
  const audioRtl = form === 'audio' && !!m?.cues?.some((c) => isArabic(c[1]));

  const captionEl = captionsOn && caption && !forYou ? (

        <div className={`vcaption pointer-events-none ${m?.audio ? 'vcaption-audio' : form === 'audio' ? 'vcaption-big' : ''} ${isArabic(caption) ? 'vcaption-rtl' : ''}`} data-testid="caption">
          {captionLines(caption).map((line, k) => (
            <span key={k} dir={isArabic(line) ? 'rtl' : 'ltr'} lang={isArabic(line) ? 'ar' : 'en'} style={{ display: 'block' }}>{line}</span>
          ))}
        </div>
      
  ) : null;
  const ctrlEl = m && !forYou && form === 'audio' && !desk ? (

        <div
          className="vctrl"
          data-testid="audio-controls"
          onPointerDown={(e) => { onDown(e); ctrlDown.current = true; }}
          onPointerMove={onMove}
          onPointerCancel={cancelGesture}
        >
          <div className="vtimes">
            <span>{atTime(Math.round(progress * Math.max(0, m.end - m.start)))}</span>
            {rateOf(state.settings) > 1 && <span>{rateOf(state.settings)}x</span>}
            <span>{atTime(Math.max(0, m.end - m.start))}</span>
          </div>
          <div className="vtransport">
            <button type="button" aria-label="Previous moment" data-testid="ctl-prev" onClick={() => { if (!gestureUsed.current) goTo(idxRef.current - 1); }}><Icon name="skip-back" size="var(--icon)" /></button>
            <button type="button" className="vplaybtn" aria-label={paused ? 'Play' : 'Pause'} data-testid="ctl-play" onClick={() => { if (!gestureUsed.current) togglePlay(); }}><Icon name={paused ? 'play' : 'pause'} size="var(--s-8)" /></button>
            <button type="button" aria-label="Next moment" data-testid="ctl-next" onClick={() => { if (!gestureUsed.current) goTo(idxRef.current + 1); }}><Icon name="skip-forward" size="var(--icon)" /></button>
          </div>
        </div>
      
  ) : null;
  const infoEl = m && !forYou && form !== 'text' && !desk ? (

        <div className="vinfo pointer-events-none">
          <div
            className="vinfo-tap"
            data-testid="info-tap"
            onPointerDown={(e) => { onDown(e); infoDown.current = true; }}
            onPointerMove={onMove}
            onPointerCancel={cancelGesture}
          >
            <div className="vchannel" data-testid="speaker-line">
              <span className="vdot" aria-hidden="true" />
              <span style={{ color: AREA_COLOR[m.area] }}>{AREA_LABEL[m.area]}</span>
              <span className="vspeaker">{speakerLine(m.channel)}</span>
            </div>
            <div className="vtitle" data-testid="hook" ref={hookEl}>{m.hook}</div>
          </div>
        </div>
      
  ) : null;

  return (
    <div className="vfeed" ref={dragEl} data-form={form} data-rtl={audioRtl ? '' : undefined} data-surface={form === 'text' ? 'page' : 'media'} style={{ ['--area' as string]: m ? AREA_COLOR[m.area] : 'var(--on-media)' }}>
      <div className="vstage" ref={stageEl}>
      {slots.current.slice(0, SLOTS).map((slot, s) => {
        const j = slot.index;
        const mm = queue.current[j];
        const offset = single ? 0 : j - idx;
        const isCur = offset === 0;
        return (
          <div
            key={s}
            ref={(el) => (slot.el = el)}
            className="vslot"
            style={{ ['--off' as string]: offset }}
            aria-hidden={!isCur}
            // Issue 46: Pausiert der YouTube-Player, zeigt iOS darüber Logo, Titel, Avatar und die nächste Folge. Das Standbild deckt die Karte dann ab, der Player pausiert darunter.
            data-paused={isCur && paused && !forYou && !desk && mm && mm.form !== 'text' && !mm.audio && streamKind(mm) === 'youtube' ? '' : undefined}
          >
            <div className="vframe">
              <div ref={(el) => (slot.host = el)} />
            </div>
            {posterOf(mm)}
            <div
              ref={(el) => (slot.cover = el)}
              className="vcover"
              data-testid="vcover"
              aria-hidden="true"
              style={{
                position: 'absolute',
                zIndex: 2,
                pointerEvents: 'none',
                visibility: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: COVER_TOP, background: 'var(--tab-bg, #000)' }} />
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: COVER_BOTTOM, background: 'var(--tab-bg, #000)' }} />
            </div>
            {isCur && paused && !forYou && (
              <Icon name="play" size="var(--s-16)" className="vplay" label="Pausiert" />
            )}
          </div>
        );
      })}
      {/* Geister: der vorige Moment (nur Vorschaubild, er wird erst beim Zurückwischen zum Player) und hinter dem letzten Moment die Endseite */}
      {!single && form !== 'text' && queue.current[idx - 1] && (
        <div className="vslot vghost" style={{ ['--off' as string]: -1 }} aria-hidden="true">
          {posterOf(queue.current[idx - 1])}
        </div>
      )}
      {!single && form !== 'text' && idx === queue.current.length - 1 && (
        <div className="vslot vghost" style={{ ['--off' as string]: 1 }} aria-hidden="true">
          <EndPage form={form} counts={endCounts} waiting={waiting} setForm={setForm} focus={focusOn} onClearFocus={() => clearFocus()} ghost />
        </div>
      )}
      </div>

      {!stackOn && <div className="vtrack" />}
      {headEl}
      {form === 'text' && m && !forYou && (
        <div
          ref={textBox}
          className="vtext no-callout"
          data-area={m.area}
          data-testid="text-view"
          onScroll={checkTextEnd}
          onTouchStart={(e) => {
            const el = e.currentTarget;
            tt.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, top: !desk || el.scrollTop <= 0, end: !desk || textEndReached(el.scrollTop, el.clientHeight, el.scrollHeight) };
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
          {(() => {
            const t = momentText(m);
            const ar = isArabic(t);
            const sl = desk ? null : sourceLine(m);
            const label = sl ? `${sl.prefix}${sl.text}` : '';
            const content = (
              <>
                {!desk && (
                  <>
                    <div className="vkicker">{AREA_LABEL[m.area]} · {topicLabel(m.topic)}</div>
                    <h2 className="vtext-hook">{m.hook}</h2>
                  </>
                )}
                {t ? (
                  <p className={`vtext-body ${ar ? 'vtext-rtl' : ''}`} dir={ar ? 'rtl' : 'ltr'} lang={ar ? 'ar' : 'en'}>{t}</p>
                ) : (
                  <p className="vtext-body vtext-empty">No text for this moment yet.</p>
                )}
                {!desk && truncated && (
                  <button type="button" className="vtext-more" data-testid="text-more" onClick={() => setCapOpen(true)}>
                    Read more
                  </button>
                )}
                {sl &&
                  (sl.url ? (
                    <a className="vtext-source" data-testid="text-source" href={sl.url} target="_blank" rel="noopener noreferrer">{label}</a>
                  ) : (
                    <p className="vtext-source" data-testid="text-source">{label}</p>
                  ))}
                {desk && <div className="vtext-end" aria-hidden="true">Next moment: J, Down, or two fingers up</div>}
              </>
            );
            return desk ? content : <div className="vtext-col">{content}</div>;
          })()}
        </div>
      )}
      {!forYou && !statusKind && !(prompt && unsent(state.feedbackNotes).length > 0) && (
        <div className="vtoday pointer-events-none" data-testid="today">
          {todayLine(state.dayCount?.[today], true)}
        </div>
      )}
      {!stackOn && <div className="vprogress" style={{ transform: `scaleX(${progress})` }} />}
      {!forYou && <Status kind={statusKind} audio={form === 'audio'} />}

      <div
        className="vgesture no-callout"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={cancelGesture}
        onContextMenu={(e) => e.preventDefault()}
      />

      <div className="vui" ref={uiEl}>
      {m && !forYou && form === 'video' && !desk && (
        <div className="vsource pointer-events-none" data-testid="source-line">
          <span>{m.videoTitle}</span>
          <span>This cut {atTime(m.start)} to {atTime(m.end)}</span>
        </div>
      )}
      {stackOn ? (
        <div className="vaudio-stack" data-testid="audio-stack">
          <div className="vaudio-sub" data-testid="audio-sub">{captionEl}</div>
          <div className="vaudio-bar">
            <div className="vtrack" />
            <div className="vprogress" style={{ transform: `scaleX(${progress})` }} />
          </div>
          {ctrlEl}
          {infoEl}
        </div>
      ) : (
        <>
          {captionEl}
          {ctrlEl}
          {infoEl}
        </>
      )}

      {!forYou && (
        <div className="vactions">
          <ActionButton testid="like" label="More" icon="heart" on={liked} onClick={(e) => { const t0 = e.timeStamp; like('button'); recordTap(t0); }} />
          <ActionButton testid="save" label="Save" icon="bookmark-simple" on={saved} onClick={(e) => { const t0 = e.timeStamp; toggleSave(); recordTap(t0); }} />
          <ActionButton testid="share" label="Share" icon="export" disabled onClick={() => {}} />
          {m && fullVideoUrl(m) && <ActionButton testid="source" label="Source" icon="arrow-square-out" on={pulse === 'source'} fill={false} onClick={openFull} />}
        </div>
      )}

      {!m && !forYou && idx >= queue.current.length && (
        <EndPage form={form} counts={endCounts} waiting={waiting} setForm={setForm} focus={focusOn} onClearFocus={() => clearFocus()} onBack={() => navRef.current(queue.current.length - 1)} />
      )}
      </div>

      {capOpen && m && !forYou && !desk && <CaptionSheet m={m} speaker={speakerLine(m.channel)} onClose={() => setCapOpen(false)} onEnd={form === 'text' ? markTextSeen : undefined} />}

      {heart && (
        <svg key={heart.k} className="vheart pointer-events-none" data-testid="heart-burst" style={{ left: heart.x - 48, top: heart.y - 48 }} width="96" height="96" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
          <path d={HEART} />
        </svg>
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
          onPointerUp={() => navRef.current(idxRef.current + 1)}
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


      {flash && (
        <div className="toast flash" role="status" data-testid="toast">
          <span>{flash}</span>
        </div>
      )}

      {prompt && !forYou && unsent(state.feedbackNotes).length > 0 && (
        <button type="button" className="vnotes" data-testid="notes-prompt" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={sendNotes}>
          {promptLine(unsent(state.feedbackNotes).length)}
        </button>
      )}

      {focusSheet && <FocusSheet current={focus} now={clockNow().getTime()} onClose={() => setFocusSheet(false)} />}
      {note && <NoteSheet key={note.id} m={note} speaker={speakerLine(note.channel)} onChip={(c, t) => saveNote(note, c, t)} onInput={(c, v) => saveInput(note, c, v)} onDone={(t) => saveNote(note, null, t)} onAsk={() => ask(note)} onCancel={cancelNote} confirm={confirmText} onUndo={undoChannel ? undoMute : null} keys={!!desk} ctl={noteCtl} />}
    </div>
  );
}

const HEART = 'M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z';

/** Knopf der Leiste: Kreis 48 px, Phosphor Regular, Zustand an in Akzentfarbe, Bestätigung am Knopf in 150 ms */
function ActionButton({ label, aria, testid, onClick, on, fill = true, icon, disabled }: { disabled?: boolean; label: string; aria?: string; testid: string; onClick: (e: React.MouseEvent) => void; on?: boolean; fill?: boolean; icon: IconName }) {
  return (
    <button
      aria-label={aria ?? label}
      aria-pressed={on === undefined || !fill ? undefined : on}
      data-testid={testid}
      data-on={on ? '1' : undefined}
      disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onClick}
      className="vbtn no-callout flex min-h-[var(--hit)] min-w-[var(--hit)] flex-col items-center justify-center"
    >
      <span className="vbtn-ring">
        <Icon name={icon} size="var(--rail-icon)" />
      </span>
      {label && <span className="vlabel">{label}</span>}
    </button>
  );
}

/** Vorschaubild eines Moments: Video über dem IFrame, Audio mit Cover. Text hat keins. */
function posterOf(mm: Moment | undefined) {
  if (!mm || mm.form === 'text') return null;
  if (!mm.audio)
    return (
      <>
        <Ambient src={thumbOf(mm)} />
        <Cover className="vposter" src={thumbOf(mm)} />
      </>
    );
  return (
    <div className="vaudio">
      <Cover className="vaudio-bg" src={thumbOf(mm)} />
      <Cover className="vaudio-art" src={thumbOf(mm)} />
    </div>
  );
}

/** Cover mit derselben Adresse nach einem Netzabbruch: Ein Bild, das ohne Netz nicht kam, lädt bei der Rückkehr noch einmal (Issue 9) */
function Cover({ src, className }: { src: string; className: string }) {
  const [k, setK] = useState(0);
  const failed = useRef(false);
  useEffect(() => {
    failed.current = false;
    const on = () => {
      if (!failed.current) return;
      failed.current = false;
      setK((x) => x + 1);
    };
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [src]);
  return <img key={k} className={className} src={src} alt="" draggable={false} onError={() => { failed.current = true; }} />;
}

/** Ruhige Endseite: Satz, zweiter Satz, zwei Knöpfe zu den anderen Reitern. Wisch nach unten geht zurück (nur hinter dem letzten Moment). */
function EndPage({ form, counts, waiting, setForm, onBack, ghost, focus, onClearFocus }: { form: Form; counts: Record<Form, number>; /** Zahl gesperrter Momente, wenn nur noch solche übrig sind (Entscheidung 45) */ waiting?: number; setForm: (f: Form) => void; onBack?: () => void; ghost?: boolean; /** Ein Fokus ist aktiv: Satz dazu und Knopf "Clear focus" (Entscheidung 39) */ focus?: boolean; onClearFocus?: () => void }) {
  const y0 = useRef<number | null>(null);
  return (
    <div
      className="vend"
      data-testid={ghost ? undefined : 'end-page'}
      {...(ghost ? ({ inert: '' } as object) : {})}
      onPointerDown={(e) => { y0.current = e.clientY; }}
      onPointerUp={(e) => { if (onBack && y0.current !== null && e.clientY - y0.current > 60) onBack(); y0.current = null; }}
    >
      <p className="vend-line" data-testid={ghost ? undefined : 'end-line'}>{focus ? 'Nothing left in your focus.' : waiting ? waitingLine(form, waiting) : endLine(form)}</p>
      {!waiting && <p className="vend-sub">{END_SUB}</p>}
      <div className="vend-btns">
        {focus && onClearFocus && (
          <button type="button" className="vend-btn" data-testid={ghost ? undefined : 'end-clear-focus'} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={onClearFocus}>
            Clear focus
          </button>
        )}
        {otherForms(form).map((f) => (
          <button key={f} type="button" className="vend-btn" data-testid={ghost ? undefined : `end-${f}`} disabled={!counts[f]} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => setForm(f)}>
            {endButtonLabel(f, counts[f])}
          </button>
        ))}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="pad flex h-[100dvh] items-center bg-black text-[17px] leading-[25px] text-[#B3B3B3]">{text}</div>;
}
