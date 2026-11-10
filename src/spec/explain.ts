type Issue = (path: (string | number)[], message: string) => void;

interface ExplainInput {
  kind: string;
  nodes: { status: string; path?: string; fields?: { change?: unknown }[] }[];
  omitted?: unknown;
}

const AREA = ['existing', 'outside'];

/** An explain map draws code as it is: only `existing` and `outside` boxes, no change marks, no plan-or-summary extras; those two statuses are for nothing else. */
export function explainIssues(spec: ExplainInput, issue: Issue): void {
  if (spec.kind !== 'explain') {
    spec.nodes.forEach((n, i) => {
      if (AREA.includes(n.status)) issue(['nodes', i, 'status'], `"${n.status}" is only for a map with "kind": "explain"`);
    });
    return;
  }
  spec.nodes.forEach((n, i) => {
    if (!AREA.includes(n.status)) issue(['nodes', i, 'status'], `an explain map uses "existing" or "outside", not "${n.status}"`);
    if (n.status === 'existing' && n.path === undefined) issue(['nodes', i, 'path'], 'required for "existing": the file the box is in');
    n.fields?.forEach((f, j) => {
      if (f.change !== undefined) issue(['nodes', i, 'fields', j, 'change'], 'not in an explain map: nothing changed');
    });
  });
  if (spec.omitted !== undefined) issue(['omitted'], 'not in an explain map: there is no diff to leave files out of');
}
