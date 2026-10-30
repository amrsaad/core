import { diagLog } from '../lib/diag';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { dayKey, now as clockNow } from '../lib/clock';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import type { AppState } from '../lib/state';
import { audioDeck, createPlayer, deckClipOf, HLS, loadYT, offlineYT, STATE, type YTPlayer } from '../video/ytApi';
import { errorAction, resumePos } from './netrecover';
import { isYtId } from './contract';
import { contextForTest, levelEnabled, probeHost, unlockAudio } from './audioGraph';
import { loudLine, recordLoud } from './loudness';
import { browserPreloader } from './preloader';
import { netRank, PRELOAD_COUNT, streamKind } from './preload';
import { cursorFor, parseSaved, queueKey, releaseTail, reorderByRank, restoreQueue } from './queue';
import { leaveOf, newMomentCursor, nextMomentBlock, SIGNAL, type MomentCursor } from './mix';
import { applyEffect, confirmLine, signal, skip as skipRule, type Effect } from './learn';
import { clampRate, DEFAULT_RATE, nextRate, rateOf, type Rate } from '../lib/state';
import { addSample } from './latency';
import { captionsShown } from './captions';
import { countGotIt, countSeen, todayLine } from './today';
import { answer, cardDue, pickRecall, type Recent } from './recall';
import { RecallCard, type RecallCtl } from './RecallCard';
import { canShowRecall, onReturn, onSwipe, type QueueEntry } from './recallqueue';
import { CaptionSheet } from './CaptionSheet';
import { sourceLine } from './source';
import { askUrl, markAsked } from './ask';
import { NoteSheet, type NoteCtl } from './NoteSheet';
import { createWheel, deskKey, TAB_KEYS, wheelPx, type DeskAction } from './desktop';
import { DeskPanel } from './DeskShell';
import { speakerLine } from './speaker';
import { buildIssue, chipEffect, CONFIRM_SHEET_MS, firstOpenOfDay, makeEntry, markSent, promptLine, unsent, type Chip } from './note';
import { HOOK_LINE_PT, hookStep } from './hook';
import { makeRng } from './rng';
import { addTap, CONFIRM_MS, HEART_MS, nextLiked, swipeOf } from './actions';
import { addFrames, atRest, commitVelocity, dragY, frameSample, release, SPRING_BACK, SPRING_COMMIT, stepSpring, Velocity, type Spring, type SpringState } from './swipe';
import { saveGate } from '../lib/useAppState';
import { emptyFormLine, END_SUB, endButtonLabel, endLine, filterPool, formOf, FORM_LABEL, FORMS, momentText, otherForms, textEndReached, unseenCount, type Form } from './form';
import { atEnd, countsSeenAtStart, EndLedger, isBackground, onLeave, successorOf } from './background';
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
  /** Netzfehler im Player: der Slot bleibt stehen und wird bei der Rückkehr an derselben Stelle wieder aufgenommen (Issue 9) */
  broken: boolean;
  /** Wiederaufnahmen seit dem letzten Spielen, danach gilt der Moment als nicht abspielbar */
  tries: number;
  /** Letzte gute Position im laufenden Moment (Quellzeit) */
  pos: number;
}
const newSlot = (): Slot => ({ host: null, el: null, player: null, ready: false, index: -1, st: STATE.UNSTARTED, mid: '', broken: false, tries: 0, pos: 0 });

const END_GUARD = 0.3;
const FOR_YOU_MS = 6000;
const POLL_MS = 150;
const TAP_MS = 260;
const LONG_MS = 500;
const LOG_MAX = 3000;
/** Warteschlange beim Start: der Vorrat soll 30 Momente vorhalten, dazu der aktuelle und ein paar Reserve */
const QUEUE_AHEAD = PRELOAD_COUNT + 2;

const load = (m: Moment) => ({ videoId: m.videoId, startSeconds: m.start, endSeconds: m.end, gainDb: m.gainDb });

/** Das Symbol "Ton aus" erscheint nur, solange in dieser Sitzung noch nie Ton an war. Danach nie wieder (Max, 29.10.2026). */
let soundSeenOn = false;

export function MomentFeed({ pool: allPool, state, update, active, onPausedChange, desk }: Props) {
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
  const recallCtl = useRef<RecallCtl | null>(null);
  const noteCtl = useRef<NoteCtl | null>(null);
  /** Das 2x kommt von der Tastatur (Shift+. gehalten) */
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
  const slots = useRef<Slot[]>(Array.from({ length: 3 }, newSlot));
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
  /** Offene Messung Wisch bis erstes Bild */
  const swipe = useRef<{ j: number; t0: number; buffered: boolean } | null>(null);

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
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState(!soundSeenOn);
  const [paused, setPaused] = useState(false);
  const rateRef = useRef<Rate>(DEFAULT_RATE);
  /** Tempo auf alle Slots legen (Streams: Media-Element, YouTube: setPlaybackRate). Läuft auch für Slots, die gerade pausieren. */
  const applyRate = () => {
    for (const sl of slots.current) sl.player?.setPlaybackRate(clampRate(rateRef.current));
  };
  /** Pfeiler 17: 1x, 1.5x, 2x, 1x. Wert sofort in den Refs und in den Playern, dann in den State (Sync). */
  const cycleRate = () => {
    const next = nextRate(rateRef.current);
    rateRef.current = next;
    applyRate();
    update((s) => ({ ...s, settings: { ...s.settings, playbackRate: next } }));
    diag.current.push(`rate: ${next}x`);
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
  rateRef.current = rateOf(state.settings);
  // Tempo aus Sync, Desktop-Leiste oder Settings erreicht auch pausierte und wartende Slots
  useEffect(() => {
    applyRate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateOf(state.settings)]);

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
    pre.setQueue(queue.current, at);
    const w = pre.warmSet(queue.current, at);
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
        slot.broken = false;
        slot.tries = 0;
        // Nach dem Neuaufbau der Player (YouTube-API kam zurück) läuft der Moment an derselben Stelle weiter, nicht von vorn
        const at = resume.current?.mid === m.id ? resume.current.pos : undefined;
        if (at !== undefined) resume.current = null;
        slot.pos = at ?? m.start;
        const arg = at === undefined ? load(m) : { ...load(m), startSeconds: resumePos(at, m) };
        if (play) slot.player.loadVideoById(arg);
        // YouTube lädt bei cue nur das Vorschaubild. Darum stumm laden, der Player hält beim ersten Bild an (siehe onState).
        else if (!HLS.has(m.videoId)) slot.player.loadVideoById(arg);
        else slot.player.cueVideoById(arg);
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

  /** Gescheiterte Momente aus dem Rest der Warteschlange nehmen (Wisch und Auto-Weiter lesen danach dieselbe Stelle) */
  const pruneBad = () => {
    const from = idxRef.current + 1;
    const rest = queue.current.slice(from);
    const clean = rest.filter((x) => !bad.current.has(x.videoId));
    if (clean.length !== rest.length) {
      queue.current = [...queue.current.slice(0, from), ...clean];
      for (const sl of slots.current) if (sl.index >= from) sl.index = -1;
    }
  };

  /**
   * Audio-Reiter (Issue 11): den Nachfolger schon vor dem Ende bestimmen und dem Audio-Element geben. Im Ende-Handler passieren dann nur
   * noch src und play. Der Nachfolger ist derselbe wie beim Wisch (Stelle idx + 1 der Warteschlange der Mischung).
   */
  const armDeck = () => {
    if (form !== 'audio') return;
    pruneBad();
    const j = idxRef.current + 1;
    if (!queue.current[j]) ensureQueue(j + 1);
    const nm = successorOf(queue.current, idxRef.current, bad.current);
    audioDeck.arm(nm && formOf(nm) === 'audio' ? deckClipOf(nm) : null);
  };

  /** Anzeige des Betriebssystems (Sperrbildschirm) sofort setzen, nicht erst nach dem nächsten Rendern, das im Hintergrund gedrosselt wird */
  const setMeta = (cur: Moment | undefined) => {
    if (!cur || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: cur.hook, artist: speakerLine(cur.channel), album: AREA_LABEL[cur.area], artwork: [{ src: thumbOf(cur) }] });
  };

  /** Darf jetzt eine Abrufkarte erscheinen? Feed-Reiter offen, Seite sichtbar, kein Blatt, keine Übersicht (Pfeiler 19) */
  const recallCtx = () => ({ active: activeRef.current, visible: !isBackground(document.visibilityState), note: !!noteRef.current, sheet: !!(deskRef.current?.help || deskRef.current?.sheet) });
  const openRecall = (e: QueueEntry, fromQueue: boolean) => {
    const rm = findMoment(e.id);
    if (!rm) return false;
    recallRef.current = true;
    recallAnswered.current = false;
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
    if (pick && step.queue.some((x) => x.id === pick.id)) diag.current.push(`recall: queued ${pick.id}`);
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
      closeForYou();
      pruneBad();
      ensureQueue(next + QUEUE_AHEAD);
      // Genau hinter dem letzten Moment liegt die Endseite (idx = Länge). Weiter geht es nicht.
      if (next > queue.current.length) return;
      syncPre(next);
      const prev = idxRef.current;
      diag.current.push(`go ${prev}->${next}`);
      const prevM = queue.current[prev];
      // Weitergewischt: Wertung nach geschautem Anteil (learn.ts). Unter 3 s ist ein Skip, zwei Skips desselben Kanals in Folge
      // sperren den Kanal 14 Tage. Jedes andere Weiterwischen unterbricht die Folge. Im Textmodus gibt es keine Wiedergabezeit,
      // darum keine Zeitwertung. Nach einem Chip ersetzt dessen Wirkung die Wertung (silentLeave).
      const nowMs = clockNow().getTime();
      const silent = silentLeave.current; // gilt für genau diesen Wechsel (er kommt mit der Feder erst am Ende der Animation)
      silentLeave.current = false;
      if (next > prev && prevM) {
        const timed = endedAt.current !== prev && !textRef.current && !silent;
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
          const queued = new Set((s0.recallQueue ?? []).map((x) => x.id));
          recallNow = pickRecall(s0.recall ?? {}, recent.current, clockNow().getTime(), (id) => !queued.has(id) && !!findMoment(id)?.recall);
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
      // Pfeiler 19: nie eine Karte, solange der Feed nicht im Vordergrund und sichtbar ist. Dann Warteschlange, je eine Karte pro Wisch.
      if (next > prev && prevM) stepRecall(recallNow);
      armDeck();
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
      // Auto-Weiter im Hintergrund: derselbe Weg wie der Wisch, ohne Für-dich-Karte. Im Audio-Reiter hat das Audio-Element den Wechsel schon vollzogen.
      const j = idxRef.current + 1;
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
    audioDeck.onAdvance = () => finishRef.current();
    return () => audioDeck.release();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    armDeck();
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
    armDeck();
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
            const pl = createPlayer(YT, target, id, {
              onDiag: (line) => diag.current.push(`slot${s} ${line}`),
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
                if (st === STATE.PLAYING) {
                  everPlayed.current = true;
                  slot.broken = false;
                  slot.tries = 0;
                }
                if (st === STATE.PLAYING && slot.index === idxRef.current) noteLoud(slot, s);
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
                // Gespeichertes Tempo (Pfeiler 17) bei jedem Start, auch nach Neuaufbau oder Wiederaufnahme eines Players
                if (st === STATE.PLAYING) slot.player?.setPlaybackRate(clampRate(rateRef.current));
                if (st === STATE.ENDED && slot.index === idxRef.current) finish();
                if (st === STATE.PLAYING && (slot.index !== idxRef.current || forYouRef.current || textRef.current || recallRef.current)) slot.player?.pauseVideo();
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
                    }, 1000 * slot.tries);
                  }
                  return;
                }
                if (m2) bad.current.add(m2.videoId);
                armDeck();
                // Einzelne Fehler überspringen nur. Die Fehlerseite gibt es erst, wenn nie ein Video lief und acht Momente scheiterten.
                if (!everPlayed.current && bad.current.size >= 8) setError(`YouTube spielt gerade keine Videos ab (Fehler ${code})`);
                else if (slot.index === idxRef.current) goTo(idxRef.current + 1);
              },
            });
            // Das Vorschaubild liegt über dem IFrame in jedem Zustand außer PLAYING (Auftrag Max 29.10.2026). Der Zustandswechsel kommt
            // vom IFrame asynchron, also fällt data-live schon beim Befehl, der das Spielen beendet oder einen anderen Inhalt lädt.
            for (const k of ['pauseVideo', 'loadVideoById', 'cueVideoById'] as const) {
              const f = pl[k].bind(pl) as (a?: never) => void;
              pl[k] = ((arg?: never) => {
                slot.el?.removeAttribute('data-live');
                f(arg);
              }) as never;
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
        armDeck();
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
        ready.then(() => !cancelled && ytBackRef.current(), () => {});
      }
      begin(YT);
    })();
    return () => {
      cancelled = true;
      for (const s of slots.current) {
        s.player?.destroy();
        s.el?.removeAttribute('data-live');
        Object.assign(s, { player: null, ready: false, index: -1, st: STATE.UNSTARTED, mid: '', broken: false, tries: 0, pos: 0 });
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
          diag.current.push(`watchdog ${m.id}`);
          bad.current.add(m.videoId);
          waitSince.current = 0;
          goTo(idxRef.current + 1);
          return;
        }
      }
      // Eine Stelle vor dem Start des Moments ist eine Quelle, die gerade neu lädt: Untertitel und Fortschritt bleiben, wie sie waren
      if ((sl.st === STATE.PLAYING || sl.st === STATE.PAUSED) && c >= m.start - 0.5) {
        if (sl.st === STATE.PLAYING) sl.pos = c;
        setProgress(Math.min(1, Math.max(0, (c - m.start) / (m.end - m.start))));
        const rel = c - m.start;
        let cue = '';
        if (m.cues) for (const [t, text] of m.cues) if (t <= rel + 0.1) cue = text; else break;
        setCaption(cue);
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
      if (m === queue.current[idxRef.current]) navRef.current(idxRef.current + 1);
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
        navRef.current(idxRef.current + 1);
        window.setTimeout(() => { silentLeave.current = false; }, 1500);
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

  const onDown = (e: React.PointerEvent) => {
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
      navigator.vibrate?.(10);
      // Abrufkarte, Text-Reiter und For-you-Karte bleiben unberührt (Pfeiler 17)
      if (textRef.current || recallRef.current || forYouRef.current) return;
      cycleRate();
    }, LONG_MS);
  };
  const onMove = (e: React.PointerEvent) => {
    const r = g.current;
    if (!r.t) return;
    r.dx = e.clientX - r.x;
    r.dy = e.clientY - r.y;
    vel.current.push(e.timeStamp, e.clientY);
    if (Math.abs(r.dy) > 10 || Math.abs(r.dx) > 10) {
      r.moved = true;
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
    // Jede erste Berührung (auch ein Wisch) gilt dem Browser als Geste: Ton sofort freischalten, damit nach einem
    // Neuladen der PWA nie ein Tipp nur für den Ton nötig ist und der Hinweis nicht zurückkommt (Max, 29.10.).
    const firstTouch = !soundOn.current && !textRef.current;
    if (form === 'audio') audioDeck.unlock();
    if (firstTouch) {
      soundOn.current = true;
      unlockLevel();
      for (const s of slots.current) s.player?.unMute();
      soundSeenOn = true;
      setHint(false);
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
    if (on) unlockLevel();
    for (const sl of slots.current) {
      if (on) sl.player?.unMute();
      else sl.player?.mute();
    }
    soundSeenOn = true;
    setHint(false);
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
    if (!recallRef.current && (stateRef.current.recallQueue?.length ?? 0) > 0) {
      showFromQueue();
      if (recallRef.current) {
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
      motion: () => ({ busy: mot.current.busy, drag: dragging.current, raf: mot.current.raf, y: mot.current.y }),
      markStart: () => { since.current = Date.now(); },
      diag: () => diag.current.slice(-400),
      /** Angewendete Lautheit je Slot (Tests, Entscheidung 16) */
      /** Nur Tests: der Web-Audio-Kontext, um ihn anzuhalten (iOS-Unterbrechung nachstellen) */
      ctx: () => contextForTest(),
      gain: () => slots.current.slice(0, SLOTS).map((x) => ({ index: x.index, loud: x.player?.loud?.() ?? null })),
      diagAll: () => diag.current.filter((x) => /^(replan|reorder|net poor|yt stub|first-frame)/.test(x)),
      slots: () => slots.current.slice(0, SLOTS).map((x) => ({ st: x.st, index: x.index })),
      // Audio-Reiter: Schlüssel der Ausschnitte, die das eine Audio-Element geladen hat, und ob es vorhanden ist (Tests)
      deck: () => ({ history: [...audioDeck.history], exists: audioDeck.exists, armed: audioDeck.armedKey }),
      slotInfo: () => slots.current.slice(0, SLOTS).map((x) => ({ index: x.index, mid: x.mid, st: x.st, muted: x.player?.isMuted?.() ?? null, t: x.player?.getCurrentTime?.() ?? 0 })),
      latency: () => stateRef.current.playLatency ?? [],
      seen: (id: string) => !!stateRef.current.momentSeen[id],
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
      skipRun: () => stateRef.current.skipRun ?? null,
      openNote: () => openNote(),
      recallQueue: () => stateRef.current.recallQueue ?? [],
      recall: () => ({ open: recallRef.current, state: stateRef.current.recall ?? {}, sessionSeen: sessionSeen.current }),
      queue: () => queue.current.map((x) => x.id),
      preload: () => ({ ids: pre?.ids() ?? [], stats: pre?.stats() ?? { n: 0, bytes: 0 }, poor: poorRef.current, log: pre?.log.slice(-200) ?? [], net: pre?.netSamples() ?? [], local: slots.current.slice(0, SLOTS).map((x) => !!x.player?.isLocal?.()) }),
    };
  });

  if (pool.length && !queue.current.length) ensureQueue(QUEUE_AHEAD);

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
        <FormSwitch form={form} setForm={setForm} rate={rateOf(state.settings)} onRate={cycleRate} />
        <Empty text={emptyFormLine(form)} />
      </div>
    );
  if (error) return <Empty text={`${error}. Moments need internet.`} />;
  if (!queue.current.length)
    return (
      <div className="vfeed" ref={dragEl}>
        <FormSwitch form={form} setForm={setForm} rate={rateOf(state.settings)} onRate={cycleRate} />
        <EndPage form={form} counts={Object.fromEntries(otherForms(form).map((f) => [f, unseenCount(allPool, f, state.momentSeen, state.mutedChannels)])) as Record<Form, number>} setForm={setForm} />
      </div>
    );

  const m = queue.current[idx];
  const recallEl = recall ? <RecallCard key={recall.m.id + String(recall.review)} m={recall.m} review={recall.review} rng={rng.current!} onAnswer={answerRecall} onClose={closeRecall} keys={!!desk} ctl={recallCtl} /> : null;
  const saved = m && !!state.savedMoments[m.id];
  const liked = !!m && !!state.momentLiked?.[m.id];
  const captionsOn = !!m && form !== 'text' && captionsShown(form === 'audio' ? 'on' : state.settings.captionMode, m);

  return (
    <div className="vfeed" ref={dragEl} style={{ ['--area' as string]: m ? AREA_COLOR[m.area] : '#fff' }}>
      <div className="vstage" ref={stageEl}>
      {slots.current.slice(0, SLOTS).map((slot, s) => {
        const j = slot.index;
        const mm = queue.current[j];
        const offset = single ? 0 : j - idx;
        const isCur = offset === 0;
        return (
          <div key={s} ref={(el) => (slot.el = el)} className="vslot" style={{ ['--off' as string]: offset }} aria-hidden={!isCur}>
            <div className="vframe">
              <div ref={(el) => (slot.host = el)} />
            </div>
            {posterOf(mm)}
            {isCur && paused && !forYou && (
              <svg className="vplay" width="72" height="72" viewBox="0 0 24 24" fill="#fff" aria-label="Pausiert">
                <path d="M8 5v14l11-7z" />
              </svg>
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
          <EndPage form={form} counts={Object.fromEntries(otherForms(form).map((f) => [f, unseenCount(allPool, f, state.momentSeen, state.mutedChannels)])) as Record<Form, number>} setForm={setForm} ghost />
        </div>
      )}
      </div>

      <div className="vtrack" />
      <FormSwitch form={form} setForm={setForm} rate={rateOf(state.settings)} onRate={cycleRate} />
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
          g.current.fired = false;
          g.current.t = 0;
          window.clearTimeout(g.current.long);
          if (dragging.current) {
            dragging.current = false;
            settle(0, 0);
          } else stopMeter(false);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />

      <div className="vui" ref={uiEl}>
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

      {!m && !forYou && idx >= queue.current.length && (
        <EndPage form={form} counts={Object.fromEntries(otherForms(form).map((f) => [f, unseenCount(allPool, f, state.momentSeen, state.mutedChannels)])) as Record<Form, number>} setForm={setForm} onBack={() => navRef.current(queue.current.length - 1)} />
      )}
      </div>

      {capOpen && m && !forYou && form !== 'text' && !desk && <CaptionSheet m={m} speaker={speakerLine(m.channel)} onClose={() => setCapOpen(false)} />}

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
        <div className="flash pointer-events-none absolute inset-x-0 bottom-40 z-30 flex justify-center">
          <span className="rounded-full bg-black/80 px-4 py-2 text-[15px] text-white">{flash}</span>
        </div>
      )}

      {prompt && !forYou && unsent(state.feedbackNotes).length > 0 && (
        <button type="button" className="vnotes" data-testid="notes-prompt" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={sendNotes}>
          {promptLine(unsent(state.feedbackNotes).length)}
        </button>
      )}

      {note && <NoteSheet key={note.id} m={note} speaker={speakerLine(note.channel)} onChip={(c, t) => saveNote(note, c, t)} onDone={(t) => saveNote(note, null, t)} onAsk={() => ask(note)} onCancel={cancelNote} confirm={confirmText} keys={!!desk} ctl={noteCtl} />}
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

function FormSwitch({ form, setForm, rate, onRate }: { form: Form; setForm: (f: Form) => void; rate: Rate; onRate: () => void }) {
  return (
    <div className="vform" role="radiogroup" aria-label="Form" data-testid="form-switch" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        {FORMS.map((f) => (
          <button key={f} role="radio" aria-checked={form === f} className={form === f ? 'on' : ''} onClick={() => setForm(f)}>
            {FORM_LABEL[f]}
          </button>
        ))}
        {rate > 1 && form !== 'text' && (
          <button type="button" className="vrate" data-testid="rate" aria-label={`Speed ${rate}x, tap to change`} onClick={onRate}>
            {rate}x
          </button>
        )}
    </div>
  );
}

/** Vorschaubild eines Moments: Video über dem IFrame, Audio mit Cover. Text hat keins. */
function posterOf(mm: Moment | undefined) {
  if (!mm || mm.form === 'text') return null;
  if (!mm.audio) return <Cover className="vposter" src={thumbOf(mm)} />;
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
function EndPage({ form, counts, setForm, onBack, ghost }: { form: Form; counts: Record<Form, number>; setForm: (f: Form) => void; onBack?: () => void; ghost?: boolean }) {
  const y0 = useRef<number | null>(null);
  return (
    <div
      className="vend"
      data-testid={ghost ? undefined : 'end-page'}
      {...(ghost ? ({ inert: '' } as object) : {})}
      onPointerDown={(e) => { y0.current = e.clientY; }}
      onPointerUp={(e) => { if (onBack && y0.current !== null && e.clientY - y0.current > 60) onBack(); y0.current = null; }}
    >
      <p className="vend-line" data-testid={ghost ? undefined : 'end-line'}>{endLine(form)}</p>
      <p className="vend-sub">{END_SUB}</p>
      <div className="vend-btns">
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
