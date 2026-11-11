import { businessTexts, itemGroups, type BusinessSpec } from './business.js';
import { quotable, techIdIssue } from './plain-text.js';
import { formatPath } from './shared.js';

/** A box on the tech map: a node of a map, or a step of a flow. */
export interface TechBox {
  id: string;
  label: string;
}

/** Links that name no box of the tech map, and tech map ids copied into the plain words. */
export function businessLinkIssues(spec: BusinessSpec, boxes: readonly TechBox[]): string[] {
  const ids = new Set(boxes.map((b) => b.id));
  const issues: string[] = [];
  for (const [group, items] of itemGroups(spec)) {
    items.forEach((item, i) =>
      item.links.forEach((link, j) => {
        if (!ids.has(link)) issues.push(`${formatPath(group === 'flow' ? ['flow', 'steps', i, 'links', j] : [group, i, 'links', j])}: "${quotable(link)}" is not a box on the tech map`);
      }),
    );
  }
  const all = [...ids];
  for (const t of businessTexts(spec)) {
    const id = techIdIssue(t.text, all);
    if (id) issues.push(`${formatPath(t.path)}: names a box of the tech map ("${id}"); write it in plain words`);
  }
  return issues;
}
