import { Icon } from './Icon';
import { STATUS_ICON, STATUS_TESTID, STATUS_TEXT, STATUS_TEXT_AUDIO_LOADING, type StatusKind } from './status';

/** Die eine Status-Zeile. Rendert nichts ohne Zustand. */
export function Status({ kind, audio }: { kind: StatusKind | null; audio?: boolean }) {
  if (!kind) return null;
  const text = kind === 'loading' && audio ? STATUS_TEXT_AUDIO_LOADING : STATUS_TEXT[kind];
  return (
    <div className="status pointer-events-none" data-status={kind} data-testid={STATUS_TESTID[kind]} role="status" aria-live="polite">
      <Icon name={STATUS_ICON[kind]} size="var(--icon-sm)" />
      <span>{text}</span>
    </div>
  );
}
