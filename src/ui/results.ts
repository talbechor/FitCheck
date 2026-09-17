import type { FitCheckResult, SizeRow } from '../lib/fitcheck';
import { lengthIn, percent, signedLengthIn } from '../lib/format';
import type { LengthUnit } from '../lib/units';
import { h } from './dom';
import { renderSpectrum } from './spectrum';

export type DisclosureId = 'all-sizes' | 'why' | 'accuracy';

export interface ResultsContext {
  unit: LengthUnit;
  spectrumWidth: number;
  open: Record<DisclosureId, boolean>;
  helpful: 'unasked' | 'yes' | 'no';
  copyState: 'idle' | 'copied' | 'manual';
  shareUrl: string;
  feedbackUrl: string | null;
  onToggle: (id: DisclosureId, open: boolean) => void;
  onHelpful: (answer: 'yes' | 'no') => void;
  onCopy: () => void;
  onFeedback: () => void;
}

export function renderPlaceholder(missing: string[]): HTMLElement {
  return h(
    'div',
    { className: 'placeholder' },
    h('p', { className: 'placeholder__lead' }, 'Enter your measurements and pattern sizes to see your best match.'),
    missing.length > 0 ? h('p', { className: 'placeholder__missing' }, `Still needed: ${missing.join(', ')}.`) : null,
  );
}

export function renderInvalid(): HTMLElement {
  return h(
    'div',
    { className: 'placeholder' },
    h('p', { className: 'placeholder__lead' }, 'Check the highlighted fields to see your best match.'),
  );
}

function disclosure(
  ctx: ResultsContext,
  id: DisclosureId,
  summary: (string | Node)[],
  ...content: (Node | null)[]
): HTMLDetailsElement {
  const details = h(
    'details',
    { className: 'more', id: `more-${id}`, open: ctx.open[id] },
    h('summary', {}, ...summary),
    h('div', { className: 'more__body' }, ...content),
  );
  details.addEventListener('toggle', () => ctx.onToggle(id, details.open));
  return details;
}

function direction(r: FitCheckResult): string {
  return r.userGaugePer10cm < r.patternGaugePer10cm ? 'looser' : 'tighter';
}

function strongAlert(r: FitCheckResult): HTMLElement | null {
  if (r.gaugeWarning !== 'strong' && r.gaugeWarning !== 'check-inputs') return null;
  const pct = percent(r.gaugeDifference);
  const title =
    r.gaugeWarning === 'check-inputs'
      ? 'Check your gauge numbers.'
      : `Your gauge is ${pct} ${direction(r)} than the pattern’s.`;
  const first =
    r.gaugeWarning === 'check-inputs'
      ? `Your gauge is less than half or more than double the pattern’s (${pct} ${direction(r)}). Make sure each one uses the right span: 10 cm or 4 in.`
      : 'That’s a big difference. A new swatch on a different needle size may bring you closer.';
  return h(
    'div',
    { className: 'alert', role: 'alert' },
    h('p', { className: 'alert__title' }, title),
    h('p', {}, first),
    h(
      'p',
      { className: 'alert__key' },
      'FitCheck only estimates the finished width. It can’t tell you how the neckline, shoulders, armholes or yoke will fit at this gauge.',
    ),
  );
}

function caution(r: FitCheckResult): HTMLElement | null {
  if (r.gaugeWarning !== 'caution') return null;
  return h(
    'p',
    { className: 'caution', role: 'note' },
    h('strong', {}, `Your gauge is ${percent(r.gaugeDifference)} ${direction(r)} than the pattern’s. `),
    'The width estimate still works, but double-check your swatch before you cast on.',
  );
}

function hero(r: FitCheckResult, unit: LengthUnit): HTMLElement {
  const pick = r.rows[r.recommendedIndex] as SizeRow;
  const stat = (term: string, value: string, extra = '') =>
    h('div', { className: `stat${extra}` }, h('dt', {}, term), h('dd', {}, value));
  return h(
    'div',
    { className: 'hero' },
    h('p', { className: 'hero__label' }, 'Your best match'),
    h('p', { className: 'hero__size' }, pick.label),
    h(
      'dl',
      { className: 'stats' },
      stat('Estimated finished bust', lengthIn(pick.estimatedCm, unit), ' stat--main'),
      stat('Ease on you', signedLengthIn(pick.easeCm, unit)),
      stat('Target ease', signedLengthIn(r.desiredEaseCm, unit)),
    ),
  );
}

function inlineNotes(r: FitCheckResult, unit: LengthUnit): HTMLElement | null {
  const pick = r.rows[r.recommendedIndex] as SizeRow;
  const items: string[] = [];
  if (pick.negativeEase) {
    items.push(`Even ${pick.label} comes out smaller than your bust at your gauge.`);
  }
  if (r.noCloseMatch) {
    items.push(
      `No size is a close match: the nearest misses your ease by ${lengthIn(Math.abs(pick.diffCm), unit)}. A different needle size could bring your gauge closer to what you need.`,
    );
  }
  if (items.length === 0) return null;
  return h('div', { className: 'notes' }, ...items.map((t) => h('p', {}, t)));
}

function sizesTable(r: FitCheckResult, unit: LengthUnit): HTMLElement {
  const head = h(
    'thead',
    {},
    h(
      'tr',
      {},
      h('th', { scope: 'col' }, 'Size'),
      h('th', { scope: 'col' }, 'Pattern'),
      h('th', { scope: 'col' }, 'At your gauge'),
      h('th', { scope: 'col' }, 'Ease on you'),
      h('th', { scope: 'col' }, 'vs. target'),
    ),
  );
  const body = h(
    'tbody',
    {},
    ...r.rows.map((row) => {
      const isPick = row.index === r.recommendedIndex;
      return h(
        'tr',
        { className: isPick ? 'is-pick' : '' },
        h(
          'th',
          { scope: 'row' },
          h('span', { className: 'size-name' }, row.label),
          isPick ? h('span', { className: 'badge' }, 'Best match') : null,
        ),
        h('td', { className: 'c-pat', 'data-col': 'Pattern' }, lengthIn(row.patternCm, unit)),
        h('td', { className: 'c-est', 'data-col': 'At your gauge' }, lengthIn(row.estimatedCm, unit)),
        h(
          'td',
          { className: 'c-ease', 'data-col': 'Ease on you' },
          signedLengthIn(row.easeCm, unit),
          row.negativeEase ? h('span', { className: 'tag' }, 'smaller than you') : null,
        ),
        h('td', { className: 'c-diff', 'data-col': 'vs. target' }, signedLengthIn(row.diffCm, unit)),
      );
    }),
  );
  return h('div', { className: 'table-wrap' }, h('table', { className: 'compare' }, head, body));
}

function whyContent(r: FitCheckResult, unit: LengthUnit): HTMLElement {
  const pick = r.rows[r.recommendedIndex] as SizeRow;
  const fact = (term: string, value: string) => h('div', {}, h('dt', {}, term), h('dd', {}, value));
  const paras: HTMLElement[] = [
    h(
      'p',
      {},
      `At your gauge, ${pick.label}’s ${lengthIn(pick.patternCm, unit)} pattern measurement comes out at ${lengthIn(pick.estimatedCm, unit)}. That leaves ${signedLengthIn(pick.easeCm, unit)} of ease on your ${lengthIn(r.bustCm, unit)} bust, the closest of all sizes to your ${signedLengthIn(r.desiredEaseCm, unit)} target.`,
    ),
  ];
  if (r.tiedWithIndex !== null) {
    const other = r.rows[r.tiedWithIndex] as SizeRow;
    paras.push(
      h('p', {}, `${other.label} is just as close. We picked ${pick.label} because it’s roomier; choose ${other.label} for a closer fit.`),
    );
  }
  if (r.sizeShift > 0) {
    const ref = r.rows[r.patternGaugeIndex] as SizeRow;
    paras.push(
      h(
        'p',
        {},
        `At the pattern’s gauge you’d choose ${ref.label}. Your gauge changes that to ${pick.label}, so the neckline, shoulders and armholes will follow size ${pick.label}.`,
      ),
    );
  }
  return h(
    'div',
    {},
    h(
      'dl',
      { className: 'facts' },
      fact('Pattern finished bust', lengthIn(pick.patternCm, unit)),
      fact('Your bust', lengthIn(r.bustCm, unit)),
    ),
    ...paras,
  );
}

function accuracyContent(): HTMLElement {
  return h(
    'ul',
    { className: 'plain-list' },
    h('li', {}, 'It assumes the pattern’s finished measurements match its stitch counts.'),
    h('li', {}, 'Printed measurements are rounded, so expect about ±0.5 cm.'),
    h('li', {}, 'Heavily textured, cabled or lace fabric can behave differently from your swatch.'),
    h('li', {}, 'A cardigan’s finished bust may include the button band.'),
    h('li', {}, 'Very oversized or drop-shoulder designs depend on more than bust ease.'),
  );
}

function actions(ctx: ResultsContext): HTMLElement {
  const helpful =
    ctx.helpful === 'unasked'
      ? h(
          'div',
          { className: 'feedback', role: 'group', 'aria-label': 'Was this helpful?' },
          h('span', {}, 'Was this helpful?'),
          h('button', { type: 'button', className: 'chip', onclick: () => ctx.onHelpful('yes') }, 'Yes'),
          h('button', { type: 'button', className: 'chip', onclick: () => ctx.onHelpful('no') }, 'No'),
        )
      : h('p', { className: 'feedback', role: 'status' }, 'Thanks for telling us.');

  const links = h(
    'div',
    { className: 'share' },
    h(
      'button',
      { type: 'button', className: 'text-button', 'data-copy': true, onclick: ctx.onCopy },
      ctx.copyState === 'copied' ? 'Link copied' : 'Copy link to this result',
    ),
    ctx.feedbackUrl
      ? h(
          'a',
          { className: 'text-button', href: ctx.feedbackUrl, target: '_blank', rel: 'noopener noreferrer', onclick: ctx.onFeedback },
          'Send feedback',
        )
      : null,
  );

  const manual =
    ctx.copyState === 'manual'
      ? h(
          'div',
          { className: 'field share-manual' },
          h('label', { for: 'share-url' }, 'Copy this link'),
          h('input', { id: 'share-url', inputmode: 'url', readonly: true, value: ctx.shareUrl }),
        )
      : null;

  return h('div', { className: 'actions' }, helpful, links, manual);
}

export function renderResult(r: FitCheckResult, ctx: ResultsContext): HTMLElement {
  const tie = r.tiedWithIndex !== null ? (r.rows[r.tiedWithIndex] as SizeRow) : null;
  const sheet = h(
    'div',
    { className: 'sheet' },
    hero(r, ctx.unit),
    strongAlert(r),
    caution(r),
    inlineNotes(r, ctx.unit),
    renderSpectrum(r, ctx.unit, ctx.spectrumWidth),
    h(
      'div',
      { className: 'disclosures' },
      disclosure(ctx, 'all-sizes', ['See all sizes'], sizesTable(r, ctx.unit)),
      disclosure(
        ctx,
        'why',
        ['Why this size?', tie ? h('span', { className: 'summary-hint' }, ` ${tie.label} is just as close`) : ''],
        whyContent(r, ctx.unit),
      ),
      disclosure(ctx, 'accuracy', ['How accurate is this?'], accuracyContent()),
    ),
    h('p', { className: 'width-only' }, 'Width only. FitCheck doesn’t use row gauge, so lengths and yoke depth aren’t adjusted.'),
    actions(ctx),
  );
  return h('div', { className: 'answer__stack' }, sheet);
}
