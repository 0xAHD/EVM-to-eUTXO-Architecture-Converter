export { parseSolidity } from './parser.js';
export { detectPatterns } from './detector.js';
export { convert } from './converter.js';
export { renderMarkdown } from './renderer.js';
export { generateAikenCode } from './aiken-generator.js';
export { validateAikenCode, getValidationSummary, getValidationSuggestions } from './aiken-validator.js';
export { EXAMPLES, ERC20_EXAMPLE, ESCROW_EXAMPLE, LENDING_EXAMPLE } from './examples.js';
export type * from './types.js';

import { parseSolidity } from './parser.js';
import { detectPatterns } from './detector.js';
import { convert } from './converter.js';
import { renderMarkdown } from './renderer.js';
import { generateAikenCode } from './aiken-generator.js';
import type { ConvertInput, RenderedOutput } from './types.js';

/**
 * Full conversion pipeline: parse → detect → convert → render.
 */
export function runConversion(input: ConvertInput): RenderedOutput {
  let ast = null;
  if (input.solidity) {
    try {
      ast = parseSolidity(input.solidity);
    } catch {
      // If parsing fails, continue with other inputs
    }
  }

  const patterns = detectPatterns(ast, input.abi, input.description);
  const result = convert(patterns, ast, input.options);
  
  // Generate Aiken code
  const aikenCode = generateAikenCode(result);
  
  return renderMarkdown(result, aikenCode);
}
