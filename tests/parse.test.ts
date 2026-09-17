import { describe, expect, it } from 'vitest';
import { extractNumbers, isBlank, parseNumber, parseSizeList } from '../src/lib/parse';

describe('parseNumber', () => {
  it('reads whole numbers and decimal points', () => {
    expect(parseNumber('82')).toBe(82);
    expect(parseNumber(' 92.5 ')).toBe(92.5);
    expect(parseNumber('22.')).toBe(22);
    expect(parseNumber('.5')).toBe(0.5);
  });

  it('reads a decimal comma', () => {
    expect(parseNumber('92,5')).toBe(92.5);
    expect(parseNumber('22,75')).toBe(22.75);
    expect(parseNumber(',5')).toBe(0.5);
  });

  it('keeps the sign so validation can explain it', () => {
    expect(parseNumber('-5')).toBe(-5);
    expect(parseNumber('+5')).toBe(5);
  });

  it('returns null for blank or unreadable input', () => {
    for (const raw of ['', '   ', 'abc', '1.2.3', '1,2,3', '92,5.1', '5 cm', '1e3', '--5', 'NaN', 'Infinity']) {
      expect(parseNumber(raw), raw).toBeNull();
    }
  });

  it('ignores spaces inside the number', () => {
    expect(parseNumber('1 0 2')).toBe(102);
  });

  it('isBlank', () => {
    expect(isBlank('  ')).toBe(true);
    expect(isBlank(' 0 ')).toBe(false);
  });
});

describe('extractNumbers', () => {
  it('reads the common parenthesis notation', () => {
    expect(extractNumbers('86 (91, 96, 101)')).toEqual([86, 91, 96, 101]);
  });

  it('treats a comma followed by one digit as a decimal comma', () => {
    expect(extractNumbers('86,5 (91,5, 96)')).toEqual([86.5, 91.5, 96]);
    expect(extractNumbers('86,5 (91,5)')).toEqual([86.5, 91.5]);
  });

  it('treats other commas as separators, with or without spaces', () => {
    expect(extractNumbers('86 (91,96,101)')).toEqual([86, 91, 96, 101]);
    expect(extractNumbers('86,91,96')).toEqual([86, 91, 96]);
  });

  it('ignores a caption before the first number and unit words', () => {
    expect(extractNumbers('Finished bust: 34 (37, 40) in')).toEqual([34, 37, 40]);
    expect(extractNumbers('Finished chest circumference 86 (91) cm')).toEqual([86, 91]);
  });

  it('accepts other separators', () => {
    expect(extractNumbers('86 / 91 / 96')).toEqual([86, 91, 96]);
    expect(extractNumbers('86; 91; 96')).toEqual([86, 91, 96]);
    expect(extractNumbers('86 [91] {96}')).toEqual([86, 91, 96]);
  });
});

describe('parseSizeList', () => {
  it('numbers only: labels become Size 1, Size 2, …', () => {
    const r = parseSizeList('86 (91, 96, 101) cm');
    expect(r.sizes).toEqual([
      { label: 'Size 1', finishedBust: 86 },
      { label: 'Size 2', finishedBust: 91 },
      { label: 'Size 3', finishedBust: 96 },
      { label: 'Size 4', finishedBust: 101 },
    ]);
    expect(r.unit).toBe('cm');
    expect(r.problems).toEqual([]);
  });

  it('detects inches from in, inch, inches and the inch mark', () => {
    expect(parseSizeList('34 (37, 40) in').unit).toBe('in');
    expect(parseSizeList('34 (37, 40) inches').unit).toBe('in');
    expect(parseSizeList('34" (37", 40")').unit).toBe('in');
    expect(parseSizeList('34″ (37″)').unit).toBe('in');
    expect(parseSizeList('34 (37, 40)').unit).toBeNull();
  });

  it('reads fractions written as ½ ¼ ¾', () => {
    expect(parseSizeList('34½ (37¼, 40¾) in').sizes.map((s) => s.finishedBust)).toEqual([
      34.5, 37.25, 40.75,
    ]);
  });

  it('labeled pairs on one line', () => {
    const r = parseSizeList('XS = 90, S = 96, M = 102, L = 108');
    expect(r.sizes).toEqual([
      { label: 'XS', finishedBust: 90 },
      { label: 'S', finishedBust: 96 },
      { label: 'M', finishedBust: 102 },
      { label: 'L', finishedBust: 108 },
    ]);
  });

  it('labeled pairs on separate lines, with units and decimal commas', () => {
    const r = parseSizeList('XS: 86,5 cm\nS: 91,5 cm\n2XL: 121 cm');
    expect(r.sizes).toEqual([
      { label: 'XS', finishedBust: 86.5 },
      { label: 'S', finishedBust: 91.5 },
      { label: '2XL', finishedBust: 121 },
    ]);
    expect(r.unit).toBe('cm');
  });

  it('labeled pairs separated by spaces when the label has letters', () => {
    expect(parseSizeList('XS 90\nS 96').sizes).toEqual([
      { label: 'XS', finishedBust: 90 },
      { label: 'S', finishedBust: 96 },
    ]);
  });

  it('numeric labels need an explicit separator', () => {
    expect(parseSizeList('Size 1: 34\nSize 2: 37').sizes).toEqual([
      { label: '1', finishedBust: 34 },
      { label: '2', finishedBust: 37 },
    ]);
  });

  it('two lines: size names, then measurements', () => {
    const r = parseSizeList('Sizes: XS (S, M, L, XL)\nFinished bust: 86 (91, 96, 101, 106) cm');
    expect(r.sizes.map((s) => [s.label, s.finishedBust])).toEqual([
      ['XS', 86],
      ['S', 91],
      ['M', 96],
      ['L', 101],
      ['XL', 106],
    ]);
    expect(r.problems).toEqual([]);
  });

  it('two lines: measurements first, numeric size names second', () => {
    const r = parseSizeList('Finished bust: 34 (37, 40) in\nSizes: 1 (2, 3)');
    expect(r.sizes.map((s) => [s.label, s.finishedBust])).toEqual([
      ['1', 34],
      ['2', 37],
      ['3', 40],
    ]);
    expect(r.unit).toBe('in');
  });

  it('two lines that do not line up: numbers the sizes and says so', () => {
    const r = parseSizeList('XS (S, M, L, XL)\n86 (91, 96)');
    expect(r.sizes.map((s) => [s.label, s.finishedBust])).toEqual([
      ['Size 1', 86],
      ['Size 2', 91],
      ['Size 3', 96],
    ]);
    expect(r.problems).toHaveLength(1);
  });

  it('keeps the order written in the pattern', () => {
    expect(parseSizeList('108 (90, 102)').sizes.map((s) => s.finishedBust)).toEqual([108, 90, 102]);
  });

  it('flags mixed units', () => {
    const r = parseSizeList('86 cm (34 in)');
    expect(r.unit).toBeNull();
    expect(r.problems.some((p) => p.includes('both cm and inches'))).toBe(true);
  });

  it('warns about "to fit" body measurements', () => {
    const r = parseSizeList('To fit bust: 76 (81, 86) cm');
    expect(r.problems.some((p) => p.includes('to fit'))).toBe(true);
  });

  it('explains empty or number-free pastes', () => {
    expect(parseSizeList('').problems).toHaveLength(1);
    const r = parseSizeList('XS (S, M)');
    expect(r.sizes).toEqual([]);
    expect(r.problems.some((p) => p.startsWith('No measurements found'))).toBe(true);
  });

  it('keeps at most 15 sizes and says so', () => {
    const text = Array.from({ length: 18 }, (_, i) => 80 + i).join(', ');
    const r = parseSizeList(text);
    expect(r.sizes).toHaveLength(15);
    expect(r.problems.some((p) => p.includes('first 15'))).toBe(true);
  });

  it('passes implausible values through so the form can flag them', () => {
    expect(parseSizeList('86 (91, 5)').sizes.map((s) => s.finishedBust)).toEqual([86, 91, 5]);
    // A comma followed by a single digit is read as a decimal comma.
    expect(parseSizeList('86,91,5').sizes.map((s) => s.finishedBust)).toEqual([86, 91.5]);
  });
});
