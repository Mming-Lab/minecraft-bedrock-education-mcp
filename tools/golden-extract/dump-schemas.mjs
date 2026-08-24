// Records the MCP tool surface as it stands today: every tool's name, description and
// inputSchema, plus the action enum each one dispatches on.
//
// The tool classes cannot simply be imported - they extend BaseTool, which pulls in
// socket-be, which is not installed. But `name`, `description` and `inputSchema` are static
// class fields initialised with literals, so they can be read straight off the syntax tree
// without executing anything.
//
//   node dump-schemas.mjs
//
// Output: tests/golden/schemas/current-tools.json and a summary of description/implementation
// mismatches, which is the point of the exercise: several descriptions advertise actions the
// enum does not contain, and the LLM reads those descriptions.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', '..', 'src');
const OUT = path.join(HERE, '..', '..', 'tests', 'golden', 'schemas');

// --- collect the tool source files -------------------------------------------------------
function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

const toolFiles = walk(path.join(SRC, 'tools')).filter((f) => !f.endsWith(path.join('base', 'tool.ts')));

// --- turn a literal initializer into a plain value -----------------------------------------
// Anything that is not a literal (a call, an identifier, a template with substitutions)
// is recorded as a marker rather than guessed at, so the dump never invents a value.
function literalToValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = literalToValue(node.operand);
    return typeof inner === 'number' ? -inner : { __unsupported: node.getText() };
  }

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map(literalToValue);
  }

  if (ts.isObjectLiteralExpression(node)) {
    const out = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        out.__unsupported = (out.__unsupported ?? []).concat(prop.getText());
        continue;
      }
      const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
        ? prop.name.text
        : prop.name.getText();
      out[key] = literalToValue(prop.initializer);
    }
    return out;
  }

  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return literalToValue(node.expression);
  }

  return { __unsupported: node.getText().slice(0, 120) };
}

// --- extract ---------------------------------------------------------------------------------
const tools = [];

for (const file of toolFiles) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2020, true);

  ts.forEachChild(source, (node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return;

    const tool = {
      class: node.name.text,
      file: path.relative(path.join(HERE, '..', '..'), file).split(path.sep).join('/'),
      name: null,
      description: null,
      inputSchema: null,
    };

    for (const member of node.members) {
      if (!ts.isPropertyDeclaration(member) || !member.initializer || !member.name) continue;
      const key = member.name.getText();
      if (key === 'name') tool.name = literalToValue(member.initializer);
      else if (key === 'description') tool.description = literalToValue(member.initializer);
      else if (key === 'inputSchema') tool.inputSchema = literalToValue(member.initializer);
    }

    if (tool.name && tool.inputSchema) tools.push(tool);
  });
}

tools.sort((a, b) => String(a.name).localeCompare(String(b.name)));

// --- cross-check descriptions against the action enum ---------------------------------------
// The description is what the model reads when deciding what to call. Where it names an
// action the enum does not contain, the model will construct calls that cannot succeed.
const mismatches = [];

for (const tool of tools) {
  const actionProp = tool.inputSchema?.properties?.action;
  const actions = Array.isArray(actionProp?.enum) ? actionProp.enum : null;
  tool.actions = actions;

  if (!actions || typeof tool.description !== 'string') continue;

  // The descriptions follow an `action_name(hint)` shape, so the token immediately before
  // an opening parenthesis is the part being presented as an action. The contents of the
  // parenthesis are argument values, not actions, and scanning them produced only noise
  // (`peaceful`/`easy` from `set_difficulty(peaceful/easy/...)`, `forward`/`back` from the
  // agent's direction hints).
  const candidates = new Set();
  for (const m of tool.description.matchAll(/\b([a-z][a-z_]{2,})\s*\(/g)) candidates.add(m[1]);

  const known = new Set(actions.map(String));
  const toolNames = new Set(tools.map((t) => String(t.name)));
  const paramNames = new Set(Object.keys(tool.inputSchema?.properties ?? {}));
  // Actions are snake_case identifiers. A bare English word before a parenthesis is prose
  // ("building(cube/sphere)"), so require the underscore that every real action carries.
  const unknown = [...candidates].filter(
    (c) => c.includes('_') && !known.has(c) && !toolNames.has(c) && !paramNames.has(c)
  );

  // The reverse direction matters just as much: an action the description never mentions is
  // one the model has no reason to try.
  const unmentioned = [...known].filter((a) => !tool.description.includes(a));

  if (unknown.length || unmentioned.length) {
    mismatches.push({ tool: tool.name, advertised: unknown, unmentioned, actual: [...known] });
  }
}

// --- cross-tool references in the sequence tool ------------------------------------------------
// `sequence` advertises actions belonging to other tools, e.g. "player(teleport/move/say)".
// Those names are checked against the referenced tool's own enum.
const crossToolProblems = [];
const sequenceTool = tools.find((t) => t.name === 'sequence');
if (sequenceTool && typeof sequenceTool.description === 'string') {
  const byName = new Map(tools.map((t) => [String(t.name), t]));
  for (const m of sequenceTool.description.matchAll(/\b([a-z_]+)\(([a-z_/\s]+)\)/g)) {
    const referenced = byName.get(m[1]);
    if (!referenced) continue;
    const theirActions = new Set((referenced.actions ?? []).map(String));
    const claimed = m[2].split('/').map((s) => s.trim()).filter(Boolean);
    const missing = claimed.filter((c) => !theirActions.has(c));
    if (missing.length) {
      crossToolProblems.push({ referenced: m[1], claimed, missing, actual: [...theirActions] });
    }
  }
}

// --- write -------------------------------------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, 'current-tools.json'),
  JSON.stringify({ extractedAt: 'static AST read of src/tools', toolCount: tools.length, tools }, null, 2) + '\n',
  'utf8'
);

const lines = [];
lines.push('# Current MCP tool surface');
lines.push('');
lines.push('Read statically from `src/tools` — the classes cannot be imported because');
lines.push('`BaseTool` depends on socket-be, which is not installed.');
lines.push('');
lines.push(`**${tools.length} tools.**`);
lines.push('');
lines.push('| tool | actions | parameters | description length |');
lines.push('|---|---|---|---|');
for (const t of tools) {
  const params = Object.keys(t.inputSchema?.properties ?? {});
  lines.push(
    `| \`${t.name}\` | ${t.actions ? t.actions.length : '-'} | ${params.length} (${params.join(', ')}) | ${String(t.description ?? '').length} |`
  );
}
lines.push('');
lines.push('## Actions named in a description but absent from the enum');
lines.push('');
lines.push('The description is what the model reads when choosing a call. Where it advertises');
lines.push('an action the enum does not contain, the model will build calls that cannot succeed.');
lines.push('');
const advertisedProblems = mismatches.filter((m) => m.advertised.length);
if (advertisedProblems.length === 0) {
  lines.push('None found.');
} else {
  lines.push('| tool | advertised but missing | actual enum |');
  lines.push('|---|---|---|');
  for (const m of advertisedProblems) {
    lines.push(`| \`${m.tool}\` | ${m.advertised.map((a) => `\`${a}\``).join(', ')} | ${m.actual.map((a) => `\`${a}\``).join(', ')} |`);
  }
}
lines.push('');

lines.push('## Actions that exist but the description never mentions');
lines.push('');
lines.push('The reverse gap. An action the description does not name is one the model has no');
lines.push('reason to try, so it is effectively unavailable however well it is implemented.');
lines.push('');
const unmentionedProblems = mismatches.filter((m) => m.unmentioned.length);
if (unmentionedProblems.length === 0) {
  lines.push('None found.');
} else {
  lines.push('| tool | mentioned | unmentioned |');
  lines.push('|---|---|---|');
  for (const m of unmentionedProblems) {
    const mentioned = m.actual.length - m.unmentioned.length;
    lines.push(`| \`${m.tool}\` | ${mentioned}/${m.actual.length} | ${m.unmentioned.map((a) => `\`${a}\``).join(', ')} |`);
  }
}
lines.push('');

lines.push('## Cross-tool references in `sequence`');
lines.push('');
lines.push('`sequence` advertises actions belonging to other tools. These are checked against');
lines.push("the referenced tool's own enum.");
lines.push('');
if (crossToolProblems.length === 0) {
  lines.push('None found.');
} else {
  lines.push('| referenced tool | claimed by `sequence` | absent from that tool |');
  lines.push('|---|---|---|');
  for (const c of crossToolProblems) {
    lines.push(`| \`${c.referenced}\` | ${c.claimed.map((a) => `\`${a}\``).join(', ')} | ${c.missing.map((a) => `\`${a}\``).join(', ')} |`);
  }
}
lines.push('');

// --- schema shape audit -------------------------------------------------------------------------
// `steps` arrays declared without `items` become z.array(z.any()) in the converter, which
// drops every constraint inside them.
const untypedArrays = [];
for (const t of tools) {
  for (const [key, prop] of Object.entries(t.inputSchema?.properties ?? {})) {
    if (prop && prop.type === 'array' && !prop.items) {
      untypedArrays.push({ tool: t.name, param: key });
    }
  }
}
lines.push('## Array parameters declared without `items`');
lines.push('');
lines.push('`schema-converter.ts` turns these into `z.array(z.any())`, so nothing inside them');
lines.push('is validated — enum, minimum and maximum on the step fields all stop applying.');
lines.push('');
if (untypedArrays.length === 0) {
  lines.push('None found.');
} else {
  lines.push('| tool | parameter |');
  lines.push('|---|---|');
  for (const u of untypedArrays) lines.push(`| \`${u.tool}\` | \`${u.param}\` |`);
}
lines.push('');

fs.writeFileSync(path.join(OUT, 'REPORT.md'), lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
