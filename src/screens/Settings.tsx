import { useRef, useState } from 'react';
import type { Area } from '../types';
import type { MomentPool } from '../moments/types';
import { exportJson, parseImport } from '../lib/db';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import type { AppState } from '../lib/state';
import { dayKey, isTimeShifted, now } from '../lib/clock';

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

export function Settings({ state, update, replace, moments }: { state: AppState; update: (fn: (s: AppState) => AppState) => void; replace: (s: AppState) => void; moments: MomentPool | null }) {
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
      setMsg(e instanceof Error ? e.message : 'Import fehlgeschlagen');
    }
  };

  const row = 'rounded-xl bg-surface p-4 flex flex-col gap-3';
  const btn = 'rounded-xl border border-[var(--line)] px-4 py-3 text-[16px] text-left';

  return (
    <div className="pad pad-nav flex h-[100dvh] flex-col gap-4 overflow-y-auto">
      <h1 className="t-headline m-0">Einstellungen</h1>

      <section className={row}>
        <span className="text-[17px]">Bereichsanteile</span>
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
        <p className="t-meta m-0 text-muted">Startwerte. Der Feed lernt aus deinem Verhalten, jeder Bereich bleibt bei mindestens 10 %. Momente kommen in Blöcken à 3 gleichen Bereichs.</p>
      </section>

      <section className={row}>
        <span className="text-[17px]">Momente</span>
        <div className="grid grid-cols-3 gap-2 text-center">
          {AREAS.map((a) => (
            <div key={a} className="rounded-lg border border-[var(--line)] py-2">
              <div className="text-[20px] font-semibold">{list.filter((m) => m.area === a).length}</div>
              <div className="t-meta" style={{ color: AREA_COLOR[a] }}>{AREA_LABEL[a]}</div>
            </div>
          ))}
        </div>
        <p className="t-meta m-0 text-muted">
          {list.length} Momente · ungesehen {list.filter((m) => !state.momentSeen[m.id] && !state.mutedChannels[m.channel]).length} · letzter Wochenlauf {moments?.lastRun ? new Date(moments.lastRun).toLocaleDateString('de-DE') : 'noch keiner'}
        </p>
      </section>

      <section className={row}>
        <span className="text-[17px]">Stummgeschaltete Kanäle</span>
        {Object.keys(state.mutedChannels).length === 0 && <p className="t-meta m-0 text-muted">Keine. Langes Drücken auf einen Moment, dann Kanal stummschalten.</p>}
        {Object.entries(state.mutedChannels).map(([id, name]) => (
          <div key={id} className="flex items-center justify-between">
            <span className="text-[16px]">{name}</span>
            <button
              className="t-meta rounded-lg border border-[var(--line)] px-3 py-2"
              onClick={() => update((st) => { const m = { ...st.mutedChannels }; delete m[id]; return { ...st, mutedChannels: m }; })}
            >
              Wieder zeigen
            </button>
          </div>
        ))}
        <Learned weights={state.momentWeights} />
        <button className={btn} onClick={() => { update((st) => ({ ...st, momentWeights: { area: {}, channel: {}, topic: {} } })); setMsg('Gelernte Gewichte zurückgesetzt.'); }}>
          Gelernte Gewichte zurücksetzen
        </button>
      </section>

      <section className={row}>
        <span className="text-[17px]">Player</span>
        <label className="flex items-center justify-between gap-3 text-[16px]">
          <span>Untertitel im Bild</span>
          <input
            type="checkbox"
            checked={s.captions !== false}
            onChange={(e) => update((st) => ({ ...st, settings: { ...st.settings, captions: e.target.checked } }))}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-[16px]">
          <span>Ein-Player-Modus (falls iOS beim Wischen den Ton wieder ausschaltet)</span>
          <input
            type="checkbox"
            checked={s.playerMode === 'single'}
            onChange={(e) => update((st) => ({ ...st, settings: { ...st.settings, playerMode: e.target.checked ? 'single' : 'slots' } }))}
          />
        </label>
      </section>

      <section className={row}>
        <button className={btn} onClick={doExport}>Export als JSON</button>
        <button className={btn} onClick={() => file.current?.click()}>Import aus JSON</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        {msg && <p className="t-meta m-0 text-muted">{msg}</p>}
      </section>

      <section className="t-meta flex flex-col gap-1 text-muted">
        <span>Version {__APP_VERSION__}</span>
        <span>Pool aktualisiert {moments?.updatedAt ? new Date(moments.updatedAt).toLocaleString('de-DE') : 'unbekannt'}</span>
        <span>Momente gespeichert {Object.keys(state.savedMoments).length} · gesehen {Object.keys(state.momentSeen).length} · heute {Math.round((state.feedTime[dayKey(now())] ?? 0) / 60000)} Min</span>
        {isTimeShifted() && <span>Testzeit aktiv: {now().toLocaleString('de-DE')}</span>}
      </section>
    </div>
  );
}

/** Was der Feed bisher gelernt hat: stärkste und schwächste Themen und Sprecher */
function Learned({ weights }: { weights: { channel: Record<string, number>; topic: Record<string, number> } }) {
  const all = [...Object.entries(weights.topic).map(([k, v]) => [k, v] as const), ...Object.entries(weights.channel).map(([k, v]) => [k, v] as const)];
  if (!all.length) return <p className="t-meta m-0 text-muted">Noch nichts gelernt. Der Feed lernt aus Zuschauen, Wischen, Speichern und Mehr davon.</p>;
  const up = all.filter(([, v]) => v > 1.001).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const down = all.filter(([, v]) => v < 0.999).sort((a, b) => a[1] - b[1]).slice(0, 5);
  const fmt = (v: number) => `${v > 1 ? '+' : ''}${Math.round((v - 1) * 100)} %`;
  return (
    <div className="t-meta flex flex-col gap-1">
      <span className="text-[16px]">Gelernt</span>
      {up.length > 0 && <span>Mehr: {up.map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}</span>}
      {down.length > 0 && <span className="text-muted">Weniger: {down.map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}</span>}
    </div>
  );
}
