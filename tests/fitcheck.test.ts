import { describe, expect, it } from 'vitest';
import {
  calculate,
  classifyGauge,
  type FitCheckInput,
  type FitCheckResult,
  pickClosest,
  validate,
} from '../src/lib/fitcheck';
import { CM_PER_INCH, toStitchesPer10cm } from '../src/lib/units';

const base = (): FitCheckInput => ({
  bodyUnit: 'cm',
  bust: 82,
  desiredEase: 10,
  patternGauge: { stitches: 22, over: '10cm' },
  userGauge: { stitches: 22, over: '10cm' },
  sizesUnit: 'cm',
  sizes: [
    { label: 'XS', finishedBust: 90 },
    { label: 'S', finishedBust: 96 },
    { label: 'M', finishedBust: 102 },
    { label: 'L', finishedBust: 108 },
  ],
});

function run(input: FitCheckInput): FitCheckResult {
  const outcome = calculate(input);
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.errors));
  return outcome.result;
}

const withUserGauge = (stitches: number, over: '10cm' | '4in' = '10cm') => ({
  ...base(),
  userGauge: { stitches, over },
});

describe('gauge direction', () => {
  it('exact gauge: estimate equals the pattern measurement', () => {
    const r = run(base());
    expect(r.ratio).toBe(1);
    for (const row of r.rows) expect(row.estimatedCm).toBe(row.patternCm);
    expect(r.gaugeWarning).toBe('none');
    expect(r.sizeShift).toBe(0);
  });

  it('tighter gauge (more stitches) makes every size smaller', () => {
    const r = run(withUserGauge(24));
    for (const row of r.rows) expect(row.estimatedCm).toBeLessThan(row.patternCm);
    expect(r.rows[1]?.estimatedCm).toBeCloseTo((96 * 22) / 24, 12);
  });

  it('looser gauge (fewer stitches) makes every size larger', () => {
    const r = run(withUserGauge(20));
    for (const row of r.rows) expect(row.estimatedCm).toBeGreaterThan(row.patternCm);
    expect(r.rows[1]?.estimatedCm).toBeCloseTo((96 * 22) / 20, 12);
  });

  it('ease and difference follow the definitions exactly', () => {
    const r = run(withUserGauge(21));
    for (const row of r.rows) {
      expect(row.easeCm).toBeCloseTo(row.estimatedCm - 82, 12);
      expect(row.diffCm).toBeCloseTo(row.easeCm - 10, 12);
    }
  });
});

describe('metric / imperial equivalence', () => {
  const metric: FitCheckInput = { ...base(), userGauge: { stitches: 23, over: '10cm' } };
  const imperial: FitCheckInput = {
    bodyUnit: 'in',
    bust: 82 / CM_PER_INCH,
    desiredEase: 10 / CM_PER_INCH,
    patternGauge: { stitches: (22 * 4 * CM_PER_INCH) / 10, over: '4in' },
    userGauge: { stitches: (23 * 4 * CM_PER_INCH) / 10, over: '4in' },
    sizesUnit: 'in',
    sizes: metric.sizes.map((s) => ({ label: s.label, finishedBust: s.finishedBust / CM_PER_INCH })),
  };

  it('gives the same results in cm', () => {
    const a = run(metric);
    const b = run(imperial);
    expect(b.recommendedIndex).toBe(a.recommendedIndex);
    expect(b.patternGaugeIndex).toBe(a.patternGaugeIndex);
    expect(b.gaugeWarning).toBe(a.gaugeWarning);
    expect(b.ratio).toBeCloseTo(a.ratio, 12);
    b.rows.forEach((row, i) => {
      expect(row.estimatedCm).toBeCloseTo(a.rows[i]!.estimatedCm, 9);
      expect(row.diffCm).toBeCloseTo(a.rows[i]!.diffCm, 9);
    });
  });

  it('allows mixed units: body in cm, sizes in inches, gauges on different spans', () => {
    const mixed: FitCheckInput = {
      ...metric,
      patternGauge: imperial.patternGauge,
      sizesUnit: 'in',
      sizes: imperial.sizes,
    };
    const a = run(metric);
    const b = run(mixed);
    expect(b.recommendedIndex).toBe(a.recommendedIndex);
    b.rows.forEach((row, i) => expect(row.estimatedCm).toBeCloseTo(a.rows[i]!.estimatedCm, 9));
  });

  it('converts a 4 in gauge using 10.16 cm', () => {
    expect(toStitchesPer10cm(20, '4in')).toBeCloseTo(20 / 1.016, 12);
    expect(toStitchesPer10cm(20, '10cm')).toBe(20);
  });
});

describe('recommendation and ties', () => {
  it('picks the smallest absolute difference', () => {
    expect(pickClosest([-3, 1, 4], [1, 5, 8])).toEqual({ index: 1, tiedWith: null });
  });

  it('breaks an exact tie toward more ease and reports the other size', () => {
    expect(pickClosest([-2, 2], [3, 7])).toEqual({ index: 1, tiedWith: 0 });
  });

  it('treats differences within 0.05 cm as tied', () => {
    expect(pickClosest([-2, 2.05], [3, 7.05])).toEqual({ index: 1, tiedWith: 0 });
    expect(pickClosest([-2, 2.0501], [3, 7.0501])).toEqual({ index: 0, tiedWith: null });
  });

  it('keeps the earliest entered size when ease is identical', () => {
    expect(pickClosest([1, 1], [5, 5])).toEqual({ index: 0, tiedWith: 1 });
  });

  it('handles duplicate finished busts in a full calculation', () => {
    const r = run({
      ...base(),
      sizes: [
        { label: 'S', finishedBust: 92 },
        { label: 'S petite', finishedBust: 92 },
      ],
    });
    expect(r.recommendedIndex).toBe(0);
    expect(r.tiedWithIndex).toBe(1);
  });
});

describe('entry order is preserved', () => {
  it('returns rows in the order entered, even when unsorted', () => {
    const r = run({
      ...base(),
      sizes: [
        { label: 'L', finishedBust: 108 },
        { label: 'XS', finishedBust: 90 },
        { label: 'M', finishedBust: 102 },
        { label: 'S', finishedBust: 96 },
      ],
    });
    expect(r.rows.map((row) => row.label)).toEqual(['L', 'XS', 'M', 'S']);
    expect(r.rows.map((row) => row.index)).toEqual([0, 1, 2, 3]);
  });

  it('counts size shift by finished bust, not by entry order', () => {
    const r = run({
      ...base(),
      userGauge: { stitches: 20, over: '10cm' },
      sizes: [
        { label: 'L', finishedBust: 108 },
        { label: 'XS', finishedBust: 90 },
        { label: 'M', finishedBust: 102 },
        { label: 'S', finishedBust: 96 },
      ],
    });
    // Target ease 10 cm on an 82 cm bust. At 20 sts every size grows by 10%;
    // XS becomes 99 cm (ease 17), still the closest. Same pick as at pattern gauge.
    expect(r.rows[r.recommendedIndex]?.label).toBe('XS');
    expect(r.sizeShift).toBe(0);

    const tight = run({
      ...base(),
      userGauge: { stitches: 26, over: '10cm' },
      sizes: r.rows.map((x) => ({ label: x.label, finishedBust: x.patternCm })),
    });
    // At 26 sts L shrinks to 91.4 cm (ease 9.4) and wins. The pattern-gauge pick
    // is XS. L is entered first, but it is 3 sizes above XS by finished bust.
    expect(tight.rows[tight.recommendedIndex]?.label).toBe('L');
    expect(tight.rows[tight.patternGaugeIndex]?.label).toBe('XS');
    expect(tight.sizeShift).toBe(3);
  });
});

describe('negative ease', () => {
  it('flags sizes smaller than the body but still includes them', () => {
    const r = run({ ...base(), bust: 110, desiredEase: 0 });
    expect(r.rows).toHaveLength(4);
    expect(r.rows.every((row) => row.negativeEase)).toBe(true);
    expect(r.rows[r.recommendedIndex]?.label).toBe('L');
    expect(r.noCloseMatch).toBe(false);
  });

  it('does not flag zero ease', () => {
    const r = run({ ...base(), bust: 96, desiredEase: 0 });
    expect(r.rows[1]?.easeCm).toBe(0);
    expect(r.rows[1]?.negativeEase).toBe(false);
  });
});

describe('one size', () => {
  it('always recommends the only size', () => {
    const r = run({ ...base(), sizes: [{ label: 'One size', finishedBust: 120 }] });
    expect(r.recommendedIndex).toBe(0);
    expect(r.tiedWithIndex).toBeNull();
    expect(r.patternGaugeIndex).toBe(0);
    expect(r.sizeShift).toBe(0);
  });

  it('reports no close match when the only size misses by more than 5 cm', () => {
    const r = run({ ...base(), sizes: [{ label: 'One size', finishedBust: 120 }] });
    expect(r.rows[0]?.diffCm).toBeCloseTo(28, 12);
    expect(r.noCloseMatch).toBe(true);
  });

  it('treats a miss of exactly 5 cm as a close match', () => {
    const r = run({ ...base(), sizes: [{ label: 'One size', finishedBust: 97 }] });
    expect(r.noCloseMatch).toBe(false);
    const r2 = run({ ...base(), sizes: [{ label: 'One size', finishedBust: 97.01 }] });
    expect(r2.noCloseMatch).toBe(true);
  });
});

describe('gauge warnings', () => {
  const warningFor = (user: number, over: '10cm' | '4in' = '10cm', pattern = 20) =>
    run({ ...base(), patternGauge: { stitches: pattern, over }, userGauge: { stitches: user, over } })
      .gaugeWarning;

  it('no warning up to and including 5%', () => {
    expect(warningFor(20.99)).toBe('none');
    expect(warningFor(21)).toBe('none');
    expect(warningFor(19)).toBe('none');
  });

  it('caution above 5% and up to and including 10%', () => {
    expect(warningFor(21.01)).toBe('caution');
    expect(warningFor(18.99)).toBe('caution');
    expect(warningFor(21.99)).toBe('caution');
    expect(warningFor(22)).toBe('caution');
    expect(warningFor(18)).toBe('caution');
  });

  it('strong warning above 10%', () => {
    expect(warningFor(22.01)).toBe('strong');
    expect(warningFor(17.99)).toBe('strong');
    expect(warningFor(30)).toBe('strong');
  });

  it('boundaries hold when gauges are entered over 4 in', () => {
    expect(warningFor(21, '4in')).toBe('none');
    expect(warningFor(22, '4in')).toBe('caution');
    expect(warningFor(18, '4in')).toBe('caution');
    expect(warningFor(22.01, '4in')).toBe('strong');
  });

  it('keeps the numeric estimate when the warning is strong', () => {
    const r = run(withUserGauge(28));
    expect(r.gaugeWarning).toBe('strong');
    expect(r.rows[1]?.estimatedCm).toBeCloseTo((96 * 22) / 28, 12);
  });

  it('asks to check inputs when the ratio is implausible', () => {
    expect(classifyGauge(0.49, 1.04)).toBe('check-inputs');
    expect(classifyGauge(0.5, 1)).toBe('strong');
    expect(classifyGauge(2, 0.5)).toBe('strong');
    expect(classifyGauge(2.01, 0.5)).toBe('check-inputs');
    expect(warningFor(10, '10cm', 22)).toBe('check-inputs');
  });
});

describe('invalid inputs', () => {
  const fields = (input: FitCheckInput) => validate(input).map((e) => e.field);

  it('accepts a valid input', () => {
    expect(validate(base())).toEqual([]);
  });

  it('rejects missing or non-finite numbers', () => {
    expect(fields({ ...base(), bust: Number.NaN })).toEqual(['bust']);
    expect(fields({ ...base(), desiredEase: Number.NaN })).toEqual(['desiredEase']);
    expect(fields({ ...base(), patternGauge: { stitches: Number.NaN, over: '10cm' } })).toEqual([
      'patternGauge',
    ]);
    expect(fields({ ...base(), userGauge: { stitches: Number.POSITIVE_INFINITY, over: '10cm' } })).toEqual([
      'userGauge',
    ]);
  });

  it('rejects zero and negative values', () => {
    expect(fields({ ...base(), bust: 0 })).toEqual(['bust']);
    expect(fields({ ...base(), bust: -82 })).toEqual(['bust']);
    expect(fields({ ...base(), desiredEase: -1 })).toEqual(['desiredEase']);
    expect(fields({ ...base(), userGauge: { stitches: 0, over: '10cm' } })).toEqual(['userGauge']);
    expect(
      fields({ ...base(), sizes: [{ label: 'S', finishedBust: -96 }] }),
    ).toEqual(['size.0.finishedBust']);
  });

  it('enforces range boundaries inclusively', () => {
    expect(fields({ ...base(), bust: 50 })).toEqual([]);
    expect(fields({ ...base(), bust: 49.99 })).toEqual(['bust']);
    expect(fields({ ...base(), bust: 200 })).toEqual([]);
    expect(fields({ ...base(), bust: 200.01 })).toEqual(['bust']);
    expect(fields({ ...base(), desiredEase: 0 })).toEqual([]);
    expect(fields({ ...base(), desiredEase: 50 })).toEqual([]);
    expect(fields({ ...base(), desiredEase: 50.01 })).toEqual(['desiredEase']);
    expect(fields({ ...base(), userGauge: { stitches: 5, over: '10cm' } })).toEqual([]);
    expect(fields({ ...base(), userGauge: { stitches: 4.99, over: '10cm' } })).toEqual(['userGauge']);
    expect(fields({ ...base(), userGauge: { stitches: 50, over: '10cm' } })).toEqual([]);
    expect(fields({ ...base(), userGauge: { stitches: 50.01, over: '10cm' } })).toEqual(['userGauge']);
    expect(fields({ ...base(), sizes: [{ label: 'A', finishedBust: 40 }] })).toEqual([]);
    expect(fields({ ...base(), sizes: [{ label: 'A', finishedBust: 39.99 }] })).toEqual([
      'size.0.finishedBust',
    ]);
    expect(fields({ ...base(), sizes: [{ label: 'A', finishedBust: 250.01 }] })).toEqual([
      'size.0.finishedBust',
    ]);
  });

  it('applies ranges after converting inches', () => {
    // 20 in = 50.8 cm (valid); 19.5 in = 49.53 cm (too small).
    expect(fields({ ...base(), bodyUnit: 'in', bust: 20, desiredEase: 4 })).toEqual([]);
    expect(fields({ ...base(), bodyUnit: 'in', bust: 19.5, desiredEase: 4 })).toEqual(['bust']);
    // 20 in of ease = 50.8 cm (too much).
    expect(fields({ ...base(), bodyUnit: 'in', bust: 38, desiredEase: 20 })).toEqual(['desiredEase']);
    // 50 sts over 4 in ≈ 49.2 per 10 cm (valid); 51 over 4 in ≈ 50.2 (too many).
    expect(fields({ ...base(), userGauge: { stitches: 50, over: '4in' } })).toEqual([]);
    expect(fields({ ...base(), userGauge: { stitches: 51, over: '4in' } })).toEqual(['userGauge']);
  });

  it('requires 1 to 15 sizes', () => {
    expect(fields({ ...base(), sizes: [] })).toEqual(['sizes']);
    const many = Array.from({ length: 16 }, (_, i) => ({ label: `S${i}`, finishedBust: 80 + i }));
    expect(fields({ ...base(), sizes: many })).toEqual(['sizes']);
    expect(fields({ ...base(), sizes: many.slice(0, 15) })).toEqual([]);
  });

  it('requires a size label of at most 20 characters', () => {
    expect(fields({ ...base(), sizes: [{ label: '   ', finishedBust: 96 }] })).toEqual(['size.0.label']);
    expect(fields({ ...base(), sizes: [{ label: 'x'.repeat(21), finishedBust: 96 }] })).toEqual([
      'size.0.label',
    ]);
    expect(fields({ ...base(), sizes: [{ label: 'x'.repeat(20), finishedBust: 96 }] })).toEqual([]);
  });

  it('reports every problem at once, per size', () => {
    const errors = validate({
      ...base(),
      bust: Number.NaN,
      sizes: [
        { label: 'S', finishedBust: 96 },
        { label: '', finishedBust: Number.NaN },
      ],
    });
    expect(errors.map((e) => e.field)).toEqual(['bust', 'size.1.label', 'size.1.finishedBust']);
  });

  it('calculate returns errors instead of a result', () => {
    const outcome = calculate({ ...base(), bust: Number.NaN });
    expect(outcome.ok).toBe(false);
  });

  it('gives messages in the unit being used', () => {
    const [err] = validate({ ...base(), bodyUnit: 'in', bust: 10, desiredEase: 4 });
    expect(err?.message).toContain('in');
    expect(err?.message).not.toContain('cm');
  });
});

describe('duplicate labels', () => {
  it('reports duplicates case-insensitively without blocking the result', () => {
    const r = run({
      ...base(),
      sizes: [
        { label: 'S', finishedBust: 96 },
        { label: 's ', finishedBust: 98 },
        { label: 'M', finishedBust: 102 },
      ],
    });
    expect(r.duplicateLabels).toEqual(['S']);
  });
});

describe('determinism', () => {
  it('returns identical output for identical input', () => {
    const a = JSON.stringify(calculate(base()));
    for (let i = 0; i < 200; i += 1) expect(JSON.stringify(calculate(base()))).toBe(a);
  });

  it('does not mutate its input', () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    calculate(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
