/**
 * Aiken code syntax validation
 * Checks for common errors and structural requirements
 */

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  score: number; // 0-100
}

/**
 * Validate generated Aiken code for structural correctness
 */
export function validateAikenCode(code: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  if (!code || code.trim().length === 0) {
    return {
      isValid: false,
      errors: ['Code is empty'],
      warnings: [],
      score: 0,
    };
  }

  // ─── Check for required structure ───

  // 1. Must have imports (any Aiken import)
  if (!code.includes('use aiken/')) {
    errors.push('Missing Aiken imports');
    score -= 20;
  }

  // 2. Must have type definitions (at least Datum OR Redeemer is required)
  const hasDatum = code.includes('pub type Datum');
  const hasRedeemer = code.includes('pub type Redeemer');
  
  if (!hasDatum && !hasRedeemer) {
    errors.push('Missing type definitions (need pub type Datum or pub type Redeemer)');
    score -= 25;
  }

  // 3. Must have validator
  if (!code.includes('validator {')) {
    errors.push('Missing "validator {" block');
    score -= 30;
  }

  // 4. Must have at least one function
  if (!code.includes('fn ')) {
    errors.push('Missing validator function "fn ..."');
    score -= 20;
  }

  // ─── Check for balanced brackets ───

  const bracketPairs = [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
  ];

  for (const pair of bracketPairs) {
    const openCount = (code.match(new RegExp(`\\${pair.open}`, 'g')) || []).length;
    const closeCount = (code.match(new RegExp(`\\${pair.close}`, 'g')) || []).length;
    if (openCount !== closeCount) {
      errors.push(
        `Mismatched brackets: ${openCount} "${pair.open}" but ${closeCount} "${pair.close}"`,
      );
      score -= 15;
    }
  }

  // ─── Check for common mistakes ───

  // Check for use of 'True' (valid in Aiken) or similar return paths
  const hasValidReturn = code.includes('True') || code.includes('False') || code.includes('expect') || code.includes('when');
  if (!hasValidReturn && code.includes('fn ')) {
    warnings.push('Function may be missing return value (True/False/expect)');
    score -= 5;
  }

  // Trailing commas in type definitions (optional warning)
  const trailingCommas = (code.match(/,\s*\}/g) || []).length;
  if (trailingCommas > 3) {
    // Only warn if there are many
    warnings.push(`Found ${trailingCommas} trailing commas - clean up type definitions`);
    score -= 2;
  }

  // ─── Normalize score ───
  score = Math.max(0, Math.min(100, score));

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    score: Math.round(score),
  };
}

/**
 * Get a human-readable validation summary
 */
export function getValidationSummary(result: ValidationResult): string {
  if (result.isValid && result.warnings.length === 0) {
    return `✅ Code looks good! Quality score: ${result.score}/100`;
  }

  const parts: string[] = [];

  if (result.errors.length > 0) {
    parts.push(`❌ ${result.errors.length} error(s):`);
    result.errors.forEach((e) => parts.push(`  • ${e}`));
  }

  if (result.warnings.length > 0) {
    parts.push(`⚠️ ${result.warnings.length} warning(s):`);
    result.warnings.forEach((w) => parts.push(`  • ${w}`));
  }

  parts.push(`Quality score: ${result.score}/100`);

  return parts.join('\n');
}

/**
 * Suggest improvements based on validation
 */
export function getValidationSuggestions(result: ValidationResult): string[] {
  const suggestions: string[] = [];

  if (!result.isValid) {
    suggestions.push(
      'Fix all errors before using this code - they will prevent compilation',
    );
  }

  if (result.warnings.length > 0) {
    suggestions.push('Review warnings to improve code quality');
  }

  if (result.score < 80) {
    suggestions.push('Consider refactoring for better code structure');
  }

  suggestions.push('Test on Aiken testnet before mainnet deployment');
  suggestions.push('Reference: https://docs.aiken-lang.org/');

  return suggestions;
}
