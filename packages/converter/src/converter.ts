import { visitAll, type SolidityAST } from './parser.js';
import type {
  ConvertOptions,
  ConversionResult,
  DetectedPattern,
  FunctionFlow,
  StateMapping,
  UtxoRow,
} from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ASTNode = Record<string, any>;

/* ================================================================
   convert – map EVM patterns + AST to eUTXO architecture
   ================================================================ */
export function convert(
  patterns: DetectedPattern[],
  ast: SolidityAST | null,
  options: ConvertOptions,
): ConversionResult {
  const patternKinds = new Set(patterns.map((p) => p.kind));

  const stateMappings = buildStateMappings(patterns, options);
  const tokenModel = buildTokenModel(patternKinds, options);
  const accessControlModel = buildAccessControlModel(patternKinds);
  const offChainServices = buildOffChainServices(patternKinds, options);
  const folderStructure = buildFolderStructure(patternKinds);
  const functionFlows = buildFunctionFlows(patterns, ast, options);
  const diagram = buildDiagram(patternKinds, options);
  const checklist = buildChecklist(patternKinds, options);
  const warnings = buildWarnings(patternKinds, options);
  const confidence = computeConfidence(patterns);

  return {
    detectedPatterns: patterns,
    stateMappings,
    tokenModel,
    accessControlModel,
    offChainServices,
    folderStructure,
    functionFlows,
    diagram,
    checklist,
    warnings,
    confidence,
  };
}

/* ── State mappings ──────────────────────────────────────────── */

function buildStateMappings(patterns: DetectedPattern[], options: ConvertOptions): StateMapping[] {
  const mappings: StateMapping[] = [];
  const kinds = new Set(patterns.map((p) => p.kind));

  if (kinds.has('ERC20')) {
    mappings.push(
      {
        evmComponent: 'mapping(address => uint256) balances',
        eutxoEquivalent: 'Native Cardano token (minting policy) — each wallet holds tokens as UTXOs',
        notes: 'No global balances mapping needed; token ledger is the UTXO set itself.',
      },
      {
        evmComponent: 'mapping(address => mapping(address => uint256)) allowance',
        eutxoEquivalent: 'Off-chain allowance tracking + multi-sig or script-based spending policy',
        notes:
          "Allowances don't map 1:1. Consider: (A) off-chain permit signatures, (B) a script that checks a datum for approved spenders.",
      },
      {
        evmComponent: 'totalSupply (uint256)',
        eutxoEquivalent: 'State thread UTXO datum field OR off-chain indexed sum',
        notes: 'Can be tracked via a state UTXO if on-chain enforcement is needed.',
      },
    );
  }

  if (kinds.has('Ownable')) {
    mappings.push({
      evmComponent: 'address owner + onlyOwner modifier',
      eutxoEquivalent: 'Datum field { owner: PubKeyHash } + validator checks signedBy owner',
      notes: 'Validator enforces that the transaction is signed by the owner pubkey hash.',
    });
  }

  if (kinds.has('Pausable')) {
    mappings.push({
      evmComponent: 'bool paused + whenNotPaused modifier',
      eutxoEquivalent: 'Datum field { paused: Bool } on state UTXO; validator rejects tx if paused=True',
      notes: 'Pause/unpause = tx that flips the datum field (only owner can submit).',
    });
  }

  if (kinds.has('Escrow')) {
    mappings.push(
      {
        evmComponent: 'Escrow contract state (depositor, beneficiary, amount)',
        eutxoEquivalent: 'Script UTXO holding escrowed funds with datum { depositor, beneficiary, deadline, status }',
        notes: 'Each escrow instance = one UTXO at the script address.',
      },
      {
        evmComponent: 'deposit() / release() / refund() functions',
        eutxoEquivalent: 'Three tx builder patterns, each using a specific Redeemer variant (Deposit | Release | Refund)',
        notes: 'Validator checks the redeemer and datum transition rules.',
      },
    );
  }

  if (kinds.has('Lending')) {
    mappings.push(
      {
        evmComponent: 'Collateral / loan state mappings',
        eutxoEquivalent: 'Per-loan UTXO at script address with datum { borrower, collateral, principal, interest, status }',
        notes: 'Each loan = independent UTXO to avoid concurrency bottleneck.',
      },
      {
        evmComponent: 'borrow() / repay() / liquidate()',
        eutxoEquivalent: 'Tx builders with Redeemer variants: Borrow | Repay | Liquidate',
        notes: 'Oracle price data may need to be provided as a reference input.',
      },
    );
  }

  if (kinds.has('Proxy')) {
    mappings.push({
      evmComponent: 'Proxy / delegatecall upgradeability',
      eutxoEquivalent:
        'No direct equivalent. Options: (A) parameterised validator with updateable reference script, (B) migration to new script address.',
      notes:
        'Cardano scripts are immutable once deployed. Upgradeability requires careful design (e.g., reference scripts, datum-driven logic switches).',
    });
  }

  if (kinds.has('Events')) {
    mappings.push({
      evmComponent: 'Solidity events (emit Transfer(...), etc.)',
      eutxoEquivalent:
        'Off-chain indexing of tx outputs + optional CIP-20 tx metadata for human-readable notes',
      notes: 'Cardano has no event log. Use an off-chain indexer (e.g., Kupo, Ogmios, Blockfrost) to watch script UTXOs.',
    });
  }

  // Generic state variable mapping
  if (options.assumptions.useNFTState) {
    mappings.push({
      evmComponent: 'Contract storage (generic state variables)',
      eutxoEquivalent:
        'Single state UTXO identified by NFT ("state thread token") holding datum with all state fields',
      notes: 'The NFT ensures uniqueness — only one UTXO carries the state thread token at any time.',
    });
  }

  return mappings;
}

/* ── Token model ──────────────────────────────────────────────── */

function buildTokenModel(kinds: Set<string>, _options: ConvertOptions): string {
  if (kinds.has('ERC20')) {
    return [
      '## Token Model',
      '- **Minting Policy**: A Plutus minting policy script controls token issuance.',
      '- **Currency Symbol**: The policy hash serves as the currency symbol (unique token ID).',
      '- **Token Distribution**: Tokens live in user wallets as native assets in UTXOs.',
      '- **Transfers**: Standard Cardano transactions move tokens between addresses — no contract call needed.',
      '- **Minting/Burning**: Requires a transaction that satisfies the minting policy validator.',
    ].join('\n');
  }
  return [
    '## Token Model',
    '- No ERC20-like token detected.',
    '- If tokens are needed, define a minting policy and issue native assets.',
  ].join('\n');
}

/* ── Access control ──────────────────────────────────────────── */

function buildAccessControlModel(kinds: Set<string>): string {
  const lines = ['## Access Control Model'];
  if (kinds.has('Ownable')) {
    lines.push(
      '- **Owner Checks**: Validator reads `owner` from datum and asserts `txSignedBy owner`.',
      '- **Ownership Transfer**: A dedicated redeemer `TransferOwnership(newOwner)` updates the datum.',
    );
  }
  if (kinds.has('Pausable')) {
    lines.push(
      '- **Pause Guard**: Validator checks `paused` field in datum; rejects all non-admin actions when True.',
    );
  }
  if (!kinds.has('Ownable') && !kinds.has('Pausable')) {
    lines.push('- No explicit access control pattern detected. Any signer can interact with the script.');
  }
  lines.push(
    '- **General Note**: On Cardano, signer checks use `txInfo.signatories`. Multi-sig requires multiple signatures in the tx.',
  );
  return lines.join('\n');
}

/* ── Off-chain services ──────────────────────────────────────── */

function buildOffChainServices(kinds: Set<string>, options: ConvertOptions): string[] {
  const services: string[] = [];
  services.push('Tx Builder / Off-chain SDK (e.g., Lucid, Mesh, cardano-cli)');
  services.push('Wallet integration (CIP-30 dApp connector)');

  if (options.assumptions.useIndexers || kinds.has('Events')) {
    services.push('Chain indexer (Kupo, Ogmios, Blockfrost, or DB Sync) for querying UTXOs and tx history');
  }
  if (kinds.has('ERC20')) {
    services.push('Token metadata registry (CIP-25/CIP-68) for token display info');
  }
  if (kinds.has('Lending')) {
    services.push('Price oracle feed (Charli3, Orcfax, or custom off-chain oracle)');
    services.push('Liquidation bot service');
  }
  if (kinds.has('Escrow')) {
    services.push('Deadline monitoring service (watch for expiry to trigger refunds)');
  }
  services.push('Backend API (optional) to aggregate indexed data for the frontend');

  return services;
}

/* ── Folder structure ────────────────────────────────────────── */

function buildFolderStructure(kinds: Set<string>): string {
  const lines = [
    'cardano-project/',
    '  on-chain/',
    '    validators/',
    '      Main.hs (or Aiken/Plutarch equivalent)',
  ];
  if (kinds.has('ERC20')) {
    lines.push('      MintingPolicy.hs');
  }
  lines.push(
    '    types/',
    '      Datum.hs',
    '      Redeemer.hs',
    '  off-chain/',
    '    src/',
    '      tx-builders/',
  );
  if (kinds.has('ERC20')) lines.push('        transfer.ts', '        mint.ts');
  if (kinds.has('Escrow')) lines.push('        deposit.ts', '        release.ts', '        refund.ts');
  if (kinds.has('Lending')) lines.push('        borrow.ts', '        repay.ts', '        liquidate.ts');
  lines.push(
    '      indexer/',
    '        sync.ts',
    '      api/',
    '        server.ts',
    '    tests/',
    '  frontend/',
    '    src/',
    '      App.tsx',
    '  README.md',
  );
  return lines.join('\n');
}

/* ── Function flows ──────────────────────────────────────────── */

function buildFunctionFlows(
  patterns: DetectedPattern[],
  ast: SolidityAST | null,
  options: ConvertOptions,
): FunctionFlow[] {
  const flows: FunctionFlow[] = [];
  const kinds = new Set(patterns.map((p) => p.kind));

  // Extract function names from AST for enrichment
  const fnNames: string[] = [];
  if (ast) {
    visitAll(ast as ASTNode, (node) => {
      if (node.type === 'FunctionDefinition' && node.name) {
        fnNames.push(node.name);
      }
    });
  }

  if (kinds.has('ERC20')) {
    flows.push(
      buildERC20Transfer(options),
      buildERC20Mint(options),
    );
  }

  if (kinds.has('Escrow')) {
    flows.push(
      buildEscrowDeposit(),
      buildEscrowRelease(),
      buildEscrowRefund(),
    );
  }

  if (kinds.has('Lending')) {
    flows.push(
      buildLendingBorrow(),
      buildLendingRepay(),
      buildLendingLiquidate(),
    );
  }

  return flows;
}

/* ── ERC20 flows ─────────────────────────────────────────────── */

function buildERC20Transfer(_options: ConvertOptions): FunctionFlow {
  return {
    name: 'transfer',
    description: 'Transfer tokens from sender to recipient. On Cardano, this is a standard tx moving native assets.',
    inputs: [
      utxo('Sender wallet UTXO', 'sender addr', 'X tokens + ADA', 'N/A (wallet UTXO)'),
    ],
    outputs: [
      utxo('Recipient UTXO', 'recipient addr', 'Y tokens + min ADA', 'N/A'),
      utxo('Change UTXO', 'sender addr', '(X-Y) tokens + change ADA', 'N/A'),
    ],
    redeemer: 'N/A — native asset transfer requires no script; just a standard transaction.',
    datumBefore: 'N/A (no script UTXO involved for simple transfers)',
    datumAfter: 'N/A',
    failureCases: [
      'Insufficient token balance in sender UTXOs',
      'Insufficient ADA for min UTXO value',
      'Tx too large (too many inputs/outputs)',
    ],
  };
}

function buildERC20Mint(_options: ConvertOptions): FunctionFlow {
  return {
    name: 'mint',
    description: 'Mint new tokens. Requires satisfying the minting policy validator.',
    inputs: [
      utxo('Minter wallet UTXO', 'minter addr', 'ADA for fees + min UTXO', 'N/A'),
    ],
    outputs: [
      utxo('Minter receives minted tokens', 'minter addr', 'newly minted tokens + ADA', 'N/A'),
    ],
    redeemer: 'MintRedeemer { amount: Int }',
    datumBefore: 'N/A (minting policy, not spending validator)',
    datumAfter: 'N/A',
    failureCases: [
      'Minting policy rejects (unauthorized minter)',
      'Invalid amount (negative or zero)',
    ],
  };
}

/* ── Escrow flows ────────────────────────────────────────────── */

function buildEscrowDeposit(): FunctionFlow {
  return {
    name: 'deposit',
    description: 'Depositor locks funds into the escrow script address.',
    inputs: [
      utxo('Depositor wallet UTXO', 'depositor addr', 'escrow amount + ADA', 'N/A'),
    ],
    outputs: [
      utxo('Escrow UTXO', 'script addr', 'escrowed ADA/tokens', '{ depositor, beneficiary, deadline, status: Active }'),
      utxo('Change', 'depositor addr', 'remaining ADA', 'N/A'),
    ],
    redeemer: 'N/A (creating new script UTXO, no spending validator invoked)',
    datumBefore: 'N/A (new UTXO)',
    datumAfter: '{ depositor: PubKeyHash, beneficiary: PubKeyHash, deadline: POSIXTime, status: Active }',
    failureCases: [
      'Insufficient funds',
      'Invalid datum fields (missing beneficiary)',
    ],
  };
}

function buildEscrowRelease(): FunctionFlow {
  return {
    name: 'release',
    description: 'Depositor or arbiter releases escrowed funds to the beneficiary.',
    inputs: [
      utxo('Escrow UTXO', 'script addr', 'escrowed funds', '{ ..., status: Active }'),
    ],
    outputs: [
      utxo('Beneficiary receives funds', 'beneficiary addr', 'escrowed ADA/tokens', 'N/A'),
    ],
    redeemer: 'Release',
    datumBefore: '{ depositor, beneficiary, deadline, status: Active }',
    datumAfter: 'N/A (UTXO consumed; beneficiary receives plain UTXO)',
    failureCases: [
      'Not signed by depositor/arbiter',
      'Escrow already released or refunded',
      'Deadline passed (if time-locked release)',
    ],
  };
}

function buildEscrowRefund(): FunctionFlow {
  return {
    name: 'refund',
    description: 'Depositor reclaims funds after deadline passes.',
    inputs: [
      utxo('Escrow UTXO', 'script addr', 'escrowed funds', '{ ..., status: Active }'),
    ],
    outputs: [
      utxo('Depositor gets refund', 'depositor addr', 'escrowed ADA/tokens', 'N/A'),
    ],
    redeemer: 'Refund',
    datumBefore: '{ depositor, beneficiary, deadline, status: Active }',
    datumAfter: 'N/A (UTXO consumed)',
    failureCases: [
      'Deadline not yet reached (tx validity range check)',
      'Not signed by depositor',
      'Escrow already released',
    ],
  };
}

/* ── Lending flows ───────────────────────────────────────────── */

function buildLendingBorrow(): FunctionFlow {
  return {
    name: 'borrow',
    description: 'Borrower deposits collateral and receives loan tokens.',
    inputs: [
      utxo('Borrower wallet UTXO', 'borrower addr', 'collateral tokens + ADA', 'N/A'),
      utxo('Lending pool UTXO', 'script addr', 'available liquidity', '{ poolState }'),
    ],
    outputs: [
      utxo('Collateral locked UTXO', 'script addr', 'collateral', '{ borrower, collateral, principal, rate, status: Active }'),
      utxo('Borrower receives loan', 'borrower addr', 'loan tokens', 'N/A'),
      utxo('Updated pool UTXO', 'script addr', 'reduced liquidity', '{ updatedPoolState }'),
    ],
    redeemer: 'Borrow { amount: Int, collateralAmount: Int }',
    datumBefore: '{ poolState: { totalLiquidity, ... } }',
    datumAfter: '{ poolState: { totalLiquidity - amount, ... } } + new loan datum',
    failureCases: [
      'Insufficient collateral ratio',
      'Pool has insufficient liquidity',
      'Oracle price feed missing or stale',
    ],
  };
}

function buildLendingRepay(): FunctionFlow {
  return {
    name: 'repay',
    description: 'Borrower repays loan and reclaims collateral.',
    inputs: [
      utxo('Borrower wallet UTXO', 'borrower addr', 'repayment tokens', 'N/A'),
      utxo('Loan UTXO', 'script addr', 'collateral', '{ ..., status: Active }'),
    ],
    outputs: [
      utxo('Borrower gets collateral back', 'borrower addr', 'collateral + remaining ADA', 'N/A'),
      utxo('Pool receives repayment', 'script addr', 'repaid tokens + interest', '{ updatedPoolState }'),
    ],
    redeemer: 'Repay { loanId: ByteString }',
    datumBefore: '{ borrower, collateral, principal, rate, status: Active }',
    datumAfter: 'Loan UTXO consumed; pool datum updated with returned liquidity',
    failureCases: [
      'Insufficient repayment amount',
      'Loan already liquidated',
      'Not signed by borrower',
    ],
  };
}

function buildLendingLiquidate(): FunctionFlow {
  return {
    name: 'liquidate',
    description: 'Liquidator seizes under-collateralized loan.',
    inputs: [
      utxo('Loan UTXO', 'script addr', 'collateral', '{ ..., status: Active }'),
      utxo('Liquidator wallet UTXO', 'liquidator addr', 'ADA for fees', 'N/A'),
    ],
    outputs: [
      utxo('Liquidator receives collateral', 'liquidator addr', 'seized collateral', 'N/A'),
      utxo('Pool receives partial repayment', 'script addr', 'recovered value', '{ updatedPoolState }'),
    ],
    redeemer: 'Liquidate { loanId: ByteString }',
    datumBefore: '{ borrower, collateral, principal, rate, status: Active }',
    datumAfter: 'Loan UTXO consumed; pool datum updated',
    failureCases: [
      'Collateral ratio still healthy (not under-collateralized)',
      'Oracle price unavailable',
      'Loan already repaid or liquidated',
    ],
  };
}

/* ── Diagram ─────────────────────────────────────────────────── */

function buildDiagram(kinds: Set<string>, options: ConvertOptions): string {
  const lines: string[] = [
    '```',
    '┌──────────────┐     ┌───────────────┐     ┌──────────────┐',
    '│  User Wallet  │────▶│  Tx Builder   │────▶│  Submit Tx   │',
    '│  (CIP-30)     │     │  (off-chain)  │     │  (to node)   │',
    '└──────────────┘     └───────────────┘     └──────┬───────┘',
    '                                                   │',
    '                                                   ▼',
    '                      ┌───────────────┐     ┌──────────────┐',
    '                      │   Validator    │◀────│  Cardano     │',
    '                      │   (on-chain)   │     │  Ledger      │',
    '                      └───────────────┘     └──────┬───────┘',
    '                                                   │',
  ];

  if (options.assumptions.useNFTState) {
    lines.push(
      '                      ┌───────────────┐            │',
      '                      │  State UTXO   │◀───────────┘',
      '                      │  (NFT thread)  │',
      '                      └───────────────┘',
    );
  }

  if (options.assumptions.useIndexers || kinds.has('Events')) {
    lines.push(
      '                                                   │',
      '                                                   ▼',
      '                      ┌───────────────┐     ┌──────────────┐',
      '                      │   Indexer      │────▶│  Backend API │',
      '                      │   (Kupo/etc)   │     │  (REST/GQL)  │',
      '                      └───────────────┘     └──────┬───────┘',
      '                                                   │',
      '                                                   ▼',
      '                                            ┌──────────────┐',
      '                                            │  Frontend UI │',
      '                                            └──────────────┘',
    );
  }

  lines.push('```');
  return lines.join('\n');
}

/* ── Checklist ───────────────────────────────────────────────── */

function buildChecklist(kinds: Set<string>, options: ConvertOptions): string[] {
  const items: string[] = [];

  items.push('[ ] Choose on-chain language (Aiken, Plutarch, PlutusTx, or OpShin)');
  items.push('[ ] Define datum and redeemer types');
  items.push('[ ] Implement main validator logic');

  if (kinds.has('ERC20')) {
    items.push('[ ] Implement minting policy for token');
    items.push('[ ] Register token metadata (CIP-25 / CIP-68)');
  }

  if (options.assumptions.useNFTState) {
    items.push('[ ] Mint state thread NFT for concurrency control');
  }

  items.push('[ ] Write off-chain tx builder functions');
  items.push('[ ] Set up chain indexer (Kupo, Ogmios, or Blockfrost)');
  items.push('[ ] Integrate wallet connector (CIP-30)');
  items.push('[ ] Write property-based tests for validator');
  items.push('[ ] Test on preview/preprod testnet');

  if (kinds.has('Lending')) {
    items.push('[ ] Integrate oracle price feed');
    items.push('[ ] Build liquidation bot');
  }

  if (kinds.has('Escrow')) {
    items.push('[ ] Implement deadline monitoring service');
  }

  items.push('[ ] Audit validator for common vulnerabilities (double satisfaction, datum hijacking)');
  items.push('[ ] Deploy to mainnet');

  return items;
}

/* ── Warnings ────────────────────────────────────────────────── */

function buildWarnings(kinds: Set<string>, options: ConvertOptions): string[] {
  const warnings: string[] = [];

  if (options.assumptions.useNFTState) {
    warnings.push(
      '⚠️ CONCURRENCY: Using a single state UTXO creates a concurrency bottleneck — only one tx can consume it per block. Consider splitting state across multiple UTXOs or using off-chain batching.',
    );
  }

  warnings.push(
    '⚠️ DATUM SIZE: Cardano has tx size limits (~16KB). Avoid storing large data structures on-chain; use off-chain storage with on-chain hashes.',
  );

  if (kinds.has('ERC20')) {
    warnings.push(
      '⚠️ NO ON-CHAIN LOOPS: EVM-style iteration over mappings (e.g., airdrop to all holders) is not possible in a validator. Use off-chain batching or multi-tx patterns.',
    );
  }

  if (kinds.has('Ownable')) {
    warnings.push(
      '⚠️ ACCESS CONTROL: Cardano uses pubkey hash checks (txSignedBy), not msg.sender. Ensure all admin actions validate correct signatories.',
    );
  }

  if (kinds.has('Proxy')) {
    warnings.push(
      '⚠️ UPGRADEABILITY: Cardano validators are immutable once deployed. Upgradeability requires migration strategies (reference scripts, parameterized validators, or new script deployment with state migration).',
    );
  }

  if (kinds.has('Lending')) {
    warnings.push(
      '⚠️ ORACLE DEPENDENCY: On-chain price feeds on Cardano are less mature than on EVM. Consider Charli3, Orcfax, or use reference inputs for oracle data.',
    );
  }

  if (kinds.has('Events')) {
    warnings.push(
      '⚠️ NO EVENT LOGS: Cardano has no event/log system. Replace event-driven logic with off-chain indexing of UTXO changes and tx metadata.',
    );
  }

  warnings.push(
    '⚠️ MIN UTXO: Every UTXO must carry minimum ADA (~1-2 ADA). Factor this into economic design.',
  );

  return warnings;
}

/* ── Confidence ──────────────────────────────────────────────── */

function computeConfidence(patterns: DetectedPattern[]): number {
  if (patterns.length === 0) return 0;
  const avg = patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;
  // Scale by number of patterns detected (more patterns = higher confidence, capped)
  const coverage = Math.min(patterns.length / 5, 1);
  return Math.round(avg * 0.7 + coverage * 0.3 * 100) / 100;
}

/* ── Helpers ─────────────────────────────────────────────────── */

function utxo(label: string, address: string, value: string, datum: string): UtxoRow {
  return { label, address, value, datum };
}
