import { EPS, type GaugeSpan, type LengthUnit, toCm, toStitchesPer10cm } from './units';

/* ------------------------------------------------------------------ */
/* Rules (all lengths in cm, gauge in stitches per 10 cm)              */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  bustCm: { min: 50, max: 200 },
  finishedBustCm: { min: 40, max: 250 },
  gaugePer10cm: { min: 5, max: 50 },
  easeCm: { min: 0, max: 50 },
  sizes: { min: 1, max: 15 },
  labelMaxLength: 20,
} as const;

/** Sizes whose |difference from desired ease| is within this of the best are treated as tied. */
export const TIE_TOLERANCE_CM = 0.05;
/** Gauge difference at or below this: no message. */
export const GAUGE_CAUTION_ABOVE = 0.05;
/** Gauge difference above this: strong warning. */
export const GAUGE_STRONG_ABOVE = 0.1;
/** Gauge ratios outside this range almost always mean a units mix-up. */
export const GAUGE_RATIO_PLAUSIBLE = { min: 0.5, max: 2 } as const;
/** If the best size misses the desired ease by more than this, say so. */
export const NO_CLOSE_MATCH_CM = 5;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface Gauge {
  stitches: number;
  over: GaugeSpan;
}

export interface SizeInput {
  label: string;
  finishedBust: number;
}

export interface FitCheckInput {
  /** Unit for bust and desired ease; results are shown in this unit. */
  bodyUnit: LengthUnit;
  bust: number;
  desiredEase: number;
  patternGauge: Gauge;
  userGauge: Gauge;
  /** Unit for the finished-bust values in `sizes`. */
  sizesUnit: LengthUnit;
  /** In the order the user entered them. Never re-ordered. */
  sizes: readonly SizeInput[];
}

export type Field =
  | 'bust'
  | 'desiredEase'
  | 'patternGauge'
  | 'userGauge'
  | 'sizes'
  | `size.${number}.label`
  | `size.${number}.finishedBust`;

export interface InputError {
  field: Field;
  message: string;
}

export type GaugeWarning = 'none' | 'caution' | 'strong' | 'check-inputs';

export interface SizeRow {
  index: number;
  label: string;
  /** Finished bust stated by the pattern (cm). */
  patternCm: number;
  /** Estimated finished bust at the user's gauge (cm). */
  estimatedCm: number;
  /** Estimated ease on the user's body (cm). */
  easeCm: number;
  /** easeCm minus desired ease (cm). */
  diffCm: number;
  /** True when the estimated garment is smaller than the body. */
  negativeEase: boolean;
}

export interface FitCheckResult {
  bustCm: number;
  desiredEaseCm: number;
  patternGaugePer10cm: number;
  userGaugePer10cm: number;
  /** patternGauge / userGauge: multiply a pattern measurement by this. */
  ratio: number;
  /** |user − pattern| / pattern. */
  gaugeDifference: number;
  gaugeWarning: GaugeWarning;
  /** Rows in the order entered. */
  rows: SizeRow[];
  recommendedIndex: number;
  /** Another size that is effectively tied with the recommendation, if any. */
  tiedWithIndex: number | null;
  /** The size that would be closest if the user matched the pattern gauge. */
  patternGaugeIndex: number;
  /**
   * How many sizes apart the recommendation and the pattern-gauge size are,
   * counted by finished bust (not by label or entry order).
   */
  sizeShift: number;
  noCloseMatch: boolean;
  duplicateLabels: string[];
}

export type FitCheckOutcome =
  | { ok: true; result: FitCheckResult }
  | { ok: false; errors: InputError[] };

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function isNum(n: number): boolean {
  return typeof n === 'number' && Number.isFinite(n);
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min - EPS && value <= max + EPS;
}

function formatRange(min: number, max: number, unit: LengthUnit): string {
  if (unit === 'cm') return `${min}–${max} cm`;
  const lo = Math.ceil((min / 2.54) * 10) / 10;
  const hi = Math.floor((max / 2.54) * 10) / 10;
  return `${lo}–${hi} in`;
}

export function validate(input: FitCheckInput): InputError[] {
  const errors: InputError[] = [];
  const { bodyUnit, sizesUnit } = input;

  if (!isNum(input.bust)) {
    errors.push({ field: 'bust', message: 'Enter your bust measurement.' });
  } else if (!inRange(toCm(input.bust, bodyUnit), LIMITS.bustCm.min, LIMITS.bustCm.max)) {
    errors.push({
      field: 'bust',
      message: `Bust should be between ${formatRange(LIMITS.bustCm.min, LIMITS.bustCm.max, bodyUnit)}.`,
    });
  }

  if (!isNum(input.desiredEase)) {
    errors.push({ field: 'desiredEase', message: 'Enter the ease you want.' });
  } else if (!inRange(toCm(input.desiredEase, bodyUnit), LIMITS.easeCm.min, LIMITS.easeCm.max)) {
    errors.push({
      field: 'desiredEase',
      message: `Ease should be between ${formatRange(LIMITS.easeCm.min, LIMITS.easeCm.max, bodyUnit)}.`,
    });
  }

  for (const [field, gauge, who] of [
    ['patternGauge', input.patternGauge, 'the pattern'],
    ['userGauge', input.userGauge, 'your swatch'],
  ] as const) {
    if (!isNum(gauge.stitches)) {
      errors.push({ field, message: `Enter the stitch gauge for ${who}.` });
      continue;
    }
    const per10 = toStitchesPer10cm(gauge.stitches, gauge.over);
    if (!inRange(per10, LIMITS.gaugePer10cm.min, LIMITS.gaugePer10cm.max)) {
      errors.push({
        field,
        message:
          gauge.over === '4in'
            ? 'Gauge should be between 5.1 and 50.8 stitches over 4 in.'
            : 'Gauge should be between 5 and 50 stitches over 10 cm.',
      });
    }
  }

  if (input.sizes.length < LIMITS.sizes.min) {
    errors.push({ field: 'sizes', message: 'Add at least one pattern size.' });
  } else if (input.sizes.length > LIMITS.sizes.max) {
    errors.push({ field: 'sizes', message: `Enter at most ${LIMITS.sizes.max} sizes.` });
  }

  input.sizes.forEach((size, i) => {
    const label = size.label.trim();
    if (label.length === 0) {
      errors.push({ field: `size.${i}.label`, message: 'Name this size.' });
    } else if (label.length > LIMITS.labelMaxLength) {
      errors.push({
        field: `size.${i}.label`,
        message: `Keep size names to ${LIMITS.labelMaxLength} characters.`,
      });
    }
    if (!isNum(size.finishedBust)) {
      errors.push({ field: `size.${i}.finishedBust`, message: 'Enter the finished bust.' });
    } else if (
      !inRange(
        toCm(size.finishedBust, sizesUnit),
        LIMITS.finishedBustCm.min,
        LIMITS.finishedBustCm.max,
      )
    ) {
      errors.push({
        field: `size.${i}.finishedBust`,
        message: `Finished bust should be between ${formatRange(
          LIMITS.finishedBustCm.min,
          LIMITS.finishedBustCm.max,
          sizesUnit,
        )}.`,
      });
    }
  });

  return errors;
}

/* ------------------------------------------------------------------ */
/* Calculation                                                         */
/* ------------------------------------------------------------------ */

export function classifyGauge(ratio: number, difference: number): GaugeWarning {
  if (ratio < GAUGE_RATIO_PLAUSIBLE.min || ratio > GAUGE_RATIO_PLAUSIBLE.max) {
    return 'check-inputs';
  }
  if (difference <= GAUGE_CAUTION_ABOVE + EPS) return 'none';
  if (difference <= GAUGE_STRONG_ABOVE + EPS) return 'caution';
  return 'strong';
}

/**
 * Pick the item whose |miss| is smallest. Items within TIE_TOLERANCE_CM of the
 * best are tied; among them the one with the largest ease wins (earliest
 * entered on an exact ease tie). Returns the winner and one tied alternative.
 */
export function pickClosest(
  misses: readonly number[],
  eases: readonly number[],
): { index: number; tiedWith: number | null } {
  const best = Math.min(...misses.map(Math.abs));
  const tied = misses
    .map((m, i) => ({ i, abs: Math.abs(m) }))
    .filter((t) => t.abs - best <= TIE_TOLERANCE_CM + EPS)
    .map((t) => t.i);

  let winner = tied[0] as number;
  for (const i of tied) {
    if ((eases[i] as number) > (eases[winner] as number) + EPS) winner = i;
  }
  const others = tied
    .filter((i) => i !== winner)
    .sort((a, b) => Math.abs(misses[a] as number) - Math.abs(misses[b] as number) || a - b);
  return { index: winner, tiedWith: others[0] ?? null };
}

/** Rank of each size by finished bust (ascending), ties broken by entry order. */
function ranksByFinishedBust(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const ranks = new Array<number>(values.length);
  order.forEach((o, rank) => {
    ranks[o.i] = rank;
  });
  return ranks;
}

function findDuplicateLabels(sizes: readonly SizeInput[]): string[] {
  const seen = new Map<string, number>();
  for (const s of sizes) {
    const key = s.label.trim().toLowerCase();
    if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dups: string[] = [];
  const reported = new Set<string>();
  for (const s of sizes) {
    const key = s.label.trim().toLowerCase();
    if ((seen.get(key) ?? 0) > 1 && !reported.has(key)) {
      reported.add(key);
      dups.push(s.label.trim());
    }
  }
  return dups;
}

export function calculate(input: FitCheckInput): FitCheckOutcome {
  const errors = validate(input);
  if (errors.length > 0) return { ok: false, errors };

  const bustCm = toCm(input.bust, input.bodyUnit);
  const desiredEaseCm = toCm(input.desiredEase, input.bodyUnit);
  const gP = toStitchesPer10cm(input.patternGauge.stitches, input.patternGauge.over);
  const gU = toStitchesPer10cm(input.userGauge.stitches, input.userGauge.over);
  const ratio = gP / gU;
  const gaugeDifference = Math.abs(gU - gP) / gP;

  const rows: SizeRow[] = input.sizes.map((size, index) => {
    const patternCm = toCm(size.finishedBust, input.sizesUnit);
    const estimatedCm = (patternCm * gP) / gU;
    const easeCm = estimatedCm - bustCm;
    return {
      index,
      label: size.label.trim(),
      patternCm,
      estimatedCm,
      easeCm,
      diffCm: easeCm - desiredEaseCm,
      negativeEase: easeCm < -EPS,
    };
  });

  const rec = pickClosest(
    rows.map((r) => r.diffCm),
    rows.map((r) => r.easeCm),
  );

  // Size the knitter would choose if she matched the pattern's gauge.
  const ref = pickClosest(
    rows.map((r) => r.patternCm - bustCm - desiredEaseCm),
    rows.map((r) => r.patternCm - bustCm),
  );

  const ranks = ranksByFinishedBust(rows.map((r) => r.patternCm));
  const sizeShift = Math.abs((ranks[rec.index] as number) - (ranks[ref.index] as number));

  const best = rows[rec.index] as SizeRow;

  return {
    ok: true,
    result: {
      bustCm,
      desiredEaseCm,
      patternGaugePer10cm: gP,
      userGaugePer10cm: gU,
      ratio,
      gaugeDifference,
      gaugeWarning: classifyGauge(ratio, gaugeDifference),
      rows,
      recommendedIndex: rec.index,
      tiedWithIndex: rec.tiedWith,
      patternGaugeIndex: ref.index,
      sizeShift,
      noCloseMatch: Math.abs(best.diffCm) > NO_CLOSE_MATCH_CM + EPS,
      duplicateLabels: findDuplicateLabels(input.sizes),
    },
  };
}
