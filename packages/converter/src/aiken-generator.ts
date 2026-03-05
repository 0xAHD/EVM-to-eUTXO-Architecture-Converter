import type { ConversionResult } from './types.js';

/**
 * Generate Aiken on-chain code based on detected patterns.
 * Returns commented, copy-paste friendly boilerplate.
 */
export function generateAikenCode(result: ConversionResult): string {
  const kinds = new Set(result.detectedPatterns.map((p) => p.kind));
  const lines: string[] = [];

  lines.push('// Aiken validator template (generated from EVM architecture conversion)');
  lines.push('// Copy this as a starting point for your Cardano validator');
  lines.push('');
  lines.push('use aiken/list');
  lines.push('use aiken/option');
  lines.push('use aiken/primitive/bytearray');
  lines.push('use aiken/transaction.{');
  lines.push('  InlineData, Input, Output, Transaction, placeholder,');
  lines.push('}');
  lines.push('');

  // Datum & Redeemer types
  lines.push('// ─── Type Definitions ───');
  lines.push('pub type Datum {');

  if (kinds.has('ERC20')) {
    lines.push('  // For ERC20-like token state');
    lines.push('  total_supply: Int,');
  }

  if (kinds.has('Ownable')) {
    lines.push('  // For access control');
    lines.push('  owner: ByteArray,');
  }

  if (kinds.has('Pausable')) {
    lines.push('  // For pausable patterns');
    lines.push('  paused: Bool,');
  }

  if (kinds.has('Escrow')) {
    lines.push('  // For escrow state');
    lines.push('  depositor: ByteArray,');
    lines.push('  beneficiary: ByteArray,');
    lines.push('  amount: Int,');
    lines.push('  deadline: Int,');
    lines.push('  status: EscrowStatus,');
  }

  if (kinds.has('Lending')) {
    lines.push('  // For lending pool state');
    lines.push('  borrower: ByteArray,');
    lines.push('  collateral_amount: Int,');
    lines.push('  principal: Int,');
    lines.push('  interest_rate: Int,');
    lines.push('  status: LendingStatus,');
  }

  lines.push('}');
  lines.push('');

  // Redeemer types
  lines.push('pub type Redeemer {');
  if (kinds.has('ERC20')) {
    lines.push('  Transfer { to: ByteArray, amount: Int }');
    lines.push('  Mint { amount: Int }');
  } else if (kinds.has('Escrow')) {
    lines.push('  Deposit');
    lines.push('  Release');
    lines.push('  Refund');
  } else if (kinds.has('Lending')) {
    lines.push('  Borrow { amount: Int, collateral: Int }');
    lines.push('  Repay { amount: Int }');
    lines.push('  Liquidate');
  } else {
    lines.push('  Spend');
  }
  lines.push('}');
  lines.push('');

  // Status enums
  if (kinds.has('Escrow')) {
    lines.push('pub type EscrowStatus {');
    lines.push('  Active');
    lines.push('  Released');
    lines.push('  Refunded');
    lines.push('}');
    lines.push('');
  }

  if (kinds.has('Lending')) {
    lines.push('pub type LendingStatus {');
    lines.push('  Active');
    lines.push('  Repaid');
    lines.push('  Liquidated');
    lines.push('}');
    lines.push('');
  }

  // Validator logic
  lines.push('// ─── Validator Logic ───');
  lines.push('validator {');
  lines.push('  fn spend(datum: Datum, redeemer: Redeemer, context: Transaction) {');
  lines.push('    let tx = placeholder');
  lines.push('');

  if (kinds.has('Ownable')) {
    lines.push('    // 1. Check owner signature');
    lines.push('    let owner_signed =');
    lines.push('      list.any(');
    lines.push('        tx.extra_signatories,');
    lines.push('        fn(signer) { signer == datum.owner },');
    lines.push('      )');
    lines.push('');
    lines.push('    expect owner_signed: "Not signed by owner"');
    lines.push('');
  }

  if (kinds.has('Pausable')) {
    lines.push('    // 2. Check if paused');
    lines.push('    expect !datum.paused: "Contract is paused"');
    lines.push('');
  }

  if (kinds.has('ERC20')) {
    lines.push('    // 3. Handle transfer based on redeemer');
    lines.push('    when redeemer is {');
    lines.push('      Transfer(to, amount) -> {');
    lines.push('        // Validate transfer (e.g., sufficient balance in input UTXOs)');
    lines.push('        expect amount > 0: "Transfer amount must be positive"');
    lines.push('        True');
    lines.push('      }');
    lines.push('      Mint(amount) -> {');
    lines.push('        // Only owner can mint');
    lines.push('        expect owner_signed: "Only owner can mint"');
    lines.push('        expect amount > 0: "Mint amount must be positive"');
    lines.push('        True');
    lines.push('      }');
    lines.push('    }');
  } else if (kinds.has('Escrow')) {
    lines.push('    // 3. Handle escrow redeemers');
    lines.push('    when redeemer is {');
    lines.push('      Deposit -> {');
    lines.push('        // Validate deposit (depositor signed, sufficient funds)');
    lines.push('        expect datum.status == Active: "Already settled"');
    lines.push('        True');
    lines.push('      }');
    lines.push('      Release -> {');
    lines.push('        // Validate release (depositor or arbiter signed)');
    lines.push('        expect datum.status == Active: "Already settled"');
    lines.push('        expect owner_signed: "Not authorized"');
    lines.push('        True');
    lines.push('      }');
    lines.push('      Refund -> {');
    lines.push('        // Check deadline passed');
    lines.push('        expect datum.status == Active: "Already settled"');
    lines.push('        // expect tx.validity_range.lower_bound.height > datum.deadline');
    lines.push('        True');
    lines.push('      }');
    lines.push('    }');
  } else if (kinds.has('Lending')) {
    lines.push('    // 3. Handle lending redeemers');
    lines.push('    when redeemer is {');
    lines.push('      Borrow(amount, collateral) -> {');
    lines.push('        // Validate borrow (check collateral ratio)');
    lines.push('        expect amount > 0: "Borrow amount must be positive"');
    lines.push('        expect collateral >= amount * 150 / 100: "Insufficient collateral (need 150%)"');
    lines.push('        True');
    lines.push('      }');
    lines.push('      Repay(amount) -> {');
    lines.push('        // Validate repay (check sufficient repayment)');
    lines.push('        expect amount > 0: "Repay amount must be positive"');
    lines.push('        expect datum.status == Active: "Loan not active"');
    lines.push('        True');
    lines.push('      }');
    lines.push('      Liquidate -> {');
    lines.push('        // Validate liquidation (check under-collateralized)');
    lines.push('        expect datum.status == Active: "Loan not active"');
    lines.push('        // expect computed_ltv > 100: "Loan is healthy"');
    lines.push('        True');
    lines.push('      }');
    lines.push('    }');
  } else {
    lines.push('    // Generic validation');
    lines.push('    when redeemer is {');
    lines.push('      Spend -> True');
    lines.push('    }');
  }

  lines.push('  }');
  lines.push('}');
  lines.push('');

  // Off-chain examples
  lines.push('// ─── Off-Chain TX Builders (Typescript/Lucid example) ───');
  lines.push('/*');
  lines.push('');

  if (kinds.has('ERC20')) {
    lines.push('// Example: Transfer tokens');
    lines.push('const txTransfer = await lucid');
    lines.push('  .newTx()');
    lines.push('  .payToAddress(recipientAddress, { [nftUnit]: 1n, lovelace: 2000000n })');
    lines.push('  .payToAddress(userAddress, { lovelace: changeAmount })');
    lines.push('  .complete();');
    lines.push('');
  }

  if (kinds.has('Escrow')) {
    lines.push('// Example: Deposit to escrow');
    lines.push('const txDeposit = await lucid');
    lines.push('  .newTx()');
    lines.push('  .payToContract(scriptAddress, { InlineData: escrowDatum }, { lovelace: depositAmount })');
    lines.push('  .complete();');
    lines.push('');
    lines.push('// Example: Release from escrow');
    lines.push('const txRelease = await lucid');
    lines.push('  .newTx()');
    lines.push('  .collectFrom([escrowUtxo], ReleaseRedeemer)');
    lines.push('  .payToAddress(beneficiaryAddress, { lovelace: depositAmount })');
    lines.push('  .complete();');
    lines.push('');
  }

  if (kinds.has('Lending')) {
    lines.push('// Example: Borrow');
    lines.push('const txBorrow = await lucid');
    lines.push('  .newTx()');
    lines.push('  .payToContract(scriptAddress, { InlineData: loanDatum }, { lovelace: collateral })');
    lines.push('  .payToAddress(borrowerAddress, { lovelace: principal })');
    lines.push('  .complete();');
    lines.push('');
  }

  lines.push('const signedTx = await tx.sign().complete();');
  lines.push('const txHash = await signedTx.submit();');
  lines.push('');
  lines.push('*/');
  lines.push('');

  // Notes
  lines.push('// ─── Implementation Notes ───');
  lines.push('// 1. Replace placeholders with actual transaction context');
  lines.push('// 2. Add proper error handling and validation');
  lines.push('// 3. Test on preview/preprod testnet before mainnet');
  lines.push('// 4. Consider using Aiken test framework for unit tests');
  lines.push('// 5. Security audit recommended before deployment');
  lines.push('');

  if (result.warnings.length > 0) {
    lines.push('// ─── Critical Warnings ───');
    result.warnings.slice(0, 5).forEach((w) => {
      const comment = w.replace(/^⚠️\s*/, '').split('\n')[0].slice(0, 70);
      lines.push(`// • ${comment}`);
    });
    lines.push('');
  }

  lines.push('// For more details, see the Architecture Mapping and Transaction Flows documentation.');

  return lines.join('\n');
}
