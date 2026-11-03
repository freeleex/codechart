import type { CheckSummary } from './check-lines.js';
import type { Cuts } from './wrap.js';

/** What every terminal drawing function needs: the room, the paint, where cuts are noted, what to link and check. */
export interface TermCtx {
  width: number;
  color: boolean;
  cuts: Cuts;
  htmlPath?: string;
  check?: CheckSummary;
}
