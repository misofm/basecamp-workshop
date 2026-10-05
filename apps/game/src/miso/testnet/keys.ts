/**
 * The two TESTNET keys the game runs on, baked in at build time from Vite env vars:
 *
 *   VITE_PLAYER_SUI_PRIVATE_KEY  the single player wallet (buys Records, uses the ATM, sells)
 *   VITE_GAME_SUI_PRIVATE_KEY    the game world = the collector NPC (receives sold Records,
 *                                pays for them with a FakeUSD faucet mint)
 *
 * Both are `suiprivkey1…` ED25519 keys (create them with `bun scripts/new-key.ts player|game`
 * from the repo root) and live in apps/game/.env.local (gitignored).
 *
 * !!! Anything VITE_* is compiled INTO THE SHIPPED JAVASCRIPT. Anyone who can load a keyed
 * build can read both keys. Testnet only, and a hosted keyed build must sit behind access
 * control (Cloudflare Access). Never put a key with real funds here.
 *
 * Owns: parsing the env strings into keypairs (cached) and player-safe errors when they are
 * missing or malformed. The player only sees "The shop's till is offline right now"; what
 * to fix (which var, which file) is in PlayerError.devDetail and logged once to the console.
 * Neither ever contains key text.
 * Must not: be imported outside src/miso/testnet (the mock path never reads these vars), log
 * or export the secret keys.
 */
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { PlayerError, TILL_OFFLINE } from "./errors";

export interface KeyEnv {
  VITE_PLAYER_SUI_PRIVATE_KEY?: string;
  VITE_GAME_SUI_PRIVATE_KEY?: string;
}

export interface GameKeys {
  /** The player's wallet. */
  player: Ed25519Keypair;
  /** The game world: the collector NPC who buys Records. */
  game: Ed25519Keypair;
}

/** What the player sees when the keys are missing or invalid (plain game language). */
export const MISSING_KEYS_MESSAGE = TILL_OFFLINE;

/** Developer detail (PlayerError.devDetail + console) for missing keys. */
export const MISSING_KEYS_DEV_HINT =
  "Testnet keys missing: set VITE_PLAYER_SUI_PRIVATE_KEY and VITE_GAME_SUI_PRIVATE_KEY in apps/game/.env.local, then rebuild.";

const invalidKeyHint = (name: keyof KeyEnv) =>
  `${name} is not a valid suiprivkey (ED25519): fix it in apps/game/.env.local, then rebuild.`;

function parseOne(name: keyof KeyEnv, raw: string): Ed25519Keypair {
  try {
    const { scheme, secretKey } = decodeSuiPrivateKey(raw.trim());
    if (scheme !== "ED25519") throw new Error("unsupported scheme");
    return Ed25519Keypair.fromSecretKey(secretKey);
  } catch {
    // Deliberately drop the underlying error: it may quote the input.
    throw new PlayerError(MISSING_KEYS_MESSAGE, "keys", invalidKeyHint(name));
  }
}

/** Parse both keys from an env object (pure; tests pass their own). Throws PlayerError. */
export function parseKeys(env: KeyEnv): GameKeys {
  const player = env.VITE_PLAYER_SUI_PRIVATE_KEY?.trim();
  const game = env.VITE_GAME_SUI_PRIVATE_KEY?.trim();
  if (!player || !game) throw new PlayerError(MISSING_KEYS_MESSAGE, "keys", MISSING_KEYS_DEV_HINT);
  return {
    player: parseOne("VITE_PLAYER_SUI_PRIVATE_KEY", player),
    game: parseOne("VITE_GAME_SUI_PRIVATE_KEY", game),
  };
}

/**
 * The build's env. Each var is read by its full `import.meta.env?.VITE_…` name so Vite
 * inlines just that string; `?.` keeps this importable from node (unit tests), where
 * import.meta.env does not exist.
 */
function buildEnv(): KeyEnv {
  return {
    VITE_PLAYER_SUI_PRIVATE_KEY: import.meta.env?.VITE_PLAYER_SUI_PRIVATE_KEY,
    VITE_GAME_SUI_PRIVATE_KEY: import.meta.env?.VITE_GAME_SUI_PRIVATE_KEY,
  };
}

let cached: GameKeys | null = null;
let warned = false;

/** The baked-in keys (parsed once). Throws PlayerError when missing or invalid (dev hint logged once). */
export function getKeys(): GameKeys {
  try {
    cached ??= parseKeys(buildEnv());
  } catch (error) {
    if (!warned && error instanceof PlayerError && error.devDetail) {
      warned = true;
      console.warn(`[miso testnet] ${error.devDetail}`);
    }
    throw error;
  }
  return cached;
}
