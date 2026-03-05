import * as solidityParser from '@solidity-parser/parser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SolidityAST = Record<string, any>;

/**
 * Parse Solidity source code into an AST.
 * Throws on syntax errors.
 */
export function parseSolidity(source: string): SolidityAST {
  return solidityParser.parse(source, { tolerant: true, loc: true });
}

/* ── AST traversal helpers ── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ASTNode = Record<string, any>;

export function visitAll(ast: ASTNode, visitor: (node: ASTNode) => void): void {
  if (!ast || typeof ast !== 'object') return;
  visitor(ast);
  for (const key of Object.keys(ast)) {
    const child = ast[key];
    if (Array.isArray(child)) {
      child.forEach((c) => {
        if (c && typeof c === 'object') visitAll(c, visitor);
      });
    } else if (child && typeof child === 'object' && child.type) {
      visitAll(child, visitor);
    }
  }
}
