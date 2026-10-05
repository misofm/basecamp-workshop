// The two server-held TESTNET wallets plus a per-signer tx queue.
import { config } from "./config";
import { loadKeypair } from "./keys";
import { Mutex } from "./chain";

export const operator = loadKeypair(config.operatorKeyPath, "operator");
export const collector = loadKeypair(config.collectorKeyPath, "collector");
export const operatorAddress = operator.toSuiAddress();
export const collectorAddress = collector.toSuiAddress();
export const operatorQueue = new Mutex();
export const collectorQueue = new Mutex();
