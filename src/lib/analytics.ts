import type { FitCheckResult, GaugeWarning } from './fitcheck';
import type { LengthUnit } from './units';

/**
 * Analytics never receives measurements, gauges, size labels, or any other
 * value the knitter typed. Only the fixed event names and category values
 * below can be sent.
 */
export type EventName =
  | 'input_started'
  | 'example_loaded'
  | 'result_shown'
  | 'paste_used'
  | 'link_copied'
  | 'helpful_yes'
  | 'helpful_no'
  | 'waitlist_clicked'
  | 'feedback_clicked';

export interface ResultProps {
  units: 'cm' | 'in' | 'mixed';
  sizes: '1' | '2-4' | '5-8' | '9+';
  gauge: GaugeWarning;
  shift: '0' | '1' | '2+';
}

export const ALLOWED_PROP_VALUES: { [K in keyof ResultProps]: readonly ResultProps[K][] } = {
  units: ['cm', 'in', 'mixed'],
  sizes: ['1', '2-4', '5-8', '9+'],
  gauge: ['none', 'caution', 'strong', 'check-inputs'],
  shift: ['0', '1', '2+'],
};

export function sizesBucket(count: number): ResultProps['sizes'] {
  if (count <= 1) return '1';
  if (count <= 4) return '2-4';
  if (count <= 8) return '5-8';
  return '9+';
}

export function buildResultProps(
  result: FitCheckResult,
  bodyUnit: LengthUnit,
  sizesUnit: LengthUnit,
): ResultProps {
  return {
    units: bodyUnit === sizesUnit ? bodyUnit : 'mixed',
    sizes: sizesBucket(result.rows.length),
    gauge: result.gaugeWarning,
    shift: result.sizeShift === 0 ? '0' : result.sizeShift === 1 ? '1' : '2+',
  };
}

export function isAllowedProps(props: Record<string, unknown>): boolean {
  return Object.entries(props).every(([key, value]) => {
    const allowed = (ALLOWED_PROP_VALUES as Record<string, readonly string[]>)[key];
    return allowed !== undefined && typeof value === 'string' && allowed.includes(value);
  });
}

type Sender = (name: EventName, props?: ResultProps) => void;

declare global {
  interface Window {
    plausible?: (name: string, options?: { props?: Record<string, string> }) => void;
  }
}

const defaultSender: Sender = (name, props) => {
  if (typeof window === 'undefined' || typeof window.plausible !== 'function') return;
  window.plausible(name, props ? { props: { ...props } } : undefined);
};

let sender: Sender = defaultSender;

/** For tests. */
export function setSender(next: Sender | null): void {
  sender = next ?? defaultSender;
}

export function track(name: EventName, props?: ResultProps): void {
  if (props && !isAllowedProps(props as unknown as Record<string, unknown>)) return;
  try {
    sender(name, props);
  } catch {
    // Analytics must never break the calculator.
  }
}
