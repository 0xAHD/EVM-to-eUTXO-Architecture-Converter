import type { ConversionResult } from './types.js'

export function generateAikenCode(result: ConversionResult): string {
  const kinds = new Set(result.detectedPatterns.map(p => p.kind))

  const lines: string[] = []

  lines.push('// Generated Aiken code from EVM → eUTXO architecture conversion')
  lines.push('// This is a starting template and must be reviewed before production')
  lines.push('')

  lines.push('use aiken/list')
  lines.push('use aiken/primitive/bytearray')
  lines.push('use aiken/transaction.{Transaction}')
  lines.push('')

  if (kinds.has('ERC20')) {
    lines.push(generateMintingPolicy())
  } else if (kinds.has('Escrow')) {
    lines.push(generateEscrowValidator())
  } else if (kinds.has('Lending')) {
    lines.push(generateLendingValidator())
  } else {
    lines.push(generateGenericValidator())
  }

  lines.push('')
  lines.push('// ------------------------------------------------------------')
  lines.push('// Implementation notes')
  lines.push('// ------------------------------------------------------------')
  lines.push('// 1. Review validator logic before deployment')
  lines.push('// 2. Add full validation rules')
  lines.push('// 3. Write unit tests using Aiken test framework')
  lines.push('// 4. Test on preview/preprod testnet')
  lines.push('// 5. Security audit recommended before mainnet')
  lines.push('')

  const filteredWarnings = filterWarnings(result.warnings, kinds)

  if (filteredWarnings.length > 0) {
    lines.push('// ------------------------------------------------------------')
    lines.push('// Critical warnings')
    lines.push('// ------------------------------------------------------------')

    filteredWarnings.slice(0, 5).forEach(w => {
      const comment = w.replace(/^⚠️\s*/, '').split('\n')[0]
      lines.push(`// • ${comment}`)
    })
  }

  return lines.join('\n')
}

function generateMintingPolicy(): string {
  const lines: string[] = []

  lines.push('// ------------------------------------------------------------')
  lines.push('// Minting Policy for ERC20-like token')
  lines.push('// ------------------------------------------------------------')
  lines.push('')
  lines.push('// TODO: Replace this with the policy owner PubKeyHash (ByteArray).')
  lines.push('// For MVP you can hardcode it; for production, parameterize the policy.')
  lines.push('const POLICY_OWNER: ByteArray = #""')
  lines.push('')

  lines.push('pub type Redeemer {')
  lines.push('  Mint')
  lines.push('}')
  lines.push('')
  lines.push('validator {')
  lines.push('  fn mint(_redeemer: Redeemer, tx: Transaction) {')
  lines.push('')
  lines.push('    // Only allow minting if signed by policy owner')
  lines.push('    let owner_signed =')
  lines.push('      list.any(tx.extra_signatories, fn(s) { s == POLICY_OWNER })')
  lines.push('')
  lines.push('    expect owner_signed: "Minting not authorized"')
  lines.push('')
  lines.push('    True')
  lines.push('  }')
  lines.push('}')
  lines.push('')
  lines.push('// NOTE:')
  lines.push('// ERC20 transfers do NOT require a validator.')
  lines.push('// Native tokens move directly between wallet UTXOs.')
  lines.push('// Allowances (approve/transferFrom) do not map 1:1; redesign recommended.')

  return lines.join('\n')
}

/**
 * Escrow validator that supports:
 * - Per-order UTXO model (one UTXO per escrow/order)
 * - Deadline-based refund
 * - Dispute open + arbiter/admin resolve
 *
 * IMPORTANT: This is still a template. It does NOT check exact output values.
 * Production version must verify outputs (pay seller/buyer, fees, etc.).
 */
function generateEscrowValidator(): string {
  const lines: string[] = []

  lines.push('// ------------------------------------------------------------')
  lines.push('// Escrow Validator (per-order UTXO + optional disputes)')
  lines.push('// ------------------------------------------------------------')
  lines.push('')
  lines.push('// Datum fields MUST be PubKeyHashes represented as ByteArray')
  lines.push('// deadline is a slot/time value depending on your off-chain conventions')
  lines.push('')
  lines.push('// TODO: Optional arbiter/admin PKH for dispute resolution')
  lines.push('const ARBITER: ByteArray = #""')
  lines.push('')
  lines.push('pub type Status {')
  lines.push('  Active')
  lines.push('  Disputed')
  lines.push('}')
  lines.push('')
  lines.push('pub type Datum {')
  lines.push('  buyer: ByteArray')
  lines.push('  seller: ByteArray')
  lines.push('  deadline: Int')
  lines.push('  status: Status')
  lines.push('}')
  lines.push('')
  lines.push('pub type Redeemer {')
  lines.push('  Release')
  lines.push('  Refund')
  lines.push('  OpenDispute')
  lines.push('  ResolveDispute { pay_seller: Bool }')
  lines.push('}')
  lines.push('')
  lines.push('validator {')
  lines.push('  fn spend(datum: Datum, redeemer: Redeemer, tx: Transaction) {')
  lines.push('')
  lines.push('    // Helpers')
  lines.push('    let buyer_signed =')
  lines.push('      list.any(tx.extra_signatories, fn(s) { s == datum.buyer })')
  lines.push('')
  lines.push('    let seller_signed =')
  lines.push('      list.any(tx.extra_signatories, fn(s) { s == datum.seller })')
  lines.push('')
  lines.push('    let arbiter_signed =')
  lines.push('      list.any(tx.extra_signatories, fn(s) { s == ARBITER })')
  lines.push('')
  lines.push('    // NOTE: Deadline enforcement is typically done via tx validity range.')
  lines.push('    // This template only shows the intended rule (you must implement using Transaction fields available in Aiken).')
  lines.push('')
  lines.push('    when redeemer is {')
  lines.push('')
  lines.push('      Release -> {')
  lines.push('        // Typical escrow: buyer authorizes release to seller')
  lines.push('        expect datum.status == Active: "Escrow not active"')
  lines.push('        expect buyer_signed: "Buyer must sign release"')
  lines.push('')
  lines.push('        // TODO: Verify outputs pay seller correctly (and feeRecipient if needed)')
  lines.push('        True')
  lines.push('      }')
  lines.push('')
  lines.push('      Refund -> {')
  lines.push('        // Typical escrow: buyer can refund after deadline')
  lines.push('        expect datum.status == Active: "Escrow not active"')
  lines.push('        expect buyer_signed: "Buyer must sign refund"')
  lines.push('')
  lines.push('        // TODO: Enforce deadline passed using tx validity interval vs datum.deadline')
  lines.push('        // TODO: Verify outputs pay buyer correctly')
  lines.push('        True')
  lines.push('      }')
  lines.push('')
  lines.push('      OpenDispute -> {')
  lines.push('        // Either party can open dispute while active')
  lines.push('        expect datum.status == Active: "Escrow not active"')
  lines.push('        expect buyer_signed || seller_signed: "Only buyer/seller can open dispute"')
  lines.push('')
  lines.push('        // TODO: Enforce state transition Active -> Disputed by checking continuing output datum')
  lines.push('        True')
  lines.push('      }')
  lines.push('')
  lines.push('      ResolveDispute { pay_seller } -> {')
  lines.push('        // Arbiter/admin resolves dispute, funds exit script to buyer or seller')
  lines.push('        expect datum.status == Disputed: "Escrow not disputed"')
  lines.push('        expect arbiter_signed: "Arbiter must sign resolution"')
  lines.push('')
  lines.push('        // TODO: If pay_seller then pay seller; else pay buyer')
  lines.push('        // TODO: Verify outputs and (optional) fee logic')
  lines.push('        True')
  lines.push('      }')
  lines.push('')
  lines.push('    }')
  lines.push('  }')
  lines.push('}')

  lines.push('')
  lines.push('// Notes:')
  lines.push('// - This design assumes ONE UTXO per escrow/order at the script address.')
  lines.push('// - Concurrency scales naturally because different orders are different UTXOs.')
  lines.push('// - Production scripts must verify exact outputs, not only signatures + status.')
  lines.push('// - Replace ARBITER with a real PKH or parameterize the script.')

  return lines.join('\n')
}

function generateLendingValidator(): string {
  const lines: string[] = []

  lines.push('// ------------------------------------------------------------')
  lines.push('// Lending Validator (simplified)')
  lines.push('// ------------------------------------------------------------')
  lines.push('')
  lines.push('pub type Datum {')
  lines.push('  borrower: ByteArray')
  lines.push('  collateral: Int')
  lines.push('  principal: Int')
  lines.push('}')
  lines.push('')
  lines.push('pub type Redeemer {')
  lines.push('  Repay')
  lines.push('  Liquidate')
  lines.push('}')
  lines.push('')
  lines.push('validator {')
  lines.push('  fn spend(datum: Datum, redeemer: Redeemer, tx: Transaction) {')
  lines.push('')
  lines.push('    when redeemer is {')
  lines.push('')
  lines.push('      Repay -> {')
  lines.push('        let borrower_signed =')
  lines.push('          list.any(tx.extra_signatories, fn(s) { s == datum.borrower })')
  lines.push('')
  lines.push('        expect borrower_signed: "Borrower must sign repayment"')
  lines.push('')
  lines.push('        True')
  lines.push('      }')
  lines.push('')
  lines.push('      Liquidate -> {')
  lines.push('        True')
  lines.push('      }')
  lines.push('')
  lines.push('    }')
  lines.push('  }')
  lines.push('}')

  return lines.join('\n')
}

function generateGenericValidator(): string {
  const lines: string[] = []

  lines.push('// ------------------------------------------------------------')
  lines.push('// Generic validator template')
  lines.push('// ------------------------------------------------------------')
  lines.push('')
  lines.push('pub type Redeemer {')
  lines.push('  Spend')
  lines.push('}')
  lines.push('')
  lines.push('validator {')
  lines.push('  fn spend(_datum, _redeemer, _tx) {')
  lines.push('    True')
  lines.push('  }')
  lines.push('}')

  return lines.join('\n')
}

/**
 * Keep warnings relevant to the generated artifact.
 */
function filterWarnings(warnings: string[], kinds: Set<string>): string[] {
  const isErc20NativeTokenMode = kinds.has('ERC20')
  const isEscrow = kinds.has('Escrow')
  const isLending = kinds.has('Lending')

  return warnings.filter(w => {
    const t = w.toLowerCase()

    // ERC20 transfers are native asset transfers, no global state UTXO.
    if (isErc20NativeTokenMode) {
      if (t.includes('concurrency') && t.includes('state utxo')) return false
      if (t.includes('access control') && !t.includes('mint')) return false
    }

    // Escrow/lending are per-instance UTXOs by default in your converter.
    if ((isEscrow || isLending) && t.includes('concurrency') && t.includes('single state')) {
      return false
    }

    return true
  })
}