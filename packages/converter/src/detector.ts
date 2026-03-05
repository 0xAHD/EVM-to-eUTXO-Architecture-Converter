import { visitAll, type SolidityAST } from './parser.js'
import type { AbiItem, DetectedPattern, PatternKind } from './types.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ASTNode = Record<string, any>

type Features = {
  contracts: string[]
  varNames: string[]
  fnNames: string[]
  eventNames: string[]
  modNames: string[]
  enumNames: string[]
  enumMembers: string[]
  structNames: string[]
  mappingCount: number
  functionCount: number
  eventCount: number
  modifierCount: number
  usesTransferFrom: boolean
  usesTransfer: boolean
  usesDelegatecall: boolean
  hasProxyName: boolean
  hasRequire: boolean
  hasRevert: boolean
  // keyword bag (lowercased) used by multiple detectors
  terms: string[]
}

export function detectPatterns(
  ast: SolidityAST | null,
  abi?: AbiItem[],
  description?: string,
): DetectedPattern[] {
  const patterns: DetectedPattern[] = []

  // 1) Extract features
  const features: Features | null = ast ? extractFeaturesFromAST(ast) : null

  // 2) Detect patterns from AST features
  if (features) patterns.push(...detectFromFeatures(features))

  // 3) ABI (fallback / augment)
  if (abi && abi.length > 0) patterns.push(...detectFromABI(abi))

  // 4) Description (weak signal)
  if (description) patterns.push(...detectFromDescription(description))

  // 5) If nothing detected, produce a safe fallback so UI never feels “broken”
  if (patterns.length === 0) {
    patterns.push({
      kind: 'Proxy', // pick the least-wrong bucket if your PatternKind is limited
      confidence: 0.2,
      details:
        'No known pattern confidently detected. Contract may be custom/complex. Treat as custom state-machine and design eUTXO flows manually.',
      sourceHints: [],
    })
  }

  return deduplicatePatterns(patterns)
}

/* ============================================================
   Feature extraction (robust across multi-contract files)
   ============================================================ */

function extractFeaturesFromAST(ast: SolidityAST): Features {
  const contracts: string[] = []
  const varNames: string[] = []
  const fnNames: string[] = []
  const eventNames: string[] = []
  const modNames: string[] = []
  const enumNames: string[] = []
  const enumMembers: string[] = []
  const structNames: string[] = []
  let mappingCount = 0
  let functionCount = 0
  let eventCount = 0
  let modifierCount = 0

  let usesTransferFrom = false
  let usesTransfer = false
  let usesDelegatecall = false
  let hasProxyName = false
  let hasRequire = false
  let hasRevert = false

  visitAll(ast as ASTNode, (node) => {
    if (!node || typeof node !== 'object') return

    if (node.type === 'ContractDefinition') {
      const name = (node.name ?? '').toString()
      if (name) contracts.push(name)
      if (/proxy/i.test(name)) hasProxyName = true
    }

    if (node.type === 'StateVariableDeclaration') {
      const vars = (node.variables ?? []) as ASTNode[]
      for (const v of vars) {
        if (v?.name) varNames.push(String(v.name))
      }
    }

    if (node.type === 'FunctionDefinition') {
      functionCount++
      if (node.name) fnNames.push(String(node.name))
    }

    if (node.type === 'EventDefinition') {
      eventCount++
      if (node.name) eventNames.push(String(node.name))
    }

    if (node.type === 'ModifierDefinition') {
      modifierCount++
      if (node.name) modNames.push(String(node.name))
    }

    if (node.type === 'EnumDefinition') {
      if (node.name) enumNames.push(String(node.name))
      const members = (node.members ?? []) as ASTNode[]
      for (const m of members) {
        if (m?.name) enumMembers.push(String(m.name))
      }
    }

    if (node.type === 'StructDefinition') {
      if (node.name) structNames.push(String(node.name))
    }

    if (node.type === 'Mapping') {
      mappingCount++
    }

    // Detect calls to transfer/transferFrom/delegatecall
    if (node.type === 'FunctionCall') {
      const memberName = node.expression?.memberName
      const rawName = node.expression?.name

      if (memberName === 'transferFrom' || rawName === 'transferFrom') usesTransferFrom = true
      if (memberName === 'transfer' || rawName === 'transfer') usesTransfer = true
      if (memberName === 'delegatecall' || rawName === 'delegatecall') usesDelegatecall = true

      // require(...)
      if (rawName === 'require') hasRequire = true
      if (rawName === 'revert') hasRevert = true
    }
  })

  const terms = [
    ...contracts,
    ...varNames,
    ...fnNames,
    ...eventNames,
    ...modNames,
    ...enumNames,
    ...enumMembers,
    ...structNames,
  ].map((t) => t.toLowerCase())

  return {
    contracts,
    varNames,
    fnNames,
    eventNames,
    modNames,
    enumNames,
    enumMembers,
    structNames,
    mappingCount,
    functionCount,
    eventCount,
    modifierCount,
    usesTransferFrom,
    usesTransfer,
    usesDelegatecall,
    hasProxyName,
    hasRequire,
    hasRevert,
    terms,
  }
}

/* ============================================================
   Detection from features (multi-signal scoring)
   ============================================================ */

function detectFromFeatures(f: Features): DetectedPattern[] {
  const patterns: DetectedPattern[] = []

  // Always add Events if any exist (useful for “no logs on Cardano” guidance)
  if (f.eventNames.length > 0) {
    patterns.push({
      kind: 'Events',
      confidence: 0.95,
      details: `Detected ${f.eventNames.length} event(s): ${f.eventNames.join(', ')}.`,
      sourceHints: f.eventNames.slice(0, 12),
    })
  }

  // ERC20-ish
  const erc20Score =
    bool(f.terms.some((t) => t.includes('balances'))) +
    bool(f.fnNames.some((n) => /^transfer$/i.test(n))) +
    bool(f.fnNames.some((n) => /^approve$/i.test(n))) +
    bool(f.fnNames.some((n) => /^transferfrom$/i.test(n))) +
    bool(f.eventNames.some((e) => /^Transfer$/i.test(e))) +
    bool(f.eventNames.some((e) => /^Approval$/i.test(e)))

  if (erc20Score >= 3) {
    patterns.push({
      kind: 'ERC20',
      confidence: clamp(0.6 + erc20Score * 0.1, 0.7, 0.95),
      details: 'Detected ERC20-like token pattern (transfer/approve/allowance + events).',
      sourceHints: pickHints(f, [
        'balances',
        'allowance',
        'totalsupply',
        'transfer',
        'approve',
        'transferfrom',
        'transfer',
        'approval',
      ]),
    })
  }

  // Ownable
  const ownableScore =
    bool(f.varNames.some((v) => /^owner$/i.test(v))) +
    bool(f.modNames.some((m) => /onlyowner/i.test(m))) +
    bool(f.fnNames.some((n) => /transferownership/i.test(n))) +
    bool(f.eventNames.some((e) => /ownershiptransferred/i.test(e)))

  if (ownableScore >= 2) {
    patterns.push({
      kind: 'Ownable',
      confidence: clamp(0.55 + ownableScore * 0.15, 0.7, 0.95),
      details: 'Detected ownership/admin control pattern (owner + onlyOwner/transferOwnership).',
      sourceHints: pickHints(f, ['owner', 'onlyowner', 'transferownership', 'ownershiptransferred']),
    })
  }

  // Pausable
  const pausableScore =
    bool(f.varNames.some((v) => /^paused$/i.test(v))) +
    bool(f.fnNames.some((n) => /^pause$/i.test(n) || /^unpause$/i.test(n))) +
    bool(f.modNames.some((m) => /whennotpaused|whenpaused/i.test(m))) +
    bool(f.eventNames.some((e) => /paused|unpaused/i.test(e)))

  if (pausableScore >= 2) {
    patterns.push({
      kind: 'Pausable',
      confidence: clamp(0.55 + pausableScore * 0.15, 0.7, 0.95),
      details: 'Detected pausability/emergency stop pattern.',
      sourceHints: pickHints(f, ['paused', 'pause', 'unpause', 'whennotpaused', 'whenpaused']),
    })
  }

  // Escrow (classic + marketplace + dispute)
  const escrowScore = scoreEscrow(f)
  if (escrowScore >= 3) {
    patterns.push({
      kind: 'Escrow',
      confidence: clamp(0.55 + escrowScore * 0.12, 0.7, 0.95),
      details:
        'Detected escrow/state-machine custody pattern (fund → release/refund, parties, deadlines, or dispute resolution).',
      sourceHints: pickHints(f, [
        'escrow',
        'order',
        'orders',
        'deal',
        'trade',
        'buyer',
        'seller',
        'beneficiary',
        'depositor',
        'deadline',
        'expire',
        'release',
        'refund',
        'dispute',
        'resolve',
        'arbiter',
        'arbit',
        'transferfrom',
      ]),
    })
  }

  // Lending (lightweight heuristic)
  const lendingScore = scoreLending(f)
  if (lendingScore >= 3) {
    patterns.push({
      kind: 'Lending',
      confidence: clamp(0.55 + lendingScore * 0.12, 0.7, 0.9),
      details: 'Detected lending-like pattern (borrow/repay/collateral/liquidate).',
      sourceHints: pickHints(f, ['borrow', 'repay', 'collateral', 'liquidat', 'loan', 'interest']),
    })
  }

  // Proxy / upgradeability
  if (f.usesDelegatecall || f.hasProxyName) {
    patterns.push({
      kind: 'Proxy',
      confidence: f.usesDelegatecall ? 0.9 : 0.7,
      details: 'Detected proxy/upgradeability indicator (delegatecall or Proxy-named contract).',
      sourceHints: [
        ...(f.usesDelegatecall ? ['delegatecall'] : []),
        ...(f.hasProxyName ? ['Proxy contract name'] : []),
      ],
    })
  }

  // Add a “complexity” hint by reusing existing PatternKind buckets (if you can’t add a new one)
  const complexity = estimateComplexity(f)
  if (complexity >= 0.75 && patterns.length < 2) {
    patterns.push({
      kind: 'Events', // use an existing bucket if PatternKind is fixed
      confidence: 0.4,
      details:
        'Contract appears complex (many functions/mappings/enums). Consider converting by state-machine + per-instance UTXOs rather than a single global state UTXO.',
      sourceHints: [`functions:${f.functionCount}`, `mappings:${f.mappingCount}`, `enums:${f.enumNames.length}`],
    })
  }

  return patterns
}

/* ============================================================
   ABI + Description (unchanged-ish)
   ============================================================ */

function detectFromABI(abi: AbiItem[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = []
  const fnNames = abi.filter((a) => a.type === 'function').map((a) => a.name ?? '')
  const eventNames = abi.filter((a) => a.type === 'event').map((a) => a.name ?? '')

  if (
    fnNames.some((n) => /transfer/i.test(n)) &&
    fnNames.some((n) => /approve/i.test(n)) &&
    fnNames.some((n) => /balance/i.test(n))
  ) {
    patterns.push({
      kind: 'ERC20',
      confidence: 0.75,
      details: 'Detected ERC20-like pattern from ABI function signatures.',
      sourceHints: fnNames.filter((n) => /transfer|approve|balance/i.test(n)).slice(0, 12),
    })
  }

  if (
    fnNames.some((n) => /deposit|create|fund|lock/i.test(n)) &&
    fnNames.some((n) => /withdraw|release|refund|cancel/i.test(n))
  ) {
    patterns.push({
      kind: 'Escrow',
      confidence: 0.65,
      details: 'Detected escrow-like pattern from ABI.',
      sourceHints: fnNames.filter((n) => /deposit|create|fund|release|refund|dispute|resolve/i.test(n)).slice(0, 12),
    })
  }

  if (eventNames.length > 0) {
    patterns.push({
      kind: 'Events',
      confidence: 0.85,
      details: `Detected ${eventNames.length} event(s) from ABI.`,
      sourceHints: eventNames.slice(0, 12),
    })
  }

  return patterns
}

function detectFromDescription(desc: string): DetectedPattern[] {
  const patterns: DetectedPattern[] = []
  const lower = desc.toLowerCase()

  const textRules: { re: RegExp; kind: PatternKind; details: string }[] = [
    { re: /erc-?20|fungible token/i, kind: 'ERC20', details: 'Description mentions ERC20/fungible token.' },
    { re: /escrow|marketplace|order/i, kind: 'Escrow', details: 'Description mentions escrow/marketplace.' },
    { re: /lend|borrow|collateral|liquidat/i, kind: 'Lending', details: 'Description mentions lending concepts.' },
    { re: /owner|admin|access control/i, kind: 'Ownable', details: 'Description mentions ownership/access control.' },
    { re: /pausab|pause|emergency stop/i, kind: 'Pausable', details: 'Description mentions pausability.' },
    { re: /upgrad|proxy|delegatecall/i, kind: 'Proxy', details: 'Description mentions upgradeability/proxy.' },
  ]

  for (const rule of textRules) {
    if (rule.re.test(lower)) {
      patterns.push({
        kind: rule.kind,
        confidence: 0.5,
        details: rule.details,
        sourceHints: [],
      })
    }
  }

  return patterns
}

/* ============================================================
   Scorers
   ============================================================ */

function scoreEscrow(f: Features): number {
  const t = f.terms

  const parties =
    bool(t.some((x) => x.includes('buyer'))) +
    bool(t.some((x) => x.includes('seller'))) +
    bool(t.some((x) => x.includes('beneficiary'))) +
    bool(t.some((x) => x.includes('depositor')))

  const lifecycle =
    bool(t.some((x) => /release|withdraw|payout|settle/.test(x))) +
    bool(t.some((x) => /refund|cancel/.test(x))) +
    bool(t.some((x) => /deposit|fund|lock|create/.test(x)))

  const storage =
    bool(t.some((x) => /orders|order|escrow|deal|trade/.test(x))) +
    bool(f.structNames.some((s) => /order|escrow|deal/i.test(s))) +
    bool(f.enumMembers.some((m) => /funded|released|refunded|disputed|resolved/i.test(m)))

  const disputes =
    bool(t.some((x) => x.includes('dispute'))) +
    bool(t.some((x) => /resolve|arbiter|arbit/.test(x)))

  const timing = bool(t.some((x) => /deadline|expire|timeout|timelock/.test(x)))

  const custody = bool(f.usesTransferFrom) + bool(f.usesTransfer)

  // Weighted-ish sum: this gives “marketplace escrow” a strong score
  return parties + lifecycle + storage + disputes + timing + custody
}

function scoreLending(f: Features): number {
  const t = f.terms
  return (
    bool(t.some((x) => x.includes('borrow'))) +
    bool(t.some((x) => x.includes('repay'))) +
    bool(t.some((x) => x.includes('collateral'))) +
    bool(t.some((x) => /liquidat/.test(x))) +
    bool(t.some((x) => /interest|rate/.test(x)))
  )
}

function estimateComplexity(f: Features): number {
  // Rough heuristic: normalize counts to 0..1
  const fn = clamp01(f.functionCount / 25)
  const maps = clamp01(f.mappingCount / 6)
  const enums = clamp01(f.enumNames.length / 3)
  const structs = clamp01(f.structNames.length / 3)
  return clamp01(0.35 * fn + 0.25 * maps + 0.2 * enums + 0.2 * structs)
}

/* ============================================================
   Helpers
   ============================================================ */

function pickHints(f: Features, keywords: string[]): string[] {
  const kw = keywords.map((k) => k.toLowerCase())
  const all = [
    ...f.contracts,
    ...f.varNames,
    ...f.fnNames,
    ...f.eventNames,
    ...f.modNames,
    ...f.enumNames,
    ...f.enumMembers,
    ...f.structNames,
    ...(f.usesTransferFrom ? ['transferFrom()'] : []),
    ...(f.usesTransfer ? ['transfer()'] : []),
  ]

  const matches = all.filter((s) => kw.some((k) => s.toLowerCase().includes(k)))
  return Array.from(new Set(matches)).slice(0, 16)
}

function deduplicatePatterns(patterns: DetectedPattern[]): DetectedPattern[] {
  const map = new Map<PatternKind, DetectedPattern>()
  for (const p of patterns) {
    const existing = map.get(p.kind)
    if (!existing || existing.confidence < p.confidence) map.set(p.kind, p)
  }
  return Array.from(map.values())
}

function bool(v: boolean): number {
  return v ? 1 : 0
}

function clamp(min: number, x: number, max: number): number {
  return Math.max(min, Math.min(max, x))
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}