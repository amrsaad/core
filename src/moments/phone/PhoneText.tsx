import { AreaChip } from '../desk/DeskCenter';
import { AREA_DK } from '../desk/area';
import { hookSize } from '../desk/model';
import type { Moment } from '../types';
import { cleanText } from '../textfit';

/** Runde 45: Kopf des Lesetexts der iPhone-Ansicht (Text-Reiter): Chip, Kanal, Hook als Serifen-Überschrift. Bauweise wie DeskTextHead, Maße in phone.css. */
export function PhoneTextHead({ m, speaker }: { m: Moment; speaker: string }) {
  return (
    <header className="ptx-head" data-testid="ph-textmeta">
      <AreaChip m={m} speaker={speaker} />
      <h1 className="ptx-hook" data-testid="hook" data-size={hookSize(m.hook)} dir="auto">
        {cleanText(m.hook)}
      </h1>
    </header>
  );
}

/** Runde 50: Fuß des Takeaway-Textes am Handy. Metazeile (Herkunft und Nummer, einmal) und die Karte "Apply today" (einmal). Gleiche Abstände wie der Rest der Seite (--fgap aus phone.css). */
export function PhoneTextFoot({ meta, apply, area }: { meta: string; apply: string; area: Moment['area'] }) {
  if (!meta && !apply) return null;
  return (
    <>
      {meta && (
        <p className="dtx-origin ptx-meta" data-testid="ph-origin" dir="auto">
          {cleanText(meta)}
        </p>
      )}
      {apply && (
        <section className="dtx-apply" data-testid="ph-apply" style={{ ['--ad' as string]: AREA_DK[area] }}>
          <h2>Apply today</h2>
          <p dir="auto">{cleanText(apply)}</p>
        </section>
      )}
    </>
  );
}
