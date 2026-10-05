/**
 * !!! TESTNET-ONLY BURNER WALLET !!!
 *
 * The player's key is a throwaway Ed25519 keypair generated in the browser and stored
 * IN PLAIN TEXT in localStorage (`miso-game:burner:testnet`, a `suiprivkey…` string).
 * Anyone with access to this browser profile can take it. That is acceptable ONLY
 * because it holds worthless Sui TESTNET SUI and FakeUSD from the workshop's gas bank.
 * Never reuse this pattern on mainnet or with real funds. Keys are never put in URLs
 * and never logged; tests seed the localStorage slot instead.
 *
 * Owns: creating / loading the burner keypair.
 * Must not: export the secret key or let SDK types escape src/miso/.
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { BURNER_STORAGE_KEY } from "./config";

let burner: Ed25519Keypair | null = null;

export function getBurner(): Ed25519Keypair {
  if (burner) return burner;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(BURNER_STORAGE_KEY);
  } catch {
    // Storage blocked (private mode etc.): fall through to an in-memory burner.
  }
  if (stored) {
    try {
      burner = Ed25519Keypair.fromSecretKey(stored.trim());
      return burner;
    } catch {
      console.warn("[miso testnet] stored burner key is invalid; creating a new TESTNET burner");
    }
  }
  burner = new Ed25519Keypair();
  try {
    localStorage.setItem(BURNER_STORAGE_KEY, burner.getSecretKey());
  } catch {
    console.warn("[miso testnet] localStorage unavailable: this TESTNET burner lasts until reload");
  }
  return burner;
}
