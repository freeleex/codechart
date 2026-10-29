import { flat } from './wrap.js';
import type { NodeKind, SpecNode, Status } from '../../spec/schema.js';

const MARKER: Record<Status, string> = { new: '+', changed: '~', removed: '-', context: '·', config: '◆' };
const SGR: Record<Status, string> = { new: '32', changed: '33', removed: '31', context: '2', config: '36' };

export const marker = (status: Status): string => MARKER[status];

export const plainLabel = (node: SpecNode): string => marker(node.status) + flat(node.label);

export const paint = (node: SpecNode, text: string): string =>
  text ? `\u001b[${SGR[node.status]}m${text}\u001b[0m` : text;

// Tables and files are the default reading; the config marker already says config.
const KINDLESS: ReadonlySet<NodeKind> = new Set(['table', 'file', 'other', 'config']);

export const targetLabel = (node: SpecNode): string =>
  KINDLESS.has(node.kind) ? plainLabel(node) : `${marker(node.status)}${node.kind} ${flat(node.label)}`;
