import type { GaugeSpan, LengthUnit } from './units';
import { parseNumber } from './parse';
import type { FitCheckInput } from './fitcheck';

/** Raw form values, exactly as typed. */
export interface FormState {
  bodyUnit: LengthUnit;
  bust: string;
  ease: string;
  patternStitches: string;
  patternOver: GaugeSpan;
  userStitches: string;
  userOver: GaugeSpan;
  sizesUnit: LengthUnit;
  sizes: { label: string; value: string }[];
}

export function emptyState(): FormState {
  return {
    bodyUnit: 'cm',
    bust: '',
    ease: '',
    patternStitches: '',
    patternOver: '10cm',
    userStitches: '',
    userOver: '10cm',
    sizesUnit: 'cm',
    sizes: [
      { label: '', value: '' },
      { label: '', value: '' },
    ],
  };
}

/** The example from the product brief. */
export function exampleState(): FormState {
  return {
    bodyUnit: 'cm',
    bust: '82',
    ease: '10',
    patternStitches: '22',
    patternOver: '10cm',
    userStitches: '23',
    userOver: '10cm',
    sizesUnit: 'cm',
    sizes: [
      { label: 'XS', value: '90' },
      { label: 'S', value: '96' },
      { label: 'M', value: '102' },
      { label: 'L', value: '108' },
    ],
  };
}

export function toInput(state: FormState): FitCheckInput {
  const num = (s: string) => parseNumber(s) ?? Number.NaN;
  return {
    bodyUnit: state.bodyUnit,
    bust: num(state.bust),
    desiredEase: num(state.ease),
    patternGauge: { stitches: num(state.patternStitches), over: state.patternOver },
    userGauge: { stitches: num(state.userStitches), over: state.userOver },
    sizesUnit: state.sizesUnit,
    sizes: state.sizes
      .filter((s) => s.label.trim() !== '' || s.value.trim() !== '')
      .map((s) => ({ label: s.label, finishedBust: num(s.value) })),
  };
}

/* ------------------------------------------------------------------ */
/* Share link: everything lives in the URL fragment (#...), which      */
/* browsers never send to a server.                                    */
/* ------------------------------------------------------------------ */

const MAX_FIELD = 12;
const MAX_LABEL = 20;
const MAX_SIZES = 15;

const clip = (s: string, n: number) => s.slice(0, n);
/** encodeURIComponent leaves "~" alone, but "~" separates label from value here. */
const enc = (s: string) => encodeURIComponent(s).replace(/~/g, '%7E');
const lengthUnit = (v: string | null): LengthUnit | null => (v === 'cm' || v === 'in' ? v : null);
const span = (v: string | null): GaugeSpan | null => (v === '10cm' || v === '4in' ? v : null);

export function encodeState(state: FormState): string {
  const p = new URLSearchParams();
  p.set('v', '1');
  p.set('bu', state.bodyUnit);
  p.set('b', state.bust.trim());
  p.set('e', state.ease.trim());
  p.set('ps', state.patternStitches.trim());
  p.set('po', state.patternOver);
  p.set('us', state.userStitches.trim());
  p.set('uo', state.userOver);
  p.set('su', state.sizesUnit);
  const sizes = state.sizes
    .filter((s) => s.label.trim() !== '' || s.value.trim() !== '')
    .map((s) => `${enc(s.label.trim())}~${enc(s.value.trim())}`)
    .join('|');
  p.set('s', sizes);
  return p.toString();
}

/** Returns null when the fragment is not a FitCheck link. */
export function decodeState(fragment: string): FormState | null {
  const p = new URLSearchParams(fragment.replace(/^#/, ''));
  if (p.get('v') !== '1') return null;
  const base = emptyState();
  const safeDecode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return '';
    }
  };
  const sizes = (p.get('s') ?? '')
    .split('|')
    .filter(Boolean)
    .slice(0, MAX_SIZES)
    .map((pair) => {
      const [label = '', value = ''] = pair.split('~');
      return { label: clip(safeDecode(label), MAX_LABEL), value: clip(safeDecode(value), MAX_FIELD) };
    });
  return {
    bodyUnit: lengthUnit(p.get('bu')) ?? base.bodyUnit,
    bust: clip(p.get('b') ?? '', MAX_FIELD),
    ease: clip(p.get('e') ?? '', MAX_FIELD),
    patternStitches: clip(p.get('ps') ?? '', MAX_FIELD),
    patternOver: span(p.get('po')) ?? base.patternOver,
    userStitches: clip(p.get('us') ?? '', MAX_FIELD),
    userOver: span(p.get('uo')) ?? base.userOver,
    sizesUnit: lengthUnit(p.get('su')) ?? base.sizesUnit,
    sizes: sizes.length > 0 ? sizes : base.sizes,
  };
}
