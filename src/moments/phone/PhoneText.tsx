import { AreaChip } from '../desk/DeskCenter';
import { hookSize } from '../desk/model';
import type { Moment } from '../types';

/** Runde 45: Kopf des Lesetexts der iPhone-Ansicht (Text-Reiter): Chip, Kanal, Hook als Serifen-Überschrift. Bauweise wie DeskTextHead, Maße in phone.css. */
export function PhoneTextHead({ m, speaker }: { m: Moment; speaker: string }) {
  return (
    <header className="ptx-head" data-testid="ph-textmeta">
      <AreaChip m={m} speaker={speaker} />
      <h1 className="ptx-hook" data-testid="hook" data-size={hookSize(m.hook)} dir="auto">
        {m.hook}
      </h1>
    </header>
  );
}
