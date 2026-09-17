export type LengthUnit = 'cm' | 'in';
export type GaugeSpan = '10cm' | '4in';

/** Exact by definition. */
export const CM_PER_INCH = 2.54;
/** A 4-inch swatch is 10.16 cm wide. */
export const FOUR_INCHES_CM = 4 * CM_PER_INCH;
/** Guard for floating-point noise at threshold boundaries. */
export const EPS = 1e-9;

export function toCm(value: number, unit: LengthUnit): number {
  return unit === 'in' ? value * CM_PER_INCH : value;
}

export function fromCm(valueCm: number, unit: LengthUnit): number {
  return unit === 'in' ? valueCm / CM_PER_INCH : valueCm;
}

/** Stitches over the given span, expressed as stitches per 10 cm. */
export function toStitchesPer10cm(stitches: number, over: GaugeSpan): number {
  return over === '4in' ? (stitches * 10) / FOUR_INCHES_CM : stitches;
}

/** Round half away from zero to one decimal, guarding against float noise. */
export function round1(value: number): number {
  const scaled = Math.abs(value) * 10;
  const rounded = Math.floor(scaled + 0.5 + EPS) / 10;
  if (rounded === 0) return 0;
  return value < 0 ? -rounded : rounded;
}
