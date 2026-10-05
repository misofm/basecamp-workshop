import { expect, test } from "@playwright/test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { MISSING_KEYS_MESSAGE, getKeys, parseKeys } from "../../src/miso/testnet/keys";

const player = new Ed25519Keypair();
const game = new Ed25519Keypair();
const PLAYER_KEY = player.getSecretKey();
const GAME_KEY = game.getSecretKey();

const messageOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a throw");
};

test("both keys parse to the right addresses", () => {
  const keys = parseKeys({ VITE_PLAYER_SUI_PRIVATE_KEY: PLAYER_KEY, VITE_GAME_SUI_PRIVATE_KEY: ` ${GAME_KEY}\n` });
  expect(keys.player.toSuiAddress()).toBe(player.toSuiAddress());
  expect(keys.game.toSuiAddress()).toBe(game.toSuiAddress());
});

test("missing keys: one actionable message", () => {
  expect(MISSING_KEYS_MESSAGE).toBe(
    "Testnet keys missing: set VITE_PLAYER_SUI_PRIVATE_KEY and VITE_GAME_SUI_PRIVATE_KEY in apps/game/.env.local, then rebuild.",
  );
  expect(messageOf(() => parseKeys({}))).toBe(MISSING_KEYS_MESSAGE);
  expect(messageOf(() => parseKeys({ VITE_PLAYER_SUI_PRIVATE_KEY: PLAYER_KEY }))).toBe(MISSING_KEYS_MESSAGE);
  expect(messageOf(() => parseKeys({ VITE_PLAYER_SUI_PRIVATE_KEY: PLAYER_KEY, VITE_GAME_SUI_PRIVATE_KEY: "  " }))).toBe(MISSING_KEYS_MESSAGE);
});

test("invalid keys name the variable and never echo the key text", () => {
  const garbage = "suiprivkey1notarealkeyatallxyz";
  const m1 = messageOf(() => parseKeys({ VITE_PLAYER_SUI_PRIVATE_KEY: garbage, VITE_GAME_SUI_PRIVATE_KEY: GAME_KEY }));
  expect(m1).toMatch(/^VITE_PLAYER_SUI_PRIVATE_KEY is not a valid suiprivkey/);
  expect(m1).not.toContain(garbage);
  expect(m1).not.toContain(GAME_KEY);

  // A well-formed key of the wrong scheme is rejected too, without quoting it.
  const secp = new Secp256k1Keypair().getSecretKey();
  const m2 = messageOf(() => parseKeys({ VITE_PLAYER_SUI_PRIVATE_KEY: PLAYER_KEY, VITE_GAME_SUI_PRIVATE_KEY: secp }));
  expect(m2).toMatch(/^VITE_GAME_SUI_PRIVATE_KEY is not a valid suiprivkey/);
  for (const k of [secp, PLAYER_KEY, secp.slice(10, 40), PLAYER_KEY.slice(10, 40)]) expect(m2).not.toContain(k);
});

test("getKeys() is importable and safe in node, where import.meta.env is absent", () => {
  expect(messageOf(() => getKeys())).toBe(MISSING_KEYS_MESSAGE);
});
