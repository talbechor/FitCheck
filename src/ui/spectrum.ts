import type { FitCheckResult } from '../lib/fitcheck';
import { formatSigned, unitLabel } from '../lib/format';
import { fromCm, type LengthUnit } from '../lib/units';
import { h } from './dom';

export interface SpectrumRange {
  start: number;
  end: number;
}

/** Axis range in display units, with a minimum span so close sizes don't look far apart. */
export function spectrumRange(values: number[], unit: LengthUnit): SpectrumRange {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const minSpan = unit === 'in' ? 4 : 10;
  const span = Math.max(hi - lo, minSpan);
  const mid = (lo + hi) / 2;
  const half = span / 2 + span * 0.1;
  return { start: mid - half, end: mid + half };
}

const LABEL_CHAR_PX = 9;
const LABEL_PAD_PX = 14;
const EDGE_PX = 48;

function edgeClass(pctValue: number, widthPx: number): string {
  if ((pctValue / 100) * widthPx < EDGE_PX) return ' is-left-edge';
  if (((100 - pctValue) / 100) * widthPx < EDGE_PX) return ' is-right-edge';
  return '';
}

export function renderSpectrum(result: FitCheckResult, unit: LengthUnit, widthPx: number): HTMLElement {
  const width = Math.max(widthPx, 240);
  const u = unitLabel(unit);
  const eases = result.rows.map((r) => fromCm(r.easeCm, unit));
  const target = fromCm(result.desiredEaseCm, unit);
  const anyNegative = result.rows.some((r) => r.negativeEase);
  const range = spectrumRange([...eases, target, ...(anyNegative ? [0] : [])], unit);
  const pct = (v: number) => ((v - range.start) / (range.end - range.start)) * 100;

  const track = h('div', { className: 'spectrum__track', 'aria-hidden': 'true' });

  if (anyNegative) {
    const zonePct = pct(0);
    const zone = h(
      'div',
      { className: 'spectrum__zone' },
      (zonePct / 100) * width >= 120 ? h('span', {}, 'Smaller than you') : null,
    );
    zone.style.setProperty('width', `${zonePct}%`);
    track.append(zone);
  }

  track.append(h('div', { className: 'spectrum__line' }));

  const targetPct = pct(target);
  const targetEl = h(
    'div',
    { className: `spectrum__target${edgeClass(targetPct, width)}` },
    h('span', {}, `Target ${formatSigned(target)} ${u}`),
  );
  targetEl.style.setProperty('left', `${targetPct}%`);
  track.append(targetEl);

  // Decide which size labels fit: the best match first, then a tie, then the rest by closeness.
  const pickIndex = result.recommendedIndex;
  const order = result.rows
    .map((row, i) => ({ i, x: (pct(eases[i] as number) / 100) * width, w: row.label.length * LABEL_CHAR_PX + LABEL_PAD_PX }))
    .sort((a, b) => {
      const rank = (i: number) => (i === pickIndex ? 0 : i === result.tiedWithIndex ? 1 : 2);
      const pickX = (pct(eases[pickIndex] as number) / 100) * width;
      return rank(a.i) - rank(b.i) || Math.abs(a.x - pickX) - Math.abs(b.x - pickX) || a.i - b.i;
    });
  const placed: { from: number; to: number }[] = [];
  const showLabel = new Set<number>();
  for (const item of order) {
    const from = item.x - item.w / 2;
    const to = item.x + item.w / 2;
    if (placed.every((p) => to < p.from || from > p.to)) {
      placed.push({ from, to });
      showLabel.add(item.i);
    }
  }

  result.rows.forEach((row, i) => {
    const at = pct(eases[i] as number);
    const isPick = i === pickIndex;
    const dot = h(
      'div',
      { className: `spectrum__size${isPick ? ' is-pick' : ''}${edgeClass(at, width)}` },
      h('span', { className: 'spectrum__dot' }),
      showLabel.has(i) ? h('span', { className: 'spectrum__label' }, row.label) : null,
    );
    dot.style.setProperty('left', `${at}%`);
    track.append(dot);
  });

  const pick = result.rows[pickIndex];
  const listing = result.rows.map((r, i) => `${r.label} ${formatSigned(eases[i] as number)} ${u}`).join(', ');
  const summary = `Fit spectrum from closer fit to more relaxed. Your target ease is ${formatSigned(target)} ${u}. Best match ${pick?.label ?? ''} gives ${formatSigned(eases[pickIndex] as number)} ${u}. Ease on you by size: ${listing}.`;

  return h(
    'figure',
    { className: 'spectrum', role: 'img', 'aria-label': summary },
    track,
    h(
      'div',
      { className: 'spectrum__ends', 'aria-hidden': 'true' },
      h('span', {}, '← Closer fit'),
      h('span', {}, 'More relaxed →'),
    ),
  );
}
