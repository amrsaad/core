import { useRef, useState } from 'react';
import type { Area } from '../types';
import type { MomentPool } from '../moments/types';
import { exportJson, parseImport } from '../lib/db';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { SPEED_OPTIONS, speedOf, type AppState, type Speed } from '../lib/state';
import { dayKey, isTimeShifted, now } from '../lib/clock';
import type { CaptionMode } from '../moments/captions';
import { UnlockDevice } from './UnlockDevice';
import { SyncCard } from './SyncCard';
import { lastDigestLine } from '../moments/digest';
import type { SyncUi } from '../lib/sync/useSync';
import { tapStats, TAP_TARGET_MS, type TapSample } from '../moments/actions';
import { LATENCY_TARGET_MS, latencyStats, type LatencySample } from '../moments/latency';
import { DROP_TARGET_PCT, frameStats, type FrameSample } from '../moments/swipe';
import { emptyWeights, learned, weightText, type Learned as LearnedRows, type Row } from '../moments/learn';
import { speakerLine } from '../moments/speaker';
import { preloadedLine } from '../moments/preload';
import { usePreloadStats } from '../moments/usePreload';
import { diagLog } from '../lib/diag';
import { backgroundLine } from '../moments/background';

const AREAS: Area[] = ['brain', 'body', 'beat'];

/** Ein Regler ändert sich, die anderen teilen den Rest im bisherigen Verhältnis. Summe bleibt 100. */
export function rebalance(shares: Record<Area, number>, area: Area, value: number): Record<Area, number> {
  const v = Math.min(100, Math.max(0, Math.round(value)));
  const others = AREAS.filter((a) => a !== area);
  const rest = 100 - v;
  const sumOthers = others.reduce((s, a) => s + shares[a] * 100, 0);
  const out = { ...shares, [area]: v / 100 } as Record<Area, number>;
  let assigned = 0;
  others.forEach((a, i) => {
    const pct = i === others.length - 1 ? rest - assigned : Math.round(sumOthers ? ((shares[a] * 100) / sumOthers) * rest : rest / others.length);
    assigned += pct;
    out[a] = pct / 100;
  });
  return out;
}

export function Settings({ state, update, replace, moments, skipped = 0, sync }: { state: AppState; update: (fn: (s: AppState) => AppState) => void; replace: (s: AppState) => void; moments: MomentPool | null; skipped?: number; sync: SyncUi }) {
  const list = moments?.moments ?? [];
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const s = state.settings;

  const doExport = () => {
    const blob = new Blob([exportJson(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `core-backup-${now().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = async (f: File) => {
    try {
      replace(parseImport(await f.text()));
      setMsg('Sicherung wiederhergestellt.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Import failed');
    }
  };

  const row = 'rounded-xl bg-surface p-4 flex flex-col gap-3';
  const btn = 'rounded-xl border border-[var(--line)] px-4 py-3 text-[16px] text-left';

  return (
    <div className="pad pad-nav flex h-[100dvh] flex-col gap-4 overflow-y-auto">
      <h1 className="t-headline m-0">Settings</h1>

      <section className={row}>
        <span className="text-[17px]">Mix</span>
        {AREAS.map((a) => (
          <label key={a} className="flex flex-col gap-1">
            <span className="t-meta flex justify-between">
              <span style={{ color: AREA_COLOR[a] }}>{AREA_LABEL[a]}</span>
              <span className="text-muted">{Math.round(s.areaShares[a] * 100)} %</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(s.areaShares[a] * 100)}
              onChange={(e) => update((st) => ({ ...st, settings: { ...st.settings, areaShares: rebalance(st.settings.areaShares, a, Number(e.target.value)) } }))}
            />
          </label>
        ))}
        <p className="t-meta m-0 text-muted">Starting values. Core learns from what you watch, skip and save. Every area keeps at least 10 %.</p>
      </section>

      <section className={row}>
        <span className="text-[17px]">Moments</span>
        <div className="grid grid-cols-3 gap-2 text-center">
          {AREAS.map((a) => (
            <div key={a} className="rounded-lg border border-[var(--line)] py-2">
              <div className="text-[20px] font-semibold">{list.filter((m) => m.area === a).length}</div>
              <div className="t-meta" style={{ color: AREA_COLOR[a] }}>{AREA_LABEL[a]}</div>
            </div>
          ))}
        </div>
        <p className="t-meta m-0 text-muted">
          {list.length} moments · unseen {list.filter((m) => !state.momentSeen[m.id] && !state.mutedChannels[m.channel]).length} · last daily run {moments?.lastRun ? new Date(moments.lastRun).toLocaleDateString('en-US') : 'none yet'}
        </p>
      </section>

      <section className={row}>
        <span className="text-[17px]">Muted channels</span>
        {Object.keys(state.mutedChannels).length === 0 && <p className="t-meta m-0 text-muted">None. Tap More on a moment, then Mute this channel.</p>}
        {Object.entries(state.mutedChannels).map(([id, name]) => (
          <div key={id} className="flex items-center justify-between">
            <span className="text-[16px]">{name}</span>
            <button
              className="t-meta rounded-lg border border-[var(--line)] px-3 py-2"
              onClick={() => update((st) => { const m = { ...st.mutedChannels }; delete m[id]; return { ...st, mutedChannels: m }; })}
            >
              Show again
            </button>
          </div>
        ))}
      </section>

      <LearnedCard state={state} update={update} row={row} btn={btn} />

      <section className={row}>
        <span className="text-[17px]">Time in Core</span>
        <CoreTime feedTime={state.feedTime} />
      </section>

      <section className={row}>
        <span className="text-[17px]">Player</span>
        <label className="flex items-center justify-between gap-3 text-[16px]">
          <span>Captions</span>
          <select
            data-testid="captions"
            value={s.captionMode ?? 'auto'}
            onChange={(e) => update((st) => ({ ...st, settings: { ...st.settings, captionMode: e.target.value as CaptionMode } }))}
          >
            <option value="auto">Auto</option>
            <option value="on">Always on</option>
            <option value="off">Always off</option>
          </select>
        </label>
        <p className="t-meta m-0 text-muted">Auto: on for audio and Arabic moments, off for English video.</p>
        <label className="flex items-center justify-between gap-3 text-[16px]">
          <span>Playback speed</span>
          <select
            data-testid="speed"
            value={speedOf(s)}
            onChange={(e) => update((st) => ({ ...st, settings: { ...st.settings, playbackSpeed: Number(e.target.value) as Speed } }))}
          >
            {SPEED_OPTIONS.map((v) => (
              <option key={v} value={v}>{v}x</option>
            ))}
          </select>
        </label>
        <p className="t-meta m-0 text-muted">Hold the video for 2x. Never faster than 2x.</p>
        <label className="flex items-center justify-between gap-3 text-[16px]">
          <span>Single player mode (if iOS turns the sound off when swiping)</span>
          <input
            type="checkbox"
            checked={s.playerMode === 'single'}
            onChange={(e) => update((st) => ({ ...st, settings: { ...st.settings, playerMode: e.target.checked ? 'single' : 'slots' } }))}
          />
        </label>
        <PreloadLine />
        <Latency samples={state.playLatency} />
        <span className="t-meta" data-testid="moments-skipped">Moments skipped: {skipped}</span>
        <TapReaction samples={state.tapMs} />
        <SwipeFrames samples={state.swipeFrames} />
        <Diagnostics state={state} moments={moments} skipped={skipped} sync={sync} />
      </section>

      <SyncCard sync={sync} />

      <p className="t-meta m-0 px-1 text-muted" data-testid="digest-line">{lastDigestLine(state.digestLatest, state.digestTaps)}</p>

      <UnlockDevice tokenKey={sync.status.hasToken} />

      <section className={row}>
        <button className={btn} onClick={doExport}>Export as JSON</button>
        <button className={btn} onClick={() => file.current?.click()}>Import from JSON</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        {msg && <p className="t-meta m-0 text-muted">{msg}</p>}
      </section>

      <section className="t-meta flex flex-col gap-1 text-muted">
        <span>Version {__APP_VERSION__}</span>
        <span>Pool updated {moments?.updatedAt ? new Date(moments.updatedAt).toLocaleString('en-US') : 'unknown'}</span>
        <span>Saved {Object.keys(state.savedMoments).length} · seen {Object.keys(state.momentSeen).length} · today {Math.round((state.feedTime[dayKey(now())] ?? 0) / 60000)} min</span>
        {isTimeShifted() && <span>Test time active: {now().toLocaleString('en-US')}</span>}
      </section>
    </div>
  );
}

/** Gewicht und Pfeil je Zeile, mit Ende der Frist, solange ein Ablauf läuft */
function LearnedList({ title, rows, name, id }: { title: string; rows: Row[]; name: (k: string) => string; id: string }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`learned-${id}`}>
      <span className="t-meta text-muted">{title}</span>
      {rows.length === 0 && <span className="t-meta text-muted">none yet</span>}
      {rows.map((r) => (
        <div key={r.key} className="flex items-baseline justify-between gap-3 text-[16px]" data-testid="learned-row">
          <span className="min-w-0 truncate">{name(r.key)}</span>
          <span className="shrink-0 tabular-nums" data-weight={r.weight.toFixed(2)}>
            {weightText(r.weight)}
            {r.until !== undefined && <span className="t-meta text-muted"> until {new Date(r.until).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Karte "What Core learned": je fünf Sprecher und Themen oben und unten mit Gewicht und Pfeil. Reset learning fragt vorher nach. */
function LearnedCard({ state, update, row, btn }: { state: AppState; update: (fn: (s: AppState) => AppState) => void; row: string; btn: string }) {
  const [ask, setAsk] = useState(false);
  const [done, setDone] = useState(false);
  const l: LearnedRows = learned(state.momentWeights, now().getTime());
  const any = l.channelUp.length + l.channelDown.length + l.topicUp.length + l.topicDown.length > 0;
  const cap1 = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);
  return (
    <section className={row} data-testid="learned-card">
      <span className="text-[17px]">What Core learned</span>
      {!any && <p className="t-meta m-0 text-muted" data-testid="learned-empty">{done ? 'Learning reset.' : 'Nothing learned yet. Core learns from what you watch, skip and save.'}</p>}
      {any && (
        <>
          <LearnedList id="channel-up" title="Speakers, more" rows={l.channelUp} name={speakerLine} />
          <LearnedList id="channel-down" title="Speakers, less" rows={l.channelDown} name={speakerLine} />
          <LearnedList id="topic-up" title="Topics, more" rows={l.topicUp} name={cap1} />
          <LearnedList id="topic-down" title="Topics, less" rows={l.topicDown} name={cap1} />
        </>
      )}
      {!ask && (
        <button className={btn} data-testid="reset-learning" onClick={() => { setAsk(true); setDone(false); }}>
          Reset learning
        </button>
      )}
      {ask && (
        <div className="flex flex-col gap-2" role="alertdialog" aria-label="Reset learning" data-testid="reset-ask">
          <p className="m-0 text-[16px]">Reset everything Core learned? Speakers and topics go back to normal.</p>
          <div className="flex gap-2">
            <button className={btn + ' flex-1'} data-testid="reset-cancel" onClick={() => setAsk(false)}>Cancel</button>
            <button
              className={btn + ' flex-1 font-semibold'}
              data-testid="reset-confirm"
              onClick={() => {
                update((st) => ({ ...st, momentWeights: emptyWeights(), skipRun: undefined }));
                setAsk(false);
                setDone(true);
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Minuten in Core an den letzten 7 Tagen, heute zuletzt */
function CoreTime({ feedTime }: { feedTime: Record<string, number> }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = now();
    d.setDate(d.getDate() - (6 - i));
    return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), min: Math.round((feedTime[dayKey(d)] ?? 0) / 60000) };
  });
  const max = Math.max(1, ...days.map((d) => d.min));
  return (
    <div className="flex items-end gap-2" aria-label="Minutes per day">
      {days.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="t-meta">{d.min}</span>
          <div className="w-full rounded bg-[var(--text)] opacity-80" style={{ height: `${Math.max(2, (d.min / max) * 60)}px` }} />
          <span className="t-meta text-muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Diagnose zum Weitergeben (Max, 30.10.2026): Zusammenfassung plus die letzten Protokollzeilen, ohne Schlüssel oder Token. */
export function diagnosticsText(state: AppState, moments: MomentPool | null, skipped: number, sync: SyncUi): string {
  const raw = diagLog.raw();
  const lat = latencyStats(state.playLatency, true);
  const head = [
    `Core ${__APP_VERSION__}, ${new Date().toISOString()}`,
    `pool ${moments?.updatedAt ? new Date(moments.updatedAt).toISOString() : 'unknown'}, ${moments?.moments.length ?? 0} moments, skipped ${skipped}`,
    `device ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`,
    `online ${typeof navigator !== 'undefined' ? navigator.onLine : ''}, standalone ${typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches}`,
    `sync token ${sync.status.hasToken ? 'yes' : 'no'}, last sync ${sync.status.lastSync ? new Date(sync.status.lastSync).toISOString() : 'never'}${sync.status.error ? `, error ${sync.status.error}` : ''}`,
    `saved ${Object.keys(state.savedMoments).length}, seen ${Object.keys(state.momentSeen).length}, speed ${speedOf(state.settings)}`,
    `first frame preloaded: ${lat.n ? `median ${lat.median} ms, p90 ${lat.p90} ms, n ${lat.n}` : 'none'}`,
    backgroundLine(raw),
    '',
    'log (mm:ss since app start):',
  ];
  return [...head, ...diagLog.lines().slice(-150)].join('\n');
}

function Diagnostics({ state, moments, skipped, sync }: { state: AppState; moments: MomentPool | null; skipped: number; sync: SyncUi }) {
  const [msg, setMsg] = useState('');
  const copy = async () => {
    const text = diagnosticsText(state, moments, skipped, sync);
    try {
      if (navigator.share && /iPhone|iPad/.test(navigator.userAgent)) {
        await navigator.share({ title: 'Core diagnostics', text });
        setMsg('Shared.');
        return;
      }
    } catch {
      /* Teilen abgebrochen, dann kopieren */
    }
    try {
      await navigator.clipboard.writeText(text);
      setMsg('Copied. Paste it into the chat.');
    } catch {
      setMsg('Could not copy. Long-press the text below to select it.');
    }
  };
  return (
    <div className="flex flex-col gap-2" data-testid="diagnostics">
      <button className="rounded-xl border border-[var(--line)] px-4 py-3 text-[16px] text-left" onClick={copy} data-testid="copy-diagnostics">
        Copy diagnostics
      </button>
      {msg && <span className="t-meta text-muted">{msg}</span>}
      {msg.startsWith('Could not') && <textarea readOnly className="t-meta h-32 w-full rounded-xl bg-transparent p-2" value={diagnosticsText(state, moments, skipped, sync)} />}
    </div>
  );
}

/** Offline-Vorrat: wie viele Momente als Ausschnitt auf dem Gerät liegen */
function PreloadLine() {
  const p = usePreloadStats();
  return <span className="t-meta" data-testid="preloaded">{preloadedLine(p.n, p.bytes)}</span>;
}

/** Wisch bis erstes Bild, getrennt nach gepuffert und nicht gepuffert. Ziel unter 300 ms bei gepuffertem Moment. */
function Latency({ samples }: { samples?: LatencySample[] }) {
  const line = (label: string, buffered: boolean) => {
    const x = latencyStats(samples, buffered);
    if (!x.n) return <span>{label}: no swipes measured yet</span>;
    return (
      <span>
        {label}: median {x.median} ms, 90 % within {x.p90} ms, {Math.round((x.underTarget ?? 0) * 100)} % under {LATENCY_TARGET_MS} ms ({x.n} swipes)
      </span>
    );
  };
  return (
    <div className="t-meta flex flex-col gap-1" data-testid="latency">
      <span className="text-[16px]">Swipe to first frame</span>
      {line('Preloaded', true)}
      <span className="text-muted">{line('Not preloaded', false)}</span>
    </div>
  );
}

/** Tipp bis Füllung am Knopf (More und Save). Ziel unter 100 ms. */
function TapReaction({ samples }: { samples?: TapSample[] }) {
  const x = tapStats(samples);
  return (
    <div className="t-meta flex flex-col gap-1" data-testid="tap-reaction">
      <span className="text-[16px]">Tap to fill</span>
      {x.n ? (
        <span>
          Median {x.median} ms, 90 % within {x.p90} ms, {Math.round((x.underTarget ?? 0) * 100)} % under {TAP_TARGET_MS} ms ({x.n} taps)
        </span>
      ) : (
        <span>no taps measured yet</span>
      )}
    </div>
  );
}

/** Verlorene Frames bei Wischen (Aufsetzen bis 600 ms nach dem Loslassen). Ziel unter 2 Prozent bei 60 Hz. */
function SwipeFrames({ samples }: { samples?: FrameSample[] }) {
  const x = frameStats(samples);
  return (
    <div className="t-meta flex flex-col gap-1" data-testid="swipe-frames">
      <span className="text-[16px]">Swipe frame drops</span>
      {x.n ? (
        <span>
          {x.lostPct} % lost over {x.n} swipes at {x.hz} Hz, worst swipe {x.worstPct} %, target under {DROP_TARGET_PCT} %
        </span>
      ) : (
        <span>no swipes measured yet</span>
      )}
    </div>
  );
}
