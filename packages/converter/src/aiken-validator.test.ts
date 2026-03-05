import { describe, it, expect } from 'vitest';
import { validateAikenCode } from './aiken-validator.js';

describe('validateAikenCode', () => {
  it('rejects empty code', () => {
    const result = validateAikenCode('');
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('accepts code with basic Aiken structure', () => {
    const code = `
use aiken/transaction
pub type Datum {
  amount: Int,
}
pub type Redeemer {
  Spend
}
validator {
  fn spend(datum: Datum, redeemer: Redeemer, context: Transaction) {
    True
  }
}`;
    const result = validateAikenCode(code);
    expect(result.isValid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('detects missing imports', () => {
    const code = 'validator { fn spend() { True } }';
    const result = validateAikenCode(code);
    expect(result.errors.some((e) => e.toLowerCase().includes('aiken') || e.includes('import'))).toBe(true);
  });

  it('detects missing validator block', () => {
    const code = 'use aiken/transaction';
    const result = validateAikenCode(code);
    expect(result.errors.some((e) => e.includes('validator'))).toBe(true);
  });

  it('detects unbalanced brackets', () => {
    const code = `
use aiken/transaction
pub type Datum { amount: Int
pub type Redeemer { Spend }
validator { fn spend() { True }
}`;
    const result = validateAikenCode(code);
    // Should have errors for unbalanced braces
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('score increases with better structure', () => {
    const badCode = 'use aiken/transaction';
    const goodCode = `
use aiken/transaction
pub type Datum { amount: Int }
pub type Redeemer { Spend }
validator {
  fn spend(datum: Datum, redeemer: Redeemer, context: Transaction) {
    True
  }
}`;
    
    const badResult = validateAikenCode(badCode);
    const goodResult = validateAikenCode(goodCode);
    
    expect(goodResult.score).toBeGreaterThan(badResult.score);
  });
});
