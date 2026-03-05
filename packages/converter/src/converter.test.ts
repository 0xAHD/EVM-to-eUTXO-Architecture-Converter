import { describe, it, expect } from 'vitest';
import { parseSolidity } from './parser.js';
import { detectPatterns } from './detector.js';
import { convert } from './converter.js';
import { renderMarkdown } from './renderer.js';
import { generateAikenCode } from './aiken-generator.js';
import { runConversion } from './index.js';
import { ERC20_EXAMPLE, ESCROW_EXAMPLE, LENDING_EXAMPLE } from './examples.js';
import type { ConvertOptions } from './types.js';

const DEFAULT_OPTIONS: ConvertOptions = {
  target: 'cardano-eutxo',
  detailLevel: 'medium',
  assumptions: { useNFTState: true, useIndexers: true },
};

/* ── Parser tests ────────────────────────────────────────────── */

describe('parseSolidity', () => {
  it('parses a simple contract', () => {
    const ast = parseSolidity('contract Foo { }');
    expect(ast).toBeDefined();
    expect(ast.type).toBe('SourceUnit');
  });

  it('parses the ERC20 example without throwing', () => {
    expect(() => parseSolidity(ERC20_EXAMPLE)).not.toThrow();
  });

  it('parses the Escrow example without throwing', () => {
    expect(() => parseSolidity(ESCROW_EXAMPLE)).not.toThrow();
  });

  it('parses the Lending example without throwing', () => {
    expect(() => parseSolidity(LENDING_EXAMPLE)).not.toThrow();
  });
});

/* ── Detector tests ──────────────────────────────────────────── */

describe('detectPatterns', () => {
  it('detects ERC20 pattern from ERC20 example', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    const erc20 = patterns.find((p) => p.kind === 'ERC20');
    expect(erc20).toBeDefined();
    expect(erc20!.confidence).toBeGreaterThan(0.5);
    expect(erc20!.sourceHints.length).toBeGreaterThan(0);
  });

  it('detects Ownable pattern from ERC20 example', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    expect(patterns.find((p) => p.kind === 'Ownable')).toBeDefined();
  });

  it('detects Events from ERC20 example', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    const events = patterns.find((p) => p.kind === 'Events');
    expect(events).toBeDefined();
    expect(events!.sourceHints).toContain('Transfer');
    expect(events!.sourceHints).toContain('Approval');
  });

  it('detects Escrow pattern from Escrow example', () => {
    const ast = parseSolidity(ESCROW_EXAMPLE);
    const patterns = detectPatterns(ast);
    expect(patterns.find((p) => p.kind === 'Escrow')).toBeDefined();
  });

  it('detects Lending pattern from Lending example', () => {
    const ast = parseSolidity(LENDING_EXAMPLE);
    const patterns = detectPatterns(ast);
    expect(patterns.find((p) => p.kind === 'Lending')).toBeDefined();
  });

  it('detects patterns from text description', () => {
    const patterns = detectPatterns(null, undefined, 'This is an ERC20 token with pausable features');
    expect(patterns.find((p) => p.kind === 'ERC20')).toBeDefined();
    expect(patterns.find((p) => p.kind === 'Pausable')).toBeDefined();
  });

  it('returns empty array for empty input', () => {
    const patterns = detectPatterns(null);
    expect(patterns).toEqual([]);
  });
});

/* ── Converter tests ─────────────────────────────────────────── */

describe('convert', () => {
  it('produces ERC20 state mappings', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    const result = convert(patterns, ast, DEFAULT_OPTIONS);

    expect(result.stateMappings.length).toBeGreaterThan(0);
    const balanceMapping = result.stateMappings.find((m) =>
      m.evmComponent.includes('balances'),
    );
    expect(balanceMapping).toBeDefined();
    expect(balanceMapping!.eutxoEquivalent).toContain('token');
  });

  it('produces allowance mapping mentioning off-chain tracking', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    const result = convert(patterns, ast, DEFAULT_OPTIONS);

    const allowanceMapping = result.stateMappings.find((m) =>
      m.evmComponent.includes('allowance'),
    );
    expect(allowanceMapping).toBeDefined();
    expect(allowanceMapping!.eutxoEquivalent.toLowerCase()).toMatch(/off-chain|policy/);
  });

  it('produces function flows for ERC20', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    const result = convert(patterns, ast, DEFAULT_OPTIONS);

    expect(result.functionFlows.length).toBeGreaterThan(0);
    const transfer = result.functionFlows.find((f) => f.name === 'transfer');
    expect(transfer).toBeDefined();
  });

  it('produces function flows for Escrow (deposit/release/refund)', () => {
    const ast = parseSolidity(ESCROW_EXAMPLE);
    const patterns = detectPatterns(ast);
    const result = convert(patterns, ast, DEFAULT_OPTIONS);

    const names = result.functionFlows.map((f) => f.name);
    expect(names).toContain('deposit');
    expect(names).toContain('release');
    expect(names).toContain('refund');
  });

  it('produces warnings for single state UTXO concurrency', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    const result = convert(patterns, ast, DEFAULT_OPTIONS);

    const concurrencyWarning = result.warnings.find((w) =>
      w.toLowerCase().includes('concurrency'),
    );
    expect(concurrencyWarning).toBeDefined();
  });

  it('produces non-zero confidence score', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    const result = convert(patterns, ast, DEFAULT_OPTIONS);

    expect(result.confidence).toBeGreaterThan(0);
  });

  it('produces zero confidence for empty patterns', () => {
    const result = convert([], null, DEFAULT_OPTIONS);
    expect(result.confidence).toBe(0);
  });
});

/* ── Renderer tests ──────────────────────────────────────────── */

describe('renderMarkdown', () => {
  it('renders all required sections for ERC20', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    const result = convert(patterns, ast, DEFAULT_OPTIONS);
    const aikenCode = generateAikenCode(result);
    const output = renderMarkdown(result, aikenCode);

    expect(output.mappingMarkdown).toContain('Detected EVM Components');
    expect(output.mappingMarkdown).toContain('eUTXO State Model');
    expect(output.mappingMarkdown).toContain('Token Model');
    expect(output.mappingMarkdown).toContain('Access Control Model');
    expect(output.mappingMarkdown).toContain('Off-chain Services');
    expect(output.mappingMarkdown).toContain('Suggested Cardano Project Structure');
    expect(output.aikenCode).toContain('validator');
    expect(output.aikenCode).toContain('Datum');
    expect(output.aikenCode).toContain('Redeemer');
  });

  it('renders transaction flows', () => {
    const ast = parseSolidity(ESCROW_EXAMPLE);
    const patterns = detectPatterns(ast);
    const result = convert(patterns, ast, DEFAULT_OPTIONS);
    const aikenCode = generateAikenCode(result);
    const output = renderMarkdown(result, aikenCode);

    expect(output.flowsMarkdown).toContain('Transaction Flows');
    expect(output.flowsMarkdown).toContain('deposit()');
    expect(output.flowsMarkdown).toContain('release()');
    expect(output.flowsMarkdown).toContain('Redeemer');
    expect(output.flowsMarkdown).toContain('Datum Transition');
  });

  it('renders component diagram', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    const result = convert(patterns, ast, DEFAULT_OPTIONS);
    const aikenCode = generateAikenCode(result);
    const output = renderMarkdown(result, aikenCode);

    expect(output.diagramMarkdown).toContain('Component Diagram');
    expect(output.diagramMarkdown).toContain('User Wallet');
    expect(output.diagramMarkdown).toContain('Validator');
  });

  it('renders checklist', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    const result = convert(patterns, ast, DEFAULT_OPTIONS);
    const aikenCode = generateAikenCode(result);
    const output = renderMarkdown(result, aikenCode);

    expect(output.checklistMarkdown).toContain('Implementation Checklist');
    expect(output.checklistMarkdown).toContain('minting policy');
  });

  it('includes warnings array', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    const result = convert(patterns, ast, DEFAULT_OPTIONS);
    const aikenCode = generateAikenCode(result);
    const output = renderMarkdown(result, aikenCode);

    expect(output.warnings.length).toBeGreaterThan(0);
  });

  it('includes meta with detected patterns', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    const result = convert(patterns, ast, DEFAULT_OPTIONS);
    const aikenCode = generateAikenCode(result);
    const output = renderMarkdown(result, aikenCode);

    expect(output.meta.detectedPatterns).toContain('ERC20');
    expect(output.meta.confidence).toBeGreaterThan(0);
  });

  it('includes Aiken code validation', () => {
    const ast = parseSolidity(ERC20_EXAMPLE);
    const patterns = detectPatterns(ast);
    const result = convert(patterns, ast, DEFAULT_OPTIONS);
    const aikenCode = generateAikenCode(result);
    const output = renderMarkdown(result, aikenCode);

    expect(output.aikenValidation).toBeDefined();
    expect(output.aikenValidation.score).toBeGreaterThan(0);
    expect(output.aikenValidation.errors).toBeDefined();
    expect(output.aikenValidation.summary).toBeDefined();
    expect(output.aikenValidation.suggestions.length).toBeGreaterThan(0);
  });
});

/* ── Pipeline (runConversion) tests ──────────────────────────── */

describe('runConversion', () => {
  it('runs full pipeline for ERC20', () => {
    const output = runConversion({
      solidity: ERC20_EXAMPLE,
      options: DEFAULT_OPTIONS,
    });

    expect(output.mappingMarkdown).toBeTruthy();
    expect(output.flowsMarkdown).toBeTruthy();
    expect(output.diagramMarkdown).toBeTruthy();
    expect(output.checklistMarkdown).toBeTruthy();
    expect(output.warnings.length).toBeGreaterThan(0);
    expect(output.meta.detectedPatterns).toContain('ERC20');
  });

  it('runs full pipeline for Escrow', () => {
    const output = runConversion({
      solidity: ESCROW_EXAMPLE,
      options: DEFAULT_OPTIONS,
    });

    expect(output.meta.detectedPatterns).toContain('Escrow');
    expect(output.flowsMarkdown).toContain('deposit()');
  });

  it('runs full pipeline for Lending', () => {
    const output = runConversion({
      solidity: LENDING_EXAMPLE,
      options: DEFAULT_OPTIONS,
    });

    expect(output.meta.detectedPatterns).toContain('Lending');
    expect(output.flowsMarkdown).toContain('borrow()');
    expect(output.flowsMarkdown).toContain('liquidate()');
  });

  it('handles text description only', () => {
    const output = runConversion({
      description: 'An escrow service with collateral-based lending',
      options: DEFAULT_OPTIONS,
    });

    expect(output.meta.detectedPatterns).toContain('Escrow');
    expect(output.meta.detectedPatterns).toContain('Lending');
  });

  it('handles invalid Solidity gracefully', () => {
    const output = runConversion({
      solidity: 'this is not valid solidity {{{{',
      options: DEFAULT_OPTIONS,
    });

    // Should not throw, returns empty result
    expect(output).toBeDefined();
    expect(output.meta.detectedPatterns.length).toBe(0);
  });
});
