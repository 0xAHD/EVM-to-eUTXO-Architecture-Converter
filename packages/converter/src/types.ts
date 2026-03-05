/* ── Shared types for the EVM → eUTXO converter ── */

// ─── Input ───────────────────────────────────────
export interface ConvertInput {
  solidity?: string;
  abi?: AbiItem[];
  description?: string;
  options: ConvertOptions;
}

export interface ConvertOptions {
  target: 'cardano-eutxo';
  detailLevel: 'low' | 'medium' | 'high';
  assumptions: {
    useNFTState: boolean;
    useIndexers: boolean;
  };
}

export interface AbiItem {
  type: string;
  name?: string;
  inputs?: AbiParam[];
  outputs?: AbiParam[];
  stateMutability?: string;
  anonymous?: boolean;
}

export interface AbiParam {
  name: string;
  type: string;
  indexed?: boolean;
  components?: AbiParam[];
}

// ─── Detected patterns ──────────────────────────
export type PatternKind =
  | 'ERC20'
  | 'Ownable'
  | 'Pausable'
  | 'Escrow'
  | 'Lending'
  | 'Proxy'
  | 'CustomMapping'
  | 'Events';

export interface DetectedPattern {
  kind: PatternKind;
  confidence: number; // 0‒1
  details: string;
  sourceHints: string[]; // relevant variable / function names
}

// ─── Conversion result ──────────────────────────
export interface StateMapping {
  evmComponent: string;
  eutxoEquivalent: string;
  notes: string;
}

export interface FunctionFlow {
  name: string;
  description: string;
  inputs: UtxoRow[];
  outputs: UtxoRow[];
  redeemer: string;
  datumBefore: string;
  datumAfter: string;
  failureCases: string[];
}

export interface UtxoRow {
  label: string;
  address: string;
  value: string;
  datum: string;
}

export interface ConversionResult {
  detectedPatterns: DetectedPattern[];
  stateMappings: StateMapping[];
  tokenModel: string;
  accessControlModel: string;
  offChainServices: string[];
  folderStructure: string;
  functionFlows: FunctionFlow[];
  diagram: string;
  checklist: string[];
  warnings: string[];
  confidence: number;
}

// ─── Rendered output ────────────────────────────
export interface RenderedOutput {
  mappingMarkdown: string;
  flowsMarkdown: string;
  diagramMarkdown: string;
  checklistMarkdown: string;
  aikenCode: string;
  aikenValidation: {
    isValid: boolean;
    score: number; // 0-100
    errors: string[];
    warnings: string[];
    summary: string;
    suggestions: string[];
  };
  warnings: string[];
  meta: {
    detectedPatterns: string[];
    confidence: number;
  };
}
