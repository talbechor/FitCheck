import { type LengthUnit, fromCm, round1 } from './units';

const MINUS = '−';

/** 91.8 → "91.8"; −0.2 → "−0.2". Always one decimal. */
export function formatNumber(value: number): string {
  const r = round1(value);
  const text = Math.abs(r).toFixed(1);
  return r < 0 ? `${MINUS}${text}` : text;
}

/** Signed with an explicit plus: "+9.8", "−0.2", "0.0". */
export function formatSigned(value: number): string {
  const r = round1(value);
  if (r === 0) return '0.0';
  return r > 0 ? `+${r.toFixed(1)}` : `${MINUS}${Math.abs(r).toFixed(1)}`;
}

export function unitLabel(unit: LengthUnit): string {
  return unit === 'in' ? 'in' : 'cm';
}

export function lengthIn(cm: number, unit: LengthUnit): string {
  return `${formatNumber(fromCm(cm, unit))} ${unitLabel(unit)}`;
}

export function signedLengthIn(cm: number, unit: LengthUnit): string {
  return `${formatSigned(fromCm(cm, unit))} ${unitLabel(unit)}`;
}

export function percent(fraction: number): string {
  return `${round1(fraction * 100).toFixed(1)}%`;
}
