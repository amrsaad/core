import { describe, expect, it } from 'vitest';
import { captionDefault, captionsShown } from '../src/moments/captions';
import { DEFAULT_SETTINGS } from '../src/lib/state';

const en: [number, string][] = [[0, 'The macula is the center of the retina.']];
const ar: [number, string][] = [[0, 'وما من قلب إلا وهو بين إصبعين']];

describe('Untertitel (Runde 1, Punkt 4)', () => {
  it('Standard ist auto', () => expect(DEFAULT_SETTINGS.captionMode).toBe('auto'));
  it('auto: englisches Video aus, Audio an, Arabisch an', () => {
    expect(captionDefault({ cues: en })).toBe(false);
    expect(captionDefault({ cues: en, audio: true })).toBe(true);
    expect(captionDefault({ cues: ar })).toBe(true);
  });
  it('ohne cues nie Untertitel, auch bei immer an', () => {
    expect(captionsShown('on', { cues: [] })).toBe(false);
    expect(captionsShown('on', {})).toBe(false);
    expect(captionsShown('on', { cues: [[0, ' ']] })).toBe(false);
    expect(captionsShown('auto', { audio: true })).toBe(false);
  });
  it('immer an und immer aus überstimmen auto', () => {
    expect(captionsShown('on', { cues: en })).toBe(true);
    expect(captionsShown('off', { cues: ar })).toBe(false);
    expect(captionsShown(undefined, { cues: ar })).toBe(true);
  });
});
