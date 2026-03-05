import { visitAll, type SolidityAST } from './parser.js';
import type { AbiItem, DetectedPattern, PatternKind } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ASTNode = Record<string, any>;

/* ================================================================
   detectPatterns – rule-based pattern detection from AST / ABI / text
   ================================================================ */
export function detectPatterns(
  ast: SolidityAST | null,
  abi?: AbiItem[],
  description?: string,
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  if (ast) {
    patterns.push(...detectFromAST(ast));
  }
  if (abi && abi.length > 0) {
    patterns.push(...detectFromABI(abi));
  }
  if (description) {
    patterns.push(...detectFromDescription(description));
  }

  return deduplicatePatterns(patterns);
}

/* ── AST-based detection ─────────────────────────────────────── */

function detectFromAST(ast: SolidityAST): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  const stateVars: ASTNode[] = [];
  const functions: ASTNode[] = [];
  const events: ASTNode[] = [];
  const modifiers: ASTNode[] = [];
  const mappings: ASTNode[] = [];

  visitAll(ast as ASTNode, (node) => {
    if (node.type === 'StateVariableDeclaration') stateVars.push(node);
    if (node.type === 'FunctionDefinition') functions.push(node);
    if (node.type === 'EventDefinition') events.push(node);
    if (node.type === 'ModifierDefinition') modifiers.push(node);
    if (node.type === 'Mapping') mappings.push(node);
  });

  // Collect variable names for heuristics
  const varNames = stateVars
    .flatMap((sv) => (sv.variables ?? []).map((v: ASTNode) => v.name ?? ''))
    .filter(Boolean);
  const fnNames = functions.map((f) => f.name ?? '').filter(Boolean);
  const eventNames = events.map((e) => e.name ?? '').filter(Boolean);
  const modNames = modifiers.map((m) => m.name ?? '').filter(Boolean);

  // ── ERC20 ──
  if (detectERC20(varNames, fnNames, eventNames, mappings)) {
    patterns.push({
      kind: 'ERC20',
      confidence: 0.9,
      details: 'Detected ERC20-like token pattern: balances mapping, transfer/approve functions.',
      sourceHints: filterMatches(
        [...varNames, ...fnNames, ...eventNames],
        ['balance', 'totalSupply', 'transfer', 'approve', 'allowance', 'Transfer', 'Approval'],
      ),
    });
  }

  // ── Ownable ──
  if (detectOwnable(varNames, modNames, fnNames)) {
    patterns.push({
      kind: 'Ownable',
      confidence: 0.85,
      details: 'Detected Ownable pattern: owner state variable and onlyOwner modifier/check.',
      sourceHints: filterMatches([...varNames, ...modNames], ['owner', 'onlyOwner']),
    });
  }

  // ── Pausable ──
  if (detectPausable(varNames, fnNames, modNames)) {
    patterns.push({
      kind: 'Pausable',
      confidence: 0.8,
      details: 'Detected Pausable pattern: paused state, pause/unpause functions.',
      sourceHints: filterMatches(
        [...varNames, ...fnNames, ...modNames],
        ['paused', 'pause', 'unpause', 'whenNotPaused'],
      ),
    });
  }

  // ── Escrow ──
  if (detectEscrow(fnNames, varNames)) {
    patterns.push({
      kind: 'Escrow',
      confidence: 0.85,
      details: 'Detected Escrow pattern: deposit/withdraw/release/refund functions.',
      sourceHints: filterMatches(fnNames, ['deposit', 'withdraw', 'release', 'refund']),
    });
  }

  // ── Lending ──
  if (detectLending(fnNames, varNames)) {
    patterns.push({
      kind: 'Lending',
      confidence: 0.75,
      details: 'Detected Lending pattern: collateral/borrow/repay/liquidate functions.',
      sourceHints: filterMatches(
        [...fnNames, ...varNames],
        ['collateral', 'borrow', 'repay', 'liquidate', 'loan'],
      ),
    });
  }

  // ── Proxy / Upgradeability ──
  if (detectProxy(ast)) {
    patterns.push({
      kind: 'Proxy',
      confidence: 0.7,
      details: 'Detected Proxy/Upgradeability pattern: delegatecall usage or proxy naming.',
      sourceHints: ['delegatecall', 'proxy', 'implementation'],
    });
  }

  // ── Events ──
  if (eventNames.length > 0) {
    patterns.push({
      kind: 'Events',
      confidence: 0.95,
      details: `Detected ${eventNames.length} event(s): ${eventNames.join(', ')}.`,
      sourceHints: eventNames,
    });
  }

  return patterns;
}

/* ── ABI-based detection ─────────────────────────────────────── */

function detectFromABI(abi: AbiItem[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const fnNames = abi.filter((a) => a.type === 'function').map((a) => a.name ?? '');
  const eventNames = abi.filter((a) => a.type === 'event').map((a) => a.name ?? '');

  if (
    fnNames.some((n) => /transfer/i.test(n)) &&
    fnNames.some((n) => /approve/i.test(n)) &&
    fnNames.some((n) => /balance/i.test(n))
  ) {
    patterns.push({
      kind: 'ERC20',
      confidence: 0.8,
      details: 'Detected ERC20-like pattern from ABI function signatures.',
      sourceHints: fnNames.filter((n) => /transfer|approve|balance/i.test(n)),
    });
  }

  if (fnNames.some((n) => /deposit/i.test(n)) && fnNames.some((n) => /withdraw|release/i.test(n))) {
    patterns.push({
      kind: 'Escrow',
      confidence: 0.7,
      details: 'Detected Escrow-like pattern from ABI.',
      sourceHints: fnNames.filter((n) => /deposit|withdraw|release|refund/i.test(n)),
    });
  }

  if (eventNames.length > 0) {
    patterns.push({
      kind: 'Events',
      confidence: 0.9,
      details: `Detected ${eventNames.length} event(s) from ABI.`,
      sourceHints: eventNames,
    });
  }

  return patterns;
}

/* ── Text description detection ──────────────────────────────── */

function detectFromDescription(desc: string): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const lower = desc.toLowerCase();

  const textRules: { re: RegExp; kind: PatternKind; details: string }[] = [
    { re: /erc-?20|fungible token/i, kind: 'ERC20', details: 'Description mentions ERC20/fungible token.' },
    { re: /escrow/i, kind: 'Escrow', details: 'Description mentions escrow.' },
    { re: /lend|borrow|collateral|liquidat/i, kind: 'Lending', details: 'Description mentions lending concepts.' },
    { re: /owner|admin|access control/i, kind: 'Ownable', details: 'Description mentions ownership/access control.' },
    { re: /pausab|pause|emergency stop/i, kind: 'Pausable', details: 'Description mentions pausability.' },
    { re: /upgrad|proxy|delegatecall/i, kind: 'Proxy', details: 'Description mentions upgradeability/proxy.' },
  ];

  for (const rule of textRules) {
    if (rule.re.test(lower)) {
      patterns.push({
        kind: rule.kind,
        confidence: 0.5,
        details: rule.details,
        sourceHints: [],
      });
    }
  }

  return patterns;
}

/* ── Individual pattern detectors ────────────────────────────── */

function detectERC20(
  varNames: string[],
  fnNames: string[],
  eventNames: string[],
  _mappings: ASTNode[],
): boolean {
  const hasBalances = varNames.some((v) => /balance/i.test(v));
  const hasTransfer = fnNames.some((f) => /^transfer$/i.test(f));
  const hasApprove = fnNames.some((f) => /^approve$/i.test(f));
  const hasTransferEvent = eventNames.some((e) => /^Transfer$/i.test(e));
  // At least 2 of these indicators
  return [hasBalances, hasTransfer, hasApprove, hasTransferEvent].filter(Boolean).length >= 2;
}

function detectOwnable(varNames: string[], modNames: string[], fnNames: string[]): boolean {
  const hasOwner = varNames.some((v) => /^owner$/i.test(v));
  const hasModifier = modNames.some((m) => /onlyOwner/i.test(m));
  const hasTransferOwnership = fnNames.some((f) => /transferOwnership/i.test(f));
  return hasOwner && (hasModifier || hasTransferOwnership);
}

function detectPausable(varNames: string[], fnNames: string[], modNames: string[]): boolean {
  const hasPaused = varNames.some((v) => /^paused$/i.test(v));
  const hasPauseFn = fnNames.some((f) => /^pause$/i.test(f) || /^unpause$/i.test(f));
  const hasMod = modNames.some((m) => /whenNotPaused/i.test(m));
  return (hasPaused && hasPauseFn) || hasMod;
}

function detectEscrow(fnNames: string[], _varNames: string[]): boolean {
  const hasDeposit = fnNames.some((f) => /deposit/i.test(f));
  const hasRelease = fnNames.some((f) => /release|withdraw/i.test(f));
  const hasRefund = fnNames.some((f) => /refund/i.test(f));
  return hasDeposit && (hasRelease || hasRefund);
}

function detectLending(fnNames: string[], varNames: string[]): boolean {
  const terms = [...fnNames, ...varNames];
  const hasBorrow = terms.some((t) => /borrow/i.test(t));
  const hasRepay = terms.some((t) => /repay/i.test(t));
  const hasCollateral = terms.some((t) => /collateral/i.test(t));
  const hasLiquidate = terms.some((t) => /liquidat/i.test(t));
  return [hasBorrow, hasRepay, hasCollateral, hasLiquidate].filter(Boolean).length >= 2;
}

function detectProxy(ast: SolidityAST): boolean {
  let found = false;
  visitAll(ast as ASTNode, (node) => {
    // Check for delegatecall
    if (
      node.type === 'FunctionCall' &&
      node.expression?.memberName === 'delegatecall'
    ) {
      found = true;
    }
    // Check contract name contains Proxy
    if (node.type === 'ContractDefinition' && /proxy/i.test(node.name ?? '')) {
      found = true;
    }
  });
  return found;
}

/* ── Helpers ─────────────────────────────────────────────────── */

function filterMatches(names: string[], keywords: string[]): string[] {
  const lower = keywords.map((k) => k.toLowerCase());
  return names.filter((n) => lower.some((k) => n.toLowerCase().includes(k)));
}

function deduplicatePatterns(patterns: DetectedPattern[]): DetectedPattern[] {
  const map = new Map<PatternKind, DetectedPattern>();
  for (const p of patterns) {
    const existing = map.get(p.kind);
    if (!existing || existing.confidence < p.confidence) {
      map.set(p.kind, p);
    }
  }
  return Array.from(map.values());
}
