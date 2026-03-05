# EVM → eUTXO Architecture Converter

A local web app + API that takes an EVM-first project description (Solidity code, ABI, or text) and outputs an equivalent **Cardano eUTXO architecture plan or AIKEN equivalent** with transaction flows, datum/redeemer/state mapping, and recommended off-chain components.

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Run both API and web frontend
pnpm dev
```

- **Web UI**: http://localhost:5173
- **API**: http://localhost:3001

## Project Structure

```
evm-eutxo-converter/
  apps/
    api/          # Fastify backend (POST /convert)
    web/          # React + Vite frontend
  packages/
    converter/    # Shared rule engine + AST parsing + Markdown generators
```

## Features

### Input Formats
- **Solidity code** — parsed into AST via `@solidity-parser/parser`
- **ABI JSON** — function/event signatures analyzed for patterns
- **Text description** — keyword-based heuristic detection

### Output Sections
1. **Architecture Mapping** — state → datum, functions → tx builders, balances → tokens/UTXOs
2. **Transaction Flows** — UTXO input/output tables, redeemers, datum transitions per function
3. **Component Diagram** — ASCII architecture diagram
4. **Implementation Checklist** — step-by-step Cardano implementation guide
5. **Aiken codebase equivalent to the EVM contract, with a code quality score
6. **Warnings** — concurrency, datum size, loops, access control, upgradeability

### Detected Patterns
- **ERC20** — balances mapping, transfer/approve, Transfer/Approval events
- **Ownable** — owner state variable, onlyOwner modifier
- **Pausable** — paused flag, pause/unpause functions
- **Escrow** — deposit/withdraw/release/refund functions
- **Lending** — borrow/repay/liquidate/collateral
- **Proxy** — delegatecall, proxy naming

### Built-in Examples
Click "Load Example" buttons in the UI:
- **ERC20 Token** — full SimpleToken with transfer, approve, mint
- **Escrow Contract** — deposit, release, refund with deadline
- **Simple Lending** — borrow, repay, liquidate with collateral

## API

### `POST /convert`

```json
{
  "solidity": "string (optional)",
  "abi": "object[] (optional)",
  "description": "string (optional)",
  "options": {
    "target": "cardano-eutxo",
    "detailLevel": "low|medium|high",
    "assumptions": {
      "useNFTState": true,
      "useIndexers": true
    }
  }
}
```

### Response

```json
{
  "mappingMarkdown": "string",
  "flowsMarkdown": "string",
  "diagramMarkdown": "string",
  "checklistMarkdown": "string",
  "warnings": ["string"],
  "meta": {
    "detectedPatterns": ["ERC20", "Ownable"],
    "confidence": 0.85
  }
}
```

### Other Endpoints
- `GET /health` — health check
- `GET /examples` — returns built-in Solidity examples

## Testing

```bash
# Run all tests
pnpm test

# Run specific package tests
pnpm --filter @evm-eutxo/converter test
pnpm --filter @evm-eutxo/api test
pnpm --filter @evm-eutxo/web test
```

## How to Add New Pattern Rules

The pattern detection system lives in `packages/converter/src/detector.ts`.

### 1. Define the pattern kind

Add to `PatternKind` in `packages/converter/src/types.ts`:

```typescript
export type PatternKind =
  | 'ERC20'
  | 'Ownable'
  // ... existing
  | 'YourNewPattern';  // add here
```

### 2. Add the detector function

In `detector.ts`, add a function that inspects AST nodes:

```typescript
function detectYourPattern(fnNames: string[], varNames: string[]): boolean {
  return fnNames.some(f => /yourKeyword/i.test(f));
}
```

### 3. Wire it into `detectFromAST`

```typescript
if (detectYourPattern(fnNames, varNames)) {
  patterns.push({
    kind: 'YourNewPattern',
    confidence: 0.8,
    details: 'Detected YourNewPattern.',
    sourceHints: [...],
  });
}
```

### 4. Add eUTXO mappings

In `converter.ts`, add mappings in `buildStateMappings()` and flows in `buildFunctionFlows()`:

```typescript
if (kinds.has('YourNewPattern')) {
  mappings.push({ evmComponent: '...', eutxoEquivalent: '...', notes: '...' });
}
```

### 5. Add tests

Add test cases in `packages/converter/src/converter.test.ts`.

## Docker

```bash
docker build -t evm-eutxo-converter .
docker run -p 3001:3001 -p 5173:5173 evm-eutxo-converter
```

## Tech Stack

- **TypeScript** end-to-end
- **Fastify** — API server
- **React + Vite** — frontend
- **@solidity-parser/parser** — Solidity AST parsing
- **Vitest** — testing (backend + frontend)
- **React Testing Library** — component tests
- **pnpm workspaces** — monorepo management
