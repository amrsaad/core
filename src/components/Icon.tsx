import { ICON_PATHS, type IconName } from './icons';

/**
 * Phosphor Regular. Größe und Farbe kommen vom Umfeld (currentColor, Token --icon), nie als Zahl im Aufrufer.
 * Dekorativ, wenn kein label gesetzt ist.
 */
export function Icon({ name, size = 'var(--icon)', label, className }: { name: IconName; size?: string; label?: string; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="currentColor"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {ICON_PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
