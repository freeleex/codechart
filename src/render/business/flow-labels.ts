import type { Arrow } from './flow-arrows.js';

const CHAR = 7.2;
const ASCENT = 10;
const HEIGHT = 14;

export interface Label {
  text: string;
  /** Where the text starts (its baseline). */
  at: { x: number; y: number };
  /** The room the text takes. */
  box: { x: number; y: number; w: number; h: number };
  lane: number;
}

/** Room above or below a step for a label on its top or bottom exit. */
export const LABEL_ROOM = 44;

const width = (text: string): number => Math.ceil(text.length * CHAR) + 2;
const gap = (e: Arrow): number => (e.port === 'top' || e.port === 'bottom' ? 8 : 6);

/** How far a label sticks out past the right edge of its column (a bit less if the exit is inside it), so the gap can be made wide enough. */
export function labelReach(e: Arrow, columnWidth: number): number {
  if (e.label === undefined) return 0;
  const exit = e.port === 'right' ? e.a.node.w / 2 : e.port === 'upper' || e.port === 'lower' ? e.a.node.w / 4 : 0;
  return exit - columnWidth / 2 + gap(e) + width(e.label) + 6;
}

/** The label of an answer, beside its exit: above the line it leaves on when it goes up, below it when it goes down. */
export function labelOf(e: Arrow, start: { x: number; y: number }, y: number): Label | undefined {
  if (e.label === undefined) return undefined;
  const up = e.port === 'top' || e.port === 'upper' || (e.port === 'right' && e.below);
  const baseline = y + (up ? -6 : 17);
  const x = start.x + gap(e);
  return { text: e.label, at: { x, y: baseline }, box: { x, y: baseline - ASCENT, w: width(e.label), h: HEIGHT }, lane: e.a.node.lane };
}
