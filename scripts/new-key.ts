// Creates a named Ed25519 keypair under keys/<name>.key (gitignored) and prints its address.
// Export the key as SUI_PRIVATE_KEY (or put it in .env) for the scripts and the miso CLI.
//   bun scripts/new-key.ts operator
// The game (apps/game) runs on two testnet keys: create them with
//   bun scripts/new-key.ts player
//   bun scripts/new-key.ts game
// and paste each keys/<name>.key line into apps/game/.env.local as
// VITE_PLAYER_SUI_PRIVATE_KEY / VITE_GAME_SUI_PRIVATE_KEY (see apps/game/README.md).
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const name = process.argv[2] ?? "operator";
const path = `keys/${name}.key`;
if (existsSync(path)) throw new Error(`${path} exists; refusing to overwrite`);
mkdirSync("keys", { recursive: true });
const kp = new Ed25519Keypair();
writeFileSync(path, kp.getSecretKey() + "\n", { mode: 0o600 });
console.log(`${name}: ${kp.toSuiAddress()}`);
