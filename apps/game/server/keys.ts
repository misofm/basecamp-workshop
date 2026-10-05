// Loads the operator (gas bank) and collector keypairs from `suiprivkey1…` files.
// The key material never leaves this module and is never logged.
import { readFileSync } from "node:fs";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export function loadKeypair(path: string, label: string): Ed25519Keypair {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8").trim();
  } catch {
    throw new Error(`Cannot read ${label} key file at ${path}`);
  }
  try {
    const { scheme, secretKey } = decodeSuiPrivateKey(raw);
    if (scheme !== "ED25519") throw new Error("unsupported schema");
    return Ed25519Keypair.fromSecretKey(secretKey);
  } catch {
    // Deliberately do not include the file content or the underlying error text.
    throw new Error(`The ${label} key file at ${path} is not a valid ED25519 suiprivkey`);
  }
}
