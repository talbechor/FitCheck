import { afterEach, describe, expect, it } from 'vitest';
import {
  ALLOWED_PROP_VALUES,
  buildResultProps,
  isAllowedProps,
  setSender,
  sizesBucket,
  track,
  type EventName,
  type ResultProps,
} from '../src/lib/analytics';
import { calculate } from '../src/lib/fitcheck';
import { formatNumber, formatSigned, lengthIn, percent, signedLengthIn } from '../src/lib/format';
import { decodeState, emptyState, encodeState, exampleState, toInput } from '../src/lib/state';
import { round1 } from '../src/lib/units';

describe('formatting', () => {
  it('rounds half away from zero to one decimal', () => {
    expect(round1(91.85)).toBe(91.9);
    expect(round1(-0.25)).toBe(-0.3);
    expect(round1(0.04)).toBe(0);
    expect(Object.is(round1(-0.04), -0)).toBe(false);
  });

  it('uses a true minus sign and an explicit plus', () => {
    expect(formatNumber(-5.9)).toBe('−5.9');
    expect(formatSigned(9.826)).toBe('+9.8');
    expect(formatSigned(-0.174)).toBe('−0.2');
    expect(formatSigned(-0.04)).toBe('0.0');
  });

  it('converts for display', () => {
    expect(lengthIn(96, 'cm')).toBe('96.0 cm');
    expect(lengthIn(96.52, 'in')).toBe('38.0 in');
    expect(signedLengthIn(10.16, 'in')).toBe('+4.0 in');
    expect(percent(1 / 22)).toBe('4.5%');
  });
});

describe('form state', () => {
  it('reads decimal commas and drops fully empty size rows', () => {
    const input = toInput({
      ...emptyState(),
      bust: '82,5',
      ease: '10',
      patternStitches: '22',
      userStitches: '23,5',
      sizes: [
        { label: 'S', value: '96,5' },
        { label: '', value: '' },
      ],
    });
    expect(input.bust).toBe(82.5);
    expect(input.userGauge.stitches).toBe(23.5);
    expect(input.sizes).toEqual([{ label: 'S', finishedBust: 96.5 }]);
  });

  it('keeps half-filled size rows so validation can point at them', () => {
    const input = toInput({ ...emptyState(), sizes: [{ label: 'S', value: '' }] });
    expect(input.sizes).toHaveLength(1);
    expect(Number.isNaN(input.sizes[0]?.finishedBust)).toBe(true);
  });

  it('the example state produces the brief example result', () => {
    const outcome = calculate(toInput(exampleState()));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.rows[outcome.result.recommendedIndex]?.label).toBe('S');
  });
});

describe('share link', () => {
  it('round-trips the form through the URL fragment', () => {
    const state = {
      ...exampleState(),
      bodyUnit: 'in' as const,
      patternOver: '4in' as const,
      sizes: [
        { label: 'X~S|1', value: '34,5' },
        { label: 'Ümlaut & co', value: '37' },
      ],
    };
    const decoded = decodeState(`#${encodeState(state)}`);
    expect(decoded).toEqual(state);
  });

  it('ignores fragments that are not FitCheck links', () => {
    expect(decodeState('')).toBeNull();
    expect(decodeState('#section-2')).toBeNull();
    expect(decodeState('#v=2&b=82')).toBeNull();
  });

  it('sanitizes hostile or oversized values', () => {
    const long = 'x'.repeat(500);
    const sizes = Array.from({ length: 40 }, (_, i) => `S${i}~${90 + i}`).join('|');
    const decoded = decodeState(`#v=1&bu=mm&po=1yd&b=${long}&s=${encodeURIComponent(sizes)}`);
    expect(decoded?.bodyUnit).toBe('cm');
    expect(decoded?.patternOver).toBe('10cm');
    expect(decoded?.bust.length).toBe(12);
    expect(decoded?.sizes).toHaveLength(15);
  });

  it('survives malformed percent-encoding', () => {
    const decoded = decodeState('#v=1&s=%25E0%25A4~96');
    expect(decoded?.sizes[0]).toEqual({ label: '', value: '96' });
  });
});

describe('analytics privacy', () => {
  afterEach(() => setSender(null));

  it('buckets size counts', () => {
    expect([1, 2, 4, 5, 8, 9, 15].map(sizesBucket)).toEqual(['1', '2-4', '2-4', '5-8', '5-8', '9+', '9+']);
  });

  it('result props contain only allow-listed category strings', () => {
    const outcome = calculate(toInput(exampleState()));
    if (!outcome.ok) throw new Error('example should be valid');
    const props = buildResultProps(outcome.result, 'cm', 'in');
    expect(props).toEqual({ units: 'mixed', sizes: '2-4', gauge: 'none', shift: '1' });
    expect(isAllowedProps(props as unknown as Record<string, unknown>)).toBe(true);
    for (const [key, value] of Object.entries(props)) {
      expect(ALLOWED_PROP_VALUES[key as keyof ResultProps]).toContain(value);
    }
  });

  it('never sends the typed measurements, gauges or labels', () => {
    const sent: { name: EventName; props?: ResultProps }[] = [];
    setSender((name, props) => sent.push(props ? { name, props } : { name }));
    const state = { ...exampleState(), bust: '87.3', sizes: [{ label: 'Secret', value: '99.1' }] };
    const outcome = calculate(toInput(state));
    if (!outcome.ok) throw new Error('should be valid');
    track('result_shown', buildResultProps(outcome.result, 'cm', 'cm'));
    const payload = JSON.stringify(sent);
    for (const typed of ['87.3', '99.1', 'Secret', '22', '23', '82', '10']) {
      expect(payload).not.toContain(typed);
    }
    expect(payload).not.toMatch(/\d{2}/);
  });

  it('drops events whose props are not allow-listed', () => {
    const sent: unknown[] = [];
    setSender((name, props) => sent.push({ name, props }));
    track('result_shown', { units: 'cm', sizes: '2-4', gauge: 'none', shift: '82' } as unknown as ResultProps);
    track('helpful_yes');
    expect(sent).toEqual([{ name: 'helpful_yes', props: undefined }]);
  });

  it('never throws if the analytics sender fails', () => {
    setSender(() => {
      throw new Error('blocked');
    });
    expect(() => track('link_copied')).not.toThrow();
  });

  it('is a no-op when no analytics script is present', () => {
    expect(() => track('input_started')).not.toThrow();
  });
});
