import type { ConversionResult, FunctionFlow, RenderedOutput, UtxoRow } from './types.js';
import { validateAikenCode, getValidationSummary, getValidationSuggestions } from './aiken-validator.js';

/* ================================================================
   renderMarkdown – produce the 5 Markdown sections from a ConversionResult
   ================================================================ */
export function renderMarkdown(result: ConversionResult, aikenCode: string): RenderedOutput {
  const validation = validateAikenCode(aikenCode);
  
  return {
    mappingMarkdown: renderMapping(result),
    flowsMarkdown: renderFlows(result),
    diagramMarkdown: renderDiagram(result),
    checklistMarkdown: renderChecklist(result),
    aikenCode,
    aikenValidation: {
      isValid: validation.isValid,
      score: validation.score,
      errors: validation.errors,
      warnings: validation.warnings,
      summary: getValidationSummary(validation),
      suggestions: getValidationSuggestions(validation),
    },
    warnings: result.warnings,
    meta: {
      detectedPatterns: result.detectedPatterns.map((p) => p.kind),
      confidence: result.confidence,
    },
  };
}

/* ── 1. Architecture Mapping ─────────────────────────────────── */

function renderMapping(r: ConversionResult): string {
  const lines: string[] = [];

  lines.push('# Architecture Mapping: EVM → Cardano eUTXO');
  lines.push('');

  // Detected EVM components
  lines.push('## Detected EVM Components');
  for (const p of r.detectedPatterns) {
    lines.push(`- **${p.kind}** (confidence: ${(p.confidence * 100).toFixed(0)}%) — ${p.details}`);
    if (p.sourceHints.length > 0) {
      lines.push(`  - Source hints: \`${p.sourceHints.join('`, `')}\``);
    }
  }
  lines.push('');

  // eUTXO state model
  lines.push('## eUTXO State Model');
  for (const m of r.stateMappings) {
    lines.push(`### ${m.evmComponent}`);
    lines.push(`**→** ${m.eutxoEquivalent}`);
    lines.push(`> ${m.notes}`);
    lines.push('');
  }

  // Token model
  lines.push(r.tokenModel);
  lines.push('');

  // Access control
  lines.push(r.accessControlModel);
  lines.push('');

  // Off-chain services
  lines.push('## Off-chain Services Needed');
  for (const s of r.offChainServices) {
    lines.push(`- ${s}`);
  }
  lines.push('');

  // Folder structure
  lines.push('## Suggested Cardano Project Structure');
  lines.push('```');
  lines.push(r.folderStructure);
  lines.push('```');

  return lines.join('\n');
}

/* ── 2. Transaction Flows ────────────────────────────────────── */

function renderFlows(r: ConversionResult): string {
  const lines: string[] = [];

  lines.push('# Transaction Flows');
  lines.push('');

  for (const flow of r.functionFlows) {
    lines.push(renderOneFlow(flow));
    lines.push('');
  }

  if (r.functionFlows.length === 0) {
    lines.push('_No specific function flows detected. Provide Solidity code for detailed flows._');
  }

  return lines.join('\n');
}

function renderOneFlow(f: FunctionFlow): string {
  const lines: string[] = [];

  lines.push(`## \`${f.name}()\``);
  lines.push(f.description);
  lines.push('');

  lines.push('### Input UTXOs');
  lines.push(renderUtxoTable(f.inputs));
  lines.push('');

  lines.push('### Output UTXOs');
  lines.push(renderUtxoTable(f.outputs));
  lines.push('');

  lines.push(`### Redeemer`);
  lines.push(`\`${f.redeemer}\``);
  lines.push('');

  lines.push('### Datum Transition');
  lines.push(`- **Before**: ${f.datumBefore}`);
  lines.push(`- **After**: ${f.datumAfter}`);
  lines.push('');

  lines.push('### Failure Cases');
  for (const fc of f.failureCases) {
    lines.push(`- ${fc}`);
  }

  return lines.join('\n');
}

function renderUtxoTable(rows: UtxoRow[]): string {
  if (rows.length === 0) return '_None_';

  const lines: string[] = [];
  lines.push('| Label | Address | Value | Datum |');
  lines.push('|-------|---------|-------|-------|');
  for (const r of rows) {
    lines.push(`| ${r.label} | ${r.address} | ${r.value} | ${r.datum} |`);
  }
  return lines.join('\n');
}

/* ── 3. Component Diagram ────────────────────────────────────── */

function renderDiagram(r: ConversionResult): string {
  const lines: string[] = [];
  lines.push('# Component Diagram');
  lines.push('');
  lines.push(r.diagram);
  return lines.join('\n');
}

/* ── 4. Implementation Checklist ─────────────────────────────── */

function renderChecklist(r: ConversionResult): string {
  const lines: string[] = [];
  lines.push('# Implementation Checklist');
  lines.push('');
  for (const item of r.checklist) {
    lines.push(`- ${item}`);
  }
  return lines.join('\n');
}
