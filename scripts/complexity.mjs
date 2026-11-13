// Closure-aware cyclomatic complexity: a function's own CC plus the CC of every closure nested in it.
// ESLint's `complexity` rule stops at the closure boundary, so logic hidden in callbacks that mutate
// shared locals goes unseen. Usage: node scripts/complexity.mjs [--top N]
//
// Allowlist (may only shrink): put `// complexity-ratchet: <max> -- <reason>` in the comment block directly above the function.
// Only outermost functions are judged (their total already includes their closures). The function may not exceed <max>; once it fits LIMIT the entry is stale and must be removed.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const LIMIT = 30;
const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const topArg = process.argv.indexOf('--top');
const top = topArg > 0 ? Number(process.argv[topArg + 1]) : 0;

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );

const isFn = (n) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessor(n) ||
  ts.isSetAccessor(n);

const LOGICAL = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

const weight = (n) => {
  if (
    ts.isIfStatement(n) ||
    ts.isConditionalExpression(n) ||
    ts.isForStatement(n) ||
    ts.isForInStatement(n) ||
    ts.isForOfStatement(n) ||
    ts.isWhileStatement(n) ||
    ts.isDoStatement(n) ||
    ts.isCatchClause(n) ||
    ts.isCaseClause(n)
  )
    return 1;
  return ts.isBinaryExpression(n) && LOGICAL.has(n.operatorToken.kind) ? 1 : 0;
};

const fnName = (n) => {
  if (n.name && ts.isIdentifier(n.name)) return n.name.text;
  const p = n.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) return `${p.expression.name.text}(λ)`;
  return 'λ';
};

function measure(sf) {
  const out = [];
  const visit = (node, outer = false) => {
    let own = 1;
    let incl = 1;
    const walk = (n) => {
      if (isFn(n)) {
        incl += visit(n);
        return;
      }
      const w = weight(n);
      own += w;
      incl += w;
      ts.forEachChild(n, walk);
    };
    ts.forEachChild(node, walk);
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push({ line: line + 1, name: fnName(node), own, incl, outer });
    return incl;
  };
  const find = (n) => {
    if (isFn(n)) visit(n, true);
    else ts.forEachChild(n, find);
  };
  find(sf);
  return out;
}

const all = [];
const problems = [];
const ratcheted = [];
for (const file of files(join(root, 'src'))) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  for (const fn of measure(sf)) {
    if (!fn.outer) {
      all.push({ ...fn, file: relative(root, file) });
      continue;
    }
    const rel = relative(root, file);
    all.push({ ...fn, file: rel });
    let m = null;
    for (let i = fn.line - 2; i >= 0 && /^\s*\/\//.test(lines[i]) && !m; i--) m = /^\s*\/\/ complexity-ratchet: (\d+) -- \S/.exec(lines[i]);
    const where = `${rel}:${fn.line} ${fn.name}`;
    if (m) {
      ratcheted.push({ file: rel, name: fn.name, incl: fn.incl });
      all[all.length - 1].ratchet = true;
      const cap = Number(m[1]);
      if (fn.incl > cap) problems.push(`${where}: complexity ${fn.incl} exceeds ratchet ${cap}`);
      else if (fn.incl <= LIMIT) problems.push(`${where}: complexity ${fn.incl} fits ${LIMIT}; remove the ratchet entry`);
      else if (fn.incl < cap) problems.push(`${where}: complexity ${fn.incl} < ratchet ${cap}; lower the entry`);
    } else if (fn.incl > LIMIT) problems.push(`${where}: complexity ${fn.incl} (own ${fn.own}) exceeds ${LIMIT}`);
  }
}

all.sort((a, b) => b.incl - a.incl);
if (top) for (const f of all.slice(0, top)) console.log(`${f.incl}\town ${f.own}\t${f.file}:${f.line} ${f.name}`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
if (!top) {
  const within = Math.max(0, ...all.filter((f) => f.outer && !f.ratchet).map((f) => f.incl));
  const entries = ratcheted.map((r) => `${basename(r.file)} ${r.name} ${r.incl}`);
  console.log(
    entries.length
      ? `complexity ok (max ${within} of limit ${LIMIT}; ${entries.length} ratchet ${entries.length === 1 ? 'entry' : 'entries'}: ${entries.join(', ')})`
      : `complexity ok (max ${all[0]?.incl}, limit ${LIMIT})`,
  );
}
