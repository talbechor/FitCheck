import './styles.css';
import { buildResultProps, track } from './lib/analytics';
import { calculate, type InputError, LIMITS } from './lib/fitcheck';
import { isBlank, parseNumber, parseSizeList, type PasteResult } from './lib/parse';
import {
  decodeState,
  emptyState,
  encodeState,
  exampleState,
  type FormState,
  toInput,
} from './lib/state';
import type { GaugeSpan, LengthUnit } from './lib/units';
import { byId, h } from './ui/dom';
import { type DisclosureId, renderInvalid, renderPlaceholder, renderResult } from './ui/results';

/* ------------------------------------------------------------------ */
/* Configuration (all optional)                                        */
/* ------------------------------------------------------------------ */

const env = import.meta.env;
const cleanUrl = (v: string | undefined) => (v && /^https:\/\//.test(v) ? v : null);
const WAITLIST_URL = cleanUrl(env.VITE_WAITLIST_URL);
const FEEDBACK_URL = cleanUrl(env.VITE_FEEDBACK_URL);

function setupAnalytics(): void {
  const domain = env.VITE_PLAUSIBLE_DOMAIN?.trim();
  if (!domain) return;
  window.plausible =
    window.plausible ||
    function (...args: unknown[]) {
      const q = ((window.plausible as unknown as { q?: unknown[] }).q ??= []);
      q.push(args);
    };
  const script = document.createElement('script');
  script.defer = true;
  script.dataset.domain = domain;
  script.src = env.VITE_PLAUSIBLE_SRC?.trim() || 'https://plausible.io/js/script.js';
  document.head.append(script);
  byId('analytics-note').hidden = false;
}

/** The Custom Fit waitlist button only appears when a waitlist URL is configured. */
function setupWaitlist(): void {
  if (!WAITLIST_URL) return;
  const link = byId<HTMLAnchorElement>('cf-waitlist');
  link.href = WAITLIST_URL;
  link.hidden = false;
  byId('cf-join').hidden = false;
  link.addEventListener('click', () => track('waitlist_clicked'));
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const fromLink = decodeState(window.location.hash);
let state: FormState = fromLink ?? emptyState();
const touched = new Set<string>();
let started = false;
let resultTracked = false;
let lastPickKey = '';
let helpful: 'unasked' | 'yes' | 'no' = 'unasked';
let copyState: 'idle' | 'copied' | 'manual' = 'idle';
let copyTimer: number | undefined;
let pasteResult: PasteResult | null = null;
const isWide = () => window.matchMedia('(min-width: 60rem)').matches;
// "See all sizes" starts open on desktop and collapsed on mobile; after that the
// knitter's own choice is kept while results update.
const disclosureOpen: Record<DisclosureId, boolean> = {
  'all-sizes': isWide(),
  why: false,
  accuracy: false,
};

const PRESETS: Record<LengthUnit, { name: string; value: number }[]> = {
  cm: [
    { name: 'Close', value: 5 },
    { name: 'Classic', value: 10 },
    { name: 'Relaxed', value: 15 },
    { name: 'Oversized', value: 25 },
  ],
  in: [
    { name: 'Close', value: 2 },
    { name: 'Classic', value: 4 },
    { name: 'Relaxed', value: 6 },
    { name: 'Oversized', value: 10 },
  ],
};

/* ------------------------------------------------------------------ */
/* Elements                                                            */
/* ------------------------------------------------------------------ */

const form = byId<HTMLFormElement>('form');
const bustInput = byId<HTMLInputElement>('bust');
const easeInput = byId<HTMLInputElement>('ease');
const patternInput = byId<HTMLInputElement>('patternStitches');
const userInput = byId<HTMLInputElement>('userStitches');
const presetsEl = byId('presets');
const sizesEl = byId('sizes');
const addSizeBtn = byId<HTMLButtonElement>('add-size');
const pasteToggle = byId<HTMLButtonElement>('paste-toggle');
const pastePanel = byId('paste');
const pasteText = byId<HTMLTextAreaElement>('paste-text');
const pastePreview = byId('paste-preview');
const pasteUse = byId<HTMLButtonElement>('paste-use');
const resultsBody = byId('results-body');
const resultsSection = byId('results');
const announce = byId('announce');

function radio(name: string): RadioNodeList {
  return form.elements.namedItem(name) as RadioNodeList;
}

/* ------------------------------------------------------------------ */
/* Form rendering                                                      */
/* ------------------------------------------------------------------ */

function syncFormFromState(): void {
  bustInput.value = state.bust;
  easeInput.value = state.ease;
  patternInput.value = state.patternStitches;
  userInput.value = state.userStitches;
  radio('bodyUnit').value = state.bodyUnit;
  radio('sizesUnit').value = state.sizesUnit;
  radio('patternOver').value = state.patternOver;
  radio('userOver').value = state.userOver;
  renderSizeRows();
  syncUnits();
}

function syncUnits(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-unit="body"]')) {
    el.textContent = state.bodyUnit;
  }
  const head = sizesEl.querySelector('[data-unit="sizes"]');
  if (head) head.textContent = `Finished bust (${state.sizesUnit})`;
  renderPresets();
}

function renderPresets(): void {
  const current = parseNumber(state.ease);
  presetsEl.replaceChildren(
    ...PRESETS[state.bodyUnit].map((p) =>
      h(
        'button',
        {
          type: 'button',
          className: 'preset',
          'aria-pressed': String(current === p.value),
          onclick: () => {
            state.ease = String(p.value);
            easeInput.value = state.ease;
            touched.add('desiredEase');
            markStarted();
            update();
          },
        },
        `${p.name} ${p.value} ${state.bodyUnit}`,
      ),
    ),
  );
}

function renderSizeRows(focusIndex?: number): void {
  const header = h(
    'div',
    { className: 'size-row__head', 'aria-hidden': 'true' },
    h('span', {}, 'Size'),
    h('span', { 'data-unit': 'sizes' }, `Finished bust (${state.sizesUnit})`),
    h('span', {}),
  );

  const rows = state.sizes.map((size, i) => {
    const labelId = `size-${i}-label`;
    const valueId = `size-${i}-value`;
    const errorId = `size-${i}-error`;
    const label = h('input', {
      id: labelId,
      type: 'text',
      inputmode: 'text',
      maxlength: LIMITS.labelMaxLength,
      value: size.label,
      'aria-label': `Size ${i + 1} name`,
      'aria-describedby': errorId,
      placeholder: i === 0 ? 'S' : '',
    });
    const value = h('input', {
      id: valueId,
      inputmode: 'decimal',
      value: size.value,
      'aria-label': `Size ${i + 1} finished bust in ${state.sizesUnit}`,
      'aria-describedby': errorId,
      placeholder: i === 0 ? (state.sizesUnit === 'cm' ? '96' : '38') : '',
    });
    label.addEventListener('input', () => {
      (state.sizes[i] as { label: string }).label = label.value;
      touched.add(`size.${i}.label`);
      markStarted();
      update();
    });
    value.addEventListener('input', () => {
      (state.sizes[i] as { value: string }).value = value.value;
      touched.add(`size.${i}.finishedBust`);
      touched.add(`size.${i}.label`);
      markStarted();
      update();
    });
    const remove = h(
      'button',
      {
        type: 'button',
        className: 'icon-button',
        'aria-label': `Remove size ${size.label.trim() || i + 1}`,
        onclick: () => removeSize(i),
      },
      '×',
    );
    return h(
      'div',
      { className: 'size-row', role: 'listitem' },
      label,
      value,
      remove,
      h('p', { className: 'error', id: errorId, hidden: true }),
    );
  });

  sizesEl.replaceChildren(header, ...rows);
  addSizeBtn.disabled = state.sizes.length >= LIMITS.sizes.max;
  if (focusIndex !== undefined) byId<HTMLInputElement>(`size-${focusIndex}-label`).focus();
}

function removeSize(i: number): void {
  if (state.sizes.length === 1) {
    state.sizes = [{ label: '', value: '' }];
  } else {
    state.sizes.splice(i, 1);
  }
  // Row indexes shift, so re-key touched flags for sizes.
  for (const key of [...touched]) if (key.startsWith('size.')) touched.delete(key);
  state.sizes.forEach((s, j) => {
    if (s.label || s.value) {
      touched.add(`size.${j}.label`);
      touched.add(`size.${j}.finishedBust`);
    }
  });
  renderSizeRows();
  const next = document.getElementById(`size-${Math.min(i, state.sizes.length - 1)}-label`);
  next?.focus();
  update();
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

const NUMBER_HINT = 'Use a number, like 92.5 or 92,5.';

function unreadable(raw: string): boolean {
  return !isBlank(raw) && parseNumber(raw) === null;
}

function showError(field: string, errorId: string, inputs: HTMLElement[], message: string | null): void {
  const el = document.getElementById(errorId);
  if (!el) return;
  const visible = message !== null && touched.has(field);
  el.hidden = !visible;
  el.textContent = visible ? message : '';
  for (const input of inputs) {
    if (visible) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

function renderErrors(errors: InputError[]): void {
  const find = (field: string) => errors.find((e) => e.field === field)?.message ?? null;
  const numberAware = (field: string, raw: string) => (unreadable(raw) ? NUMBER_HINT : find(field));

  showError('bust', 'bust-error', [bustInput], numberAware('bust', state.bust));
  showError('desiredEase', 'ease-error', [easeInput], numberAware('desiredEase', state.ease));
  showError('patternGauge', 'patternGauge-error', [patternInput], numberAware('patternGauge', state.patternStitches));
  showError('userGauge', 'userGauge-error', [userInput], numberAware('userGauge', state.userStitches));

  const sizesError = find('sizes');
  const sizesEl2 = byId('sizes-error');
  sizesEl2.hidden = !(sizesError && touched.has('sizes'));
  sizesEl2.textContent = sizesError ?? '';

  // Size rows: errors are indexed over non-empty rows, so map back.
  let inputIndex = 0;
  state.sizes.forEach((size, i) => {
    const labelEl = document.getElementById(`size-${i}-label`);
    const valueEl = document.getElementById(`size-${i}-value`);
    if (!labelEl || !valueEl) return;
    const isEmpty = isBlank(size.label) && isBlank(size.value);
    let labelMsg: string | null = null;
    let valueMsg: string | null = null;
    if (!isEmpty) {
      labelMsg = find(`size.${inputIndex}.label`);
      valueMsg = unreadable(size.value) ? NUMBER_HINT : find(`size.${inputIndex}.finishedBust`);
      inputIndex += 1;
    }
    const labelShown = labelMsg !== null && touched.has(`size.${i}.label`) && touched.has(`size.${i}.finishedBust`);
    const valueShown = valueMsg !== null && touched.has(`size.${i}.finishedBust`);
    const err = document.getElementById(`size-${i}-error`);
    if (err) {
      const text = [valueShown ? valueMsg : null, labelShown ? labelMsg : null].filter(Boolean).join(' ');
      err.hidden = text === '';
      err.textContent = text;
    }
    labelShown ? labelEl.setAttribute('aria-invalid', 'true') : labelEl.removeAttribute('aria-invalid');
    valueShown ? valueEl.setAttribute('aria-invalid', 'true') : valueEl.removeAttribute('aria-invalid');
  });
}

function missingInputs(): string[] {
  const missing: string[] = [];
  if (isBlank(state.bust)) missing.push('your bust');
  if (isBlank(state.ease)) missing.push('the ease you want');
  if (isBlank(state.patternStitches)) missing.push('the pattern gauge');
  if (isBlank(state.userStitches)) missing.push('your swatch gauge');
  const complete = state.sizes.filter((s) => !isBlank(s.label) && !isBlank(s.value));
  if (complete.length === 0) missing.push('at least one pattern size');
  return missing;
}

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

function markStarted(): void {
  if (!started) {
    started = true;
    track('input_started');
  }
}

function spectrumWidth(): number {
  const sheet = resultsBody.querySelector<HTMLElement>('.spectrum');
  // The spectrum spans the sheet's content box; estimate from the section before first render.
  return sheet ? sheet.clientWidth : Math.max(240, resultsSection.clientWidth - 48);
}

/* Section check marks: purely visual, driven by the same validation. */
function updateStages(errors: InputError[]): void {
  const has = (prefix: string) => errors.some((e) => e.field.startsWith(prefix));
  const filled = (...values: string[]) => values.every((v) => !isBlank(v));
  const complete = state.sizes.filter((s) => !isBlank(s.label) && !isBlank(s.value));
  const done: Record<string, boolean> = {
    'stage-body': filled(state.bust, state.ease) && !has('bust') && !has('desiredEase'),
    'stage-gauge':
      filled(state.patternStitches, state.userStitches) && !has('patternGauge') && !has('userGauge'),
    'stage-sizes': complete.length > 0 && !has('size') && !has('sizes'),
  };
  for (const [id, isDone] of Object.entries(done)) {
    const mark = document.querySelector<HTMLElement>(`#${id} .stage__done`);
    if (mark) mark.hidden = !isDone;
  }
}

function updateSizesNote(duplicates: string[]): void {
  const note = byId('sizes-note');
  note.hidden = duplicates.length === 0;
  note.textContent = duplicates
    .map((label) => `More than one size is named “${label}”. Rename one so the comparison is easy to read.`)
    .join(' ');
}

function shareUrl(): string {
  return `${window.location.origin}${window.location.pathname}#${encodeState(state)}`;
}

function update(): void {
  renderPresets();
  const input = toInput(state);
  const outcome = calculate(input);
  const missing = missingInputs();

  updateStages(outcome.ok ? [] : outcome.errors);
  updateSizesNote(outcome.ok ? outcome.result.duplicateLabels : []);

  if (!outcome.ok) {
    renderErrors(outcome.errors);
    if (missing.length > 0) {
      resultsBody.replaceChildren(renderPlaceholder(missing));
    } else {
      // Everything is filled in: show every problem, not just touched ones.
      for (const e of outcome.errors) touched.add(e.field);
      state.sizes.forEach((_, i) => {
        touched.add(`size.${i}.label`);
        touched.add(`size.${i}.finishedBust`);
      });
      renderErrors(outcome.errors);
      resultsBody.replaceChildren(renderInvalid());
    }
    lastPickKey = '';
    return;
  }

  renderErrors([]);
  const r = outcome.result;
  const pick = r.rows[r.recommendedIndex];
  const pickKey = `${pick?.label}|${r.recommendedIndex}`;
  const isNewPick = pickKey !== lastPickKey;
  const width = spectrumWidth();
  // Read open/closed state straight from the page: the "toggle" event is async and
  // may not have fired yet if the knitter types right after opening a section.
  for (const el of resultsBody.querySelectorAll<HTMLDetailsElement>('details.more')) {
    const id = el.id.replace(/^more-/, '') as DisclosureId;
    if (id in disclosureOpen) disclosureOpen[id] = el.open;
  }
  if (isNewPick && pick) announce.textContent = `Recommended size: ${pick.label}`;
  lastPickKey = pickKey;

  resultsBody.replaceChildren(
    renderResult(r, {
      unit: state.bodyUnit,
      spectrumWidth: width,
      open: disclosureOpen,
      helpful,
      copyState,
      shareUrl: shareUrl(),
      feedbackUrl: FEEDBACK_URL,
      onToggle: (id, open) => {
        disclosureOpen[id] = open;
      },
      onHelpful: (answer) => {
        helpful = answer;
        track(answer === 'yes' ? 'helpful_yes' : 'helpful_no');
        update();
      },
      onCopy: () => void copyLink(),
      onFeedback: () => track('feedback_clicked'),
    }),
  );

  if (!resultTracked) {
    resultTracked = true;
    track('result_shown', buildResultProps(r, state.bodyUnit, state.sizesUnit));
  }
}

async function copyLink(): Promise<void> {
  const url = shareUrl();
  try {
    await navigator.clipboard.writeText(url);
    copyState = 'copied';
  } catch {
    copyState = 'manual';
  }
  track('link_copied');
  update();
  if (copyState === 'manual') {
    const field = document.getElementById('share-url') as HTMLInputElement | null;
    field?.focus();
    field?.select();
  } else {
    resultsBody.querySelector<HTMLButtonElement>('[data-copy]')?.focus();
  }
  window.clearTimeout(copyTimer);
  if (copyState === 'copied') {
    copyTimer = window.setTimeout(() => {
      copyState = 'idle';
      update();
    }, 2500);
  }
}

/* ------------------------------------------------------------------ */
/* Paste                                                               */
/* ------------------------------------------------------------------ */

function renderPastePreview(): void {
  const text = pasteText.value;
  if (isBlank(text)) {
    pasteResult = null;
    pastePreview.replaceChildren();
    pasteUse.disabled = true;
    return;
  }
  pasteResult = parseSizeList(text);
  const { sizes, unit, problems } = pasteResult;
  const unitText = unit ?? state.sizesUnit;
  const found =
    sizes.length > 0
      ? h(
          'div',
          {},
          h('p', { className: 'help' }, `Found ${sizes.length} ${sizes.length === 1 ? 'size' : 'sizes'}${unit ? ` (${unit === 'in' ? 'inches' : 'cm'})` : ''}:`),
          h('ul', {}, ...sizes.map((s) => h('li', {}, `${s.label}: ${s.finishedBust} ${unitText}`))),
        )
      : null;
  pastePreview.replaceChildren(...problems.map((p) => h('p', { className: 'help' }, p)));
  if (found) pastePreview.append(found);
  pasteUse.disabled = sizes.length === 0;
}

function usePaste(): void {
  if (!pasteResult || pasteResult.sizes.length === 0) return;
  state.sizes = pasteResult.sizes.map((s) => ({ label: s.label, value: String(s.finishedBust) }));
  if (pasteResult.unit) state.sizesUnit = pasteResult.unit;
  radio('sizesUnit').value = state.sizesUnit;
  for (const key of [...touched]) if (key.startsWith('size.')) touched.delete(key);
  state.sizes.forEach((_, i) => {
    touched.add(`size.${i}.label`);
    touched.add(`size.${i}.finishedBust`);
  });
  track('paste_used');
  closePaste();
  renderSizeRows(0);
  syncUnits();
  markStarted();
  update();
}

function openPaste(): void {
  pastePanel.hidden = false;
  pasteToggle.setAttribute('aria-expanded', 'true');
  pasteText.focus();
}

function closePaste(): void {
  pastePanel.hidden = true;
  pasteToggle.setAttribute('aria-expanded', 'false');
  pasteText.value = '';
  renderPastePreview();
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function bindText(input: HTMLInputElement, key: 'bust' | 'ease' | 'patternStitches' | 'userStitches', field: string): void {
  input.addEventListener('input', () => {
    state[key] = input.value;
    touched.add(field);
    markStarted();
    update();
  });
}

bindText(bustInput, 'bust', 'bust');
bindText(easeInput, 'ease', 'desiredEase');
bindText(patternInput, 'patternStitches', 'patternGauge');
bindText(userInput, 'userStitches', 'userGauge');

form.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.type !== 'radio') return;
  switch (target.name) {
    case 'bodyUnit':
      state.bodyUnit = target.value as LengthUnit;
      break;
    case 'sizesUnit':
      state.sizesUnit = target.value as LengthUnit;
      break;
    case 'patternOver':
      state.patternOver = target.value as GaugeSpan;
      break;
    case 'userOver':
      state.userOver = target.value as GaugeSpan;
      break;
    default:
      return;
  }
  syncUnits();
  for (const el of sizesEl.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]')) {
    el.setAttribute('aria-label', el.getAttribute('aria-label')?.replace(/(cm|in)$/, state.sizesUnit) ?? '');
  }
  update();
});

form.addEventListener('submit', (event) => event.preventDefault());

addSizeBtn.addEventListener('click', () => {
  if (state.sizes.length >= LIMITS.sizes.max) return;
  state.sizes.push({ label: '', value: '' });
  renderSizeRows(state.sizes.length - 1);
  update();
});

pasteToggle.addEventListener('click', () => (pastePanel.hidden ? openPaste() : closePaste()));
pasteText.addEventListener('input', renderPastePreview);
pasteUse.addEventListener('click', usePaste);
byId('paste-cancel').addEventListener('click', () => {
  closePaste();
  pasteToggle.focus();
});

byId('example').addEventListener('click', () => {
  state = exampleState();
  touched.clear();
  syncFormFromState();
  track('example_loaded');
  update();
  resultsSection.focus({ preventScroll: true });
  if (!isWide()) resultsSection.scrollIntoView({ block: 'start' });
});

let resizeFrame = 0;
let lastWidth = resultsSection.clientWidth;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    const width = resultsSection.clientWidth;
    if (width === lastWidth) return;
    lastWidth = width;
    if (resultsBody.querySelector('.spectrum')) update();
  });
}).observe(resultsSection);

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

setupAnalytics();
setupWaitlist();
syncFormFromState();
if (fromLink) {
  // Shared links arrive filled in, so show any problems straight away.
  touched.add('bust').add('desiredEase').add('patternGauge').add('userGauge').add('sizes');
  state.sizes.forEach((_, i) => {
    touched.add(`size.${i}.label`);
    touched.add(`size.${i}.finishedBust`);
  });
}
update();
