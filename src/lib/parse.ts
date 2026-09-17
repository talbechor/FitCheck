import type { LengthUnit } from './units';
import type { SizeInput } from './fitcheck';

const NUMBER_RE = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;

/**
 * Parse a number typed by a person. Accepts a decimal point or a decimal
 * comma ("92.5" or "92,5"). Returns null for blank or unreadable input.
 */
export function parseNumber(raw: string): number | null {
  const text = raw.trim().replace(/\s+/g, '');
  if (text === '' || !NUMBER_RE.test(text)) return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export function isBlank(raw: string): boolean {
  return raw.trim() === '';
}

/* ------------------------------------------------------------------ */
/* Finished-bust paste parser                                          */
/* ------------------------------------------------------------------ */

export interface PasteResult {
  sizes: SizeInput[];
  /** Unit written in the pasted text, if exactly one was found. */
  unit: LengthUnit | null;
  /** Human-readable notes; empty when the paste was read cleanly. */
  problems: string[];
}

const FRACTIONS: Record<string, string> = { '½': '.5', '¼': '.25', '¾': '.75' };
const MAX_SIZES = 15;

function normalize(text: string): string {
  return text
    .replace(/(\d)\s*([½¼¾])/g, (_, d: string, f: string) => d + (FRACTIONS[f] ?? ''))
    .replace(/[½¼¾]/g, (f) => `0${FRACTIONS[f] ?? ''}`)
    .replace(/[″”“]/g, '"')
    .replace(/ /g, ' ');
}

function detectUnit(text: string): { unit: LengthUnit | null; mixed: boolean } {
  const cm = /\bcm\b|\dcm\b|centimet(?:er|re)s?/i.test(text);
  // "in" only counts right after a number or a closing parenthesis ("34 (37) in").
  const inch = /[\d)\]]\s*(?:"|in\b|inch(?:es)?\b)|\binch(?:es)?\b/i.test(text);
  if (cm && inch) return { unit: null, mixed: true };
  if (cm) return { unit: 'cm', mixed: false };
  if (inch) return { unit: 'in', mixed: false };
  return { unit: null, mixed: false };
}

function stripUnits(text: string): string {
  return text.replace(/centimet(?:er|re)s?|\bcm\b|\binch(?:es)?\b|\bin\b\.?|"/gi, ' ');
}

/**
 * Pull numbers out of a line such as `86 (91, 96, 101)`.
 * A dot is always a decimal point. A comma followed by exactly one digit
 * (e.g. `86,5`) is a decimal comma; every other comma separates values.
 */
export function extractNumbers(line: string): number[] {
  const firstDigit = line.search(/\d/);
  if (firstDigit < 0) return [];
  const body = stripUnits(line.slice(firstDigit)).replace(/(\d),(\d)(?!\d)/g, '$1.$2');
  const matches = body.match(/\d+(?:\.\d+)?/g) ?? [];
  return matches.map(Number);
}

const LABELED_RE =
  /^(?:size\s+)?([A-Za-z0-9][A-Za-z0-9+/-]*)\s*(?:[:=]\s*|\s+)(\d+(?:[.,]\d+)?)\s*(?:cm|in|inch(?:es)?|")?\.?$/i;

function tryLabeled(text: string): SizeInput[] | null {
  const segments = text
    .split(/\n|;|,(?=\s)/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;
  const out: SizeInput[] = [];
  for (const segment of segments) {
    const m = LABELED_RE.exec(segment);
    if (!m) return null;
    const label = m[1] as string;
    const hasExplicitSeparator = /[:=]/.test(segment);
    if (!hasExplicitSeparator && !/[A-Za-z]/.test(label)) return null;
    const value = Number((m[2] as string).replace(',', '.'));
    out.push({ label, finishedBust: value });
  }
  return out;
}

function stripPrefix(line: string): string {
  // "Sizes: XS (S, M)" or "Finished bust: 86 (91)" → drop the leading caption.
  const m = /^([A-Za-z][A-Za-z\s]*?):\s*(.*)$/.exec(line);
  return m ? (m[2] as string) : line;
}

function labelTokens(line: string): string[] {
  return stripPrefix(line)
    .split(/[()\s,;/]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function tryTwoLine(lines: string[]): SizeInput[] | null {
  if (lines.length !== 2) return null;
  const [a, b] = lines as [string, string];
  const numsA = extractNumbers(stripPrefix(a));
  const numsB = extractNumbers(stripPrefix(b));
  const plausible = (ns: number[]) => ns.length > 0 && ns.every((n) => n >= 20);
  let labelsLine: string;
  let values: number[];
  if (plausible(numsB) && !plausible(numsA)) {
    labelsLine = a;
    values = numsB;
  } else if (plausible(numsA) && !plausible(numsB)) {
    labelsLine = b;
    values = numsA;
  } else {
    return null;
  }
  const labels = labelTokens(labelsLine);
  if (labels.length !== values.length) return null;
  return labels.map((label, i) => ({ label, finishedBust: values[i] as number }));
}

export function parseSizeList(raw: string): PasteResult {
  const text = normalize(raw).trim();
  const problems: string[] = [];
  if (text === '') {
    return { sizes: [], unit: null, problems: ['Paste the finished bust line from your pattern.'] };
  }

  const { unit, mixed } = detectUnit(text);
  if (mixed) problems.push('The paste mentions both cm and inches. Check the unit before using it.');
  if (/to\s*fit/i.test(text)) {
    problems.push(
      'This looks like "to fit" body sizes. FitCheck needs the finished bust of the garment.',
    );
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let sizes = tryLabeled(text) ?? tryTwoLine(lines);

  if (!sizes) {
    const perLine = lines.map((l) => extractNumbers(stripPrefix(l)));
    const measurementLines = perLine.filter((ns) => ns.length > 0 && ns.every((n) => n >= 20));
    const used = measurementLines.length > 0 ? measurementLines : perLine;
    if (lines.length > 1 && used.length < lines.length) {
      problems.push("Couldn't match size names to measurements, so sizes are numbered instead.");
    }
    sizes = used.flat().map((v, i) => ({ label: `Size ${i + 1}`, finishedBust: v }));
  }

  if (sizes.length === 0) {
    problems.push('No measurements found. Try a line like 86 (91, 96, 101).');
  }
  if (sizes.length > MAX_SIZES) {
    problems.push(`Found ${sizes.length} values; FitCheck uses the first ${MAX_SIZES}.`);
    sizes = sizes.slice(0, MAX_SIZES);
  }

  return { sizes, unit, problems };
}
