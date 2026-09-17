import { describe, expect, it } from 'vitest';
import { calculate, type FitCheckInput, type FitCheckResult } from '../src/lib/fitcheck';
import { formatNumber, formatSigned } from '../src/lib/format';
import { fromCm, type LengthUnit } from '../src/lib/units';

function run(input: FitCheckInput): FitCheckResult {
  const outcome = calculate(input);
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.errors));
  return outcome.result;
}

/** The table exactly as FitCheck displays it, in the body unit. */
function table(result: FitCheckResult, unit: LengthUnit) {
  return result.rows.map((r) => [
    r.label,
    formatNumber(fromCm(r.patternCm, unit)),
    formatNumber(fromCm(r.estimatedCm, unit)),
    formatSigned(fromCm(r.easeCm, unit)),
    formatSigned(fromCm(r.diffCm, unit)),
  ]);
}

const label = (result: FitCheckResult, i: number | null) =>
  i === null ? null : (result.rows[i]?.label ?? null);

describe('Golden example 1: metric, tighter gauge', () => {
  const result = run({
    bodyUnit: 'cm',
    bust: 82,
    desiredEase: 10,
    patternGauge: { stitches: 22, over: '10cm' },
    userGauge: { stitches: 23, over: '10cm' },
    sizesUnit: 'cm',
    sizes: [
      { label: 'XS', finishedBust: 90 },
      { label: 'S', finishedBust: 96 },
      { label: 'M', finishedBust: 102 },
      { label: 'L', finishedBust: 108 },
    ],
  });

  it('reproduces the comparison table', () => {
    expect(table(result, 'cm')).toEqual([
      ['XS', '90.0', '86.1', '+4.1', '−5.9'],
      ['S', '96.0', '91.8', '+9.8', '−0.2'],
      ['M', '102.0', '97.6', '+15.6', '+5.6'],
      ['L', '108.0', '103.3', '+21.3', '+11.3'],
    ]);
  });

  it('recommends S, notes XS at pattern gauge, and gives no gauge warning', () => {
    expect(label(result, result.recommendedIndex)).toBe('S');
    expect(result.tiedWithIndex).toBeNull();
    expect(label(result, result.patternGaugeIndex)).toBe('XS');
    expect(result.sizeShift).toBe(1);
    expect(result.ratio).toBeCloseTo(22 / 23, 12);
    expect(result.gaugeDifference).toBeCloseTo(1 / 22, 12);
    expect(result.gaugeWarning).toBe('none');
    expect(result.noCloseMatch).toBe(false);
  });
});

describe('Golden example 2: imperial, looser gauge, exactly 10%', () => {
  const result = run({
    bodyUnit: 'in',
    bust: 38,
    desiredEase: 4,
    patternGauge: { stitches: 20, over: '4in' },
    userGauge: { stitches: 18, over: '4in' },
    sizesUnit: 'in',
    sizes: [
      { label: '1', finishedBust: 34 },
      { label: '2', finishedBust: 37 },
      { label: '3', finishedBust: 40 },
      { label: '4', finishedBust: 43 },
      { label: '5', finishedBust: 46 },
    ],
  });

  it('reproduces the comparison table in inches', () => {
    expect(table(result, 'in')).toEqual([
      ['1', '34.0', '37.8', '−0.2', '−4.2'],
      ['2', '37.0', '41.1', '+3.1', '−0.9'],
      ['3', '40.0', '44.4', '+6.4', '+2.4'],
      ['4', '43.0', '47.8', '+9.8', '+5.8'],
      ['5', '46.0', '51.1', '+13.1', '+9.1'],
    ]);
  });

  it('recommends size 2, flags size 1, shifts two sizes, cautions at exactly 10%', () => {
    expect(label(result, result.recommendedIndex)).toBe('2');
    expect(result.rows[0]?.negativeEase).toBe(true);
    expect(result.rows.slice(1).every((r) => !r.negativeEase)).toBe(true);
    expect(label(result, result.patternGaugeIndex)).toBe('4');
    expect(result.sizeShift).toBe(2);
    expect(result.gaugeWarning).toBe('caution');
  });
});

describe('Golden example 3: exact gauge, tie between sizes', () => {
  const result = run({
    bodyUnit: 'cm',
    bust: 100,
    desiredEase: 5,
    patternGauge: { stitches: 18, over: '10cm' },
    userGauge: { stitches: 18, over: '10cm' },
    sizesUnit: 'cm',
    sizes: [
      { label: '1', finishedBust: 100 },
      { label: '2', finishedBust: 110 },
      { label: '3', finishedBust: 120 },
    ],
  });

  it('reproduces the comparison table', () => {
    expect(table(result, 'cm')).toEqual([
      ['1', '100.0', '100.0', '0.0', '−5.0'],
      ['2', '110.0', '110.0', '+10.0', '+5.0'],
      ['3', '120.0', '120.0', '+20.0', '+15.0'],
    ]);
  });

  it('picks the roomier size and reports the tie', () => {
    expect(label(result, result.recommendedIndex)).toBe('2');
    expect(label(result, result.tiedWithIndex)).toBe('1');
    expect(label(result, result.patternGaugeIndex)).toBe('2');
    expect(result.sizeShift).toBe(0);
    expect(result.gaugeWarning).toBe('none');
    expect(result.noCloseMatch).toBe(false);
  });
});
