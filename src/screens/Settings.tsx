import { useRef, useState } from 'react';
import type { Area } from '../types';
import type { MomentPool } from '../moments/types';
import { exportJson, parseImport } from '../lib/db';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { RATES, rateOf, type AppState, type Rate } from '../lib/state';
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
import { contextState, levelBroken, levelOn, setLevelOn } from '../moments/audioGraph';
import { loudLog } from '../moments/loudness';
import { CHANNEL } from '../lib/ns';

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

  const row = 'grp';
  const btn = 'grp-btn';

  return (
    <div className="pad pad-nav scr">
      <div className="scr-wrap">
        <div className="scr-head">
          <h1 className="scr-title">Settings</h1>
        </div>

        <span className="grp-label">Mix</span>
        <section className={row}>
          <div className="grp-stack">
            {AREAS.map((a) => (
              <label key={a} className="mix-row" style={{ ['--area' as string]: AREA_COLOR[a] }}>
                <span>
                  <span style={{ color: 'var(--text)' }}>{AREA_LABEL[a]}</span>
                  <span className="grp-note">{Math.round(s.areaShares[a] * 100)} %</span>
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
          </div>
          <p className="grp-note">Starting values. Core learns from what you watch, skip and save. Every area keeps at least 10 %.</p>
        </section>

        <span className="grp-label">Moments</span>
        <section className={row}>
          <div className="mom-grid">
            {AREAS.map((a) => (
              <div key={a}>
                <b>{list.filter((m) => m.area === a).length}</b>
                <span>{AREA_LABEL[a]}</span>
              </div>
            ))}
          </div>
          <p className="grp-note">
            {list.length} moments · unseen {list.filter((m) => !state.momentSeen[m.id] && !state.mutedChannels[m.channel]).length} · last daily run {moments?.lastRun ? new Date(moments.lastRun).toLocaleDateString('en-US') : 'none yet'}
          </p>
        </section>

        <span className="grp-label">Muted channels</span>
        <section className={row}>
          {Object.keys(state.mutedChannels).length === 0 && <p className="grp-note">None. Tap More on a moment, then Mute this channel.</p>}
          {Object.entries(state.mutedChannels).map(([id, name]) => (
            <div key={id} className="grp-row">
              <span>{name}</span>
              <button
                className="grp-btn mini"
                onClick={() => update((st) => { const m = { ...st.mutedChannels }; delete m[id]; return { ...st, mutedChannels: m }; })}
              >
                Show again
              </button>
            </div>
          ))}
        </section>

        <LearnedCard state={state} update={update} row={row} btn={btn} />

        <span className="grp-label">Player</span>
        <section className={row}>
          <label className="grp-row">
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
          <label className="grp-row">
            <span>Playback speed</span>
            <select
              data-testid="speed"
              value={rateOf(s)}
              onChange={(e) => update((st) => ({ ...st, settings: { ...st.settings, playbackRate: Number(e.target.value) as Rate } }))}
            >
              {RATES.map((v) => (
                <option key={v} value={v}>{v}x</option>
              ))}
            </select>
          </label>
          <label className="grp-row">
            <span>Single player mode (if iOS turns the sound off when swiping)</span>
            <input
              type="checkbox"
              checked={s.playerMode === 'single'}
              onChange={(e) => update((st) => ({ ...st, settings: { ...st.settings, playerMode: e.target.checked ? 'single' : 'slots' } }))}
            />
          </label>
          <Loudness />
        </section>
        <p className="grp-foot">Captions Auto: on for audio and Arabic moments, off for English video.</p>

        <span className="grp-label">Sync and devices</span>
        <SyncCard sync={sync} />
        <p className="grp-foot" data-testid="digest-line">{lastDigestLine(state.digestLatest, state.digestTaps)}</p>
        <UnlockDevice tokenKey={sync.status.hasToken} />

        <span className="grp-label">Data</span>
        <section className={row}>
          <button className={btn} onClick={doExport}>Export as JSON</button>
          <button className={btn} onClick={() => file.current?.click()}>Import from JSON</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
          {msg && <p className="grp-note">{msg}</p>}
        </section>

        <span className="grp-label">Advanced</span>
        <section className={row} data-testid="advanced">
          <div className="grp-metric"><span className="lead">Time in Core</span><CoreTime feedTime={state.feedTime} /></div>
          <PreloadLine />
          <Latency samples={state.playLatency} />
          <TapReaction samples={state.tapMs} />
          <SwipeFrames samples={state.swipeFrames} />
          <span className="grp-metric" data-testid="moments-skipped">Moments skipped: {skipped}</span>
          <Diagnostics state={state} moments={moments} skipped={skipped} sync={sync} />
        </section>

        <section className="set-foot">
          <span>Version {__APP_VERSION__}</span>
          <span>Pool updated {moments?.updatedAt ? new Date(moments.updatedAt).toLocaleString('en-US') : 'unknown'}</span>
          <span>Saved {Object.keys(state.savedMoments).length} · seen {Object.keys(state.momentSeen).length} · today {Math.round((state.feedTime[dayKey(now())] ?? 0) / 60000)} min</span>
          {isTimeShifted() && <span>Test time active: {now().toLocaleString('en-US')}</span>}
        </section>
      </div>
    </div>
  );
}

/** Gewicht und Pfeil je Zeile, mit Ende der Frist, solange ein Ablauf läuft */
function LearnedList({ title, rows, name, id }: { title: string; rows: Row[]; name: (k: string) => string; id: string }) {
  return (
    <div className="lrn" data-testid={`learned-${id}`}>
      <span className="grp-note">{title}</span>
      {rows.length === 0 && <span className="grp-note">none yet</span>}
      {rows.map((r) => (
        <div key={r.key} className="lrn-row" data-testid="learned-row">
          <span>{name(r.key)}</span>
          <span style={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }} data-weight={r.weight.toFixed(2)}>
            {weightText(r.weight)}
            {r.until !== undefined && <span className="grp-note"> until {new Date(r.until).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
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
    <>
    <span className="grp-label">What Core learned</span>
    <section className={row} data-testid="learned-card">
      <span hidden>What Core learned</span>
      {!any && <p className="grp-note" data-testid="learned-empty">{done ? 'Learning reset.' : 'Nothing learned yet. Core learns from what you watch, skip and save.'}</p>}
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
        <div className="grp-stack" role="alertdialog" aria-label="Reset learning" data-testid="reset-ask">
          <p className="grp-row">Reset everything Core learned? Speakers and topics go back to normal.</p>
          <div className="grp-btns">
            <button className={btn} data-testid="reset-cancel" onClick={() => setAsk(false)}>Cancel</button>
            <button
              className={btn + ' strong'}
              data-testid="reset-confirm"
              onClick={() => {
                update((st) => ({ ...st, momentWeights: emptyWeights(), tapLog: undefined }));
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
    </>
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
    <div className="core-time" aria-label="Minutes per day">
      {days.map((d, i) => (
        <div key={i}>
          <span>{d.min}</span>
          <i style={{ height: `${Math.max(2, (d.min / max) * 60)}px` }} />
          <span style={{ color: 'var(--muted)' }}>{d.label}</span>
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
    `channel ${CHANNEL}, commit ${__APP_COMMIT__}`,
    `pool ${moments?.updatedAt ? new Date(moments.updatedAt).toISOString() : 'unknown'}, ${moments?.moments.length ?? 0} moments, skipped ${skipped}`,
    `device ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`,
    `online ${typeof navigator !== 'undefined' ? navigator.onLine : ''}, standalone ${typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches}`,
    `sync token ${sync.status.hasToken ? 'yes' : 'no'}, last sync ${sync.status.lastSync ? new Date(sync.status.lastSync).toISOString() : 'never'}${sync.status.error ? `, error ${sync.status.error}` : ''}`,
    `saved ${Object.keys(state.savedMoments).length}, seen ${Object.keys(state.momentSeen).length}, speed ${rateOf(state.settings)}x`,
    `first frame preloaded: ${lat.n ? `median ${lat.median} ms, p90 ${lat.p90} ms, n ${lat.n}` : 'none'}`,
    backgroundLine(raw),
    `loudness leveling ${levelOn() ? 'on' : 'off'}${levelBroken() ? ` (stopped this session: ${levelBroken()})` : ''}, audio context ${contextState()}`,
    ...loudLog(),
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
    <div className="grp-stack" data-testid="diagnostics">
      <button className="grp-btn" onClick={copy} data-testid="copy-diagnostics">
        Copy diagnostics
      </button>
      {msg && <span className="grp-note">{msg}</span>}
      {msg.startsWith('Could not') && <textarea readOnly className="grp-input" style={{ height: '8rem', padding: 'var(--s-2)' }} value={diagnosticsText(state, moments, skipped, sync)} />}
    </div>
  );
}

/**
 * Gleiche Lautheit (Entscheidung 16): die letzten gespielten Momente mit gemessener und angewendeter Lautheit ("loud: lufs X, gain Y dB")
 * und ein Schalter für dieses Gerät. Dieselben Zeilen stehen in "Copy diagnostics" (diagnosticsText).
 */
function Loudness() {
  const [on, setOn] = useState(levelOn);
  const [msg, setMsg] = useState('');
  const lines = loudLog(5);
  return (
    <div className="grp-metric" data-testid="loudness">
      <label className="grp-row">
        <span>Even out loudness (this device)</span>
        <input type="checkbox" data-testid="level-toggle" checked={on} onChange={(e) => { setLevelOn(e.target.checked); setOn(e.target.checked); setMsg('Applies from the next moment, reload the app to fully apply'); }} />
      </label>
      {lines.length === 0 ? <span>no moments played yet</span> : lines.map((l) => <span key={l} data-testid="loud-line">{l}</span>)}
      {msg && <span>{msg}</span>}
    </div>
  );
}

/** Offline-Vorrat: wie viele Momente als Ausschnitt auf dem Gerät liegen */
function PreloadLine() {
  const p = usePreloadStats();
  return <span className="grp-metric" data-testid="preloaded">{preloadedLine(p.n, p.bytes)}</span>;
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
    <div className="grp-metric" data-testid="latency">
      <span className="lead">Swipe to first frame</span>
      {line('Preloaded', true)}
      {line('Not preloaded', false)}
    </div>
  );
}

/** Tipp bis Füllung am Knopf (More und Save). Ziel unter 100 ms. */
function TapReaction({ samples }: { samples?: TapSample[] }) {
  const x = tapStats(samples);
  return (
    <div className="grp-metric" data-testid="tap-reaction">
      <span className="lead">Tap to fill</span>
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
    <div className="grp-metric" data-testid="swipe-frames">
      <span className="lead">Swipe frame drops</span>
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
