// POST /api/fund: top up a player burner with SUI (gas) and/or FakeUsd in ONE operator-signed PTB.
import { chain, config, policy } from "./config";
import { getBalance, networkError, signExecuteAndWait } from "./chain";
import { HttpError } from "./errors";
import { buildFundTx } from "./ptb";
import { FundLimiter } from "./ratelimit";
import { operator, operatorAddress, operatorQueue } from "./wallets";

export interface FundResponse {
  funded: boolean;
  digest?: string;
  sui?: string;
  fakeUsd?: string;
  reason?: string;
}

const limiter = new FundLimiter(config.fundCooldownMs, config.fundMaxPerHour);
const inFlight = new Map<string, Promise<FundResponse>>();

export function fund(address: string): Promise<FundResponse> {
  const existing = inFlight.get(address);
  if (existing) return existing;
  const p = doFund(address).finally(() => inFlight.delete(address));
  inFlight.set(address, p);
  return p;
}

async function doFund(address: string): Promise<FundResponse> {
  if (address === operatorAddress) throw new HttpError(400, "That's the bank's own address.");
  let sui: bigint, fusd: bigint;
  try {
    [sui, fusd] = await Promise.all([getBalance(address), getBalance(address, chain.fusdType)]);
  } catch (err) {
    throw networkError(err);
  }
  const sendSui = sui < policy.minPlayerSui ? policy.fundSui : 0n;
  const mintFusd = fusd < policy.minPlayerFusd ? policy.fundFusd : 0n;
  if (sendSui === 0n && mintFusd === 0n) return { funded: false, reason: "already funded" };

  const refusal = limiter.check(address);
  if (refusal) throw new HttpError(429, refusal);

  return operatorQueue.run(async () => {
    let bank: bigint;
    try {
      bank = await getBalance(operatorAddress);
    } catch (err) {
      throw networkError(err);
    }
    if (bank < sendSui + policy.gasReserve) {
      console.log(`[fund] bank empty: operator has ${bank} mist, needs ${sendSui + policy.gasReserve}`);
      throw new HttpError(503, "The gas bank is empty right now (the operator wallet is out of testnet SUI). Ask the host to refill it.");
    }
    const tx = buildFundTx({ sender: operatorAddress, recipient: address, sui: sendSui, fakeUsd: mintFusd });
    // Count the attempt against the limits as soon as we try to send.
    limiter.record(address);
    let digest: string;
    try {
      ({ digest } = await signExecuteAndWait(tx, operator, `fund ${address} sui=${sendSui} fusd=${mintFusd}`));
    } catch (err) {
      throw networkError(err);
    }
    return { funded: true, digest, sui: sendSui.toString(), fakeUsd: mintFusd.toString() };
  });
}
