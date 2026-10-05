// Pure PTB builders, exported so test scripts can reuse them (build / simulate / execute).
// None of these touch the network; the caller sets gas and executes.
import { Transaction, type TransactionObjectArgument, type TransactionResult } from "@mysten/sui/transactions";
import { chain } from "./config";

export interface FakeUsdConstants {
  fusdType: string;
  faucetPackageId: string;
  fakeUsdTreasury: string;
}

const DEFAULT_FUSD: FakeUsdConstants = {
  fusdType: chain.fusdType,
  faucetPackageId: chain.faucetPackageId,
  fakeUsdTreasury: chain.fakeUsdTreasury,
};

/**
 * Adds `faucet::mint<FUSD>(amount, &mut treasury) -> Balance<FUSD>` then
 * `0x2::coin::from_balance<FUSD>(balance) -> Coin<FUSD>` and returns the Coin result.
 */
export function addMintFakeUsdCoin(tx: Transaction, amount: bigint, c: FakeUsdConstants = DEFAULT_FUSD): TransactionResult {
  const balance = tx.moveCall({
    target: `${c.faucetPackageId}::faucet::mint`,
    typeArguments: [c.fusdType],
    arguments: [tx.pure.u64(amount), tx.object(c.fakeUsdTreasury)],
  });
  return tx.moveCall({
    target: "0x2::coin::from_balance",
    typeArguments: [c.fusdType],
    arguments: [balance],
  });
}

export interface FundTxInput {
  /** Operator address (signer, pays gas and the SUI part). */
  sender: string;
  recipient: string;
  /** Mist to send from the gas coin; 0n / undefined = skip. */
  sui?: bigint;
  /** FUSD base units to mint via the faucet; 0n / undefined = skip. */
  fakeUsd?: bigint;
}

/**
 * Fund PTB (one tx, signed by the operator):
 *   [sui > 0]     SplitCoins(GasCoin, [sui])                       -> suiCoin
 *   [fakeUsd > 0] faucet::mint<FUSD>(fakeUsd, treasury)            -> balance
 *                 0x2::coin::from_balance<FUSD>(balance)           -> fusdCoin
 *   TransferObjects([suiCoin?, fusdCoin?], recipient)
 */
export function buildFundTx(input: FundTxInput, c: FakeUsdConstants = DEFAULT_FUSD): Transaction {
  const sui = input.sui ?? 0n;
  const fakeUsd = input.fakeUsd ?? 0n;
  if (sui <= 0n && fakeUsd <= 0n) throw new Error("buildFundTx: nothing to send");
  const tx = new Transaction();
  tx.setSender(input.sender);
  const coins: TransactionObjectArgument[] = [];
  if (sui > 0n) {
    const [suiCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(sui)]);
    coins.push(suiCoin!);
  }
  if (fakeUsd > 0n) coins.push(addMintFakeUsdCoin(tx, fakeUsd, c));
  tx.transferObjects(coins, tx.pure.address(input.recipient));
  return tx;
}

export interface PayoutTxInput {
  /** Collector address (signer, pays gas). */
  sender: string;
  seller: string;
  /** FUSD base units to pay. */
  amount: bigint;
}

/**
 * Payout PTB (signed by the collector):
 *   faucet::mint<FUSD>(amount, treasury) -> balance
 *   0x2::coin::from_balance<FUSD>(balance) -> coin
 *   TransferObjects([coin], seller)
 */
export function buildPayoutTx(input: PayoutTxInput, c: FakeUsdConstants = DEFAULT_FUSD): Transaction {
  if (input.amount <= 0n) throw new Error("buildPayoutTx: amount must be > 0");
  const tx = new Transaction();
  tx.setSender(input.sender);
  const coin = addMintFakeUsdCoin(tx, input.amount, c);
  tx.transferObjects([coin], tx.pure.address(input.seller));
  return tx;
}

/** Plain SUI transfer (operator -> collector gas top-up): SplitCoins(GasCoin,[mist]) + TransferObjects. */
export function buildSuiTransferTx(input: { sender: string; recipient: string; mist: bigint }): Transaction {
  const tx = new Transaction();
  tx.setSender(input.sender);
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(input.mist)]);
  tx.transferObjects([coin!], tx.pure.address(input.recipient));
  return tx;
}
