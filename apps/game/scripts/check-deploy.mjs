// Refuse to deploy a build that would ship private keys to a public URL.
// Keys in .env.local (or the environment) are baked into the JavaScript bundle, so a keyed
// build may only go behind access control (e.g. Cloudflare Access on the whole hostname).
import { existsSync, readFileSync } from "node:fs";

const names = ["VITE_PLAYER_SUI_PRIVATE_KEY", "VITE_GAME_SUI_PRIVATE_KEY"];
const fromFile = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const keyed = names.some((n) => process.env[n] || new RegExp(`^${n}=\\S+`, "m").test(fromFile));

if (keyed && process.env.MISO_ACCESS_PROTECTED !== "1") {
  console.error(
    "Refusing to deploy: this build would contain private keys.\n" +
      "Put Cloudflare Access in front of the hostname first, then run:\n" +
      "  MISO_ACCESS_PROTECTED=1 npm run deploy\n" +
      "For a public keyless build, move .env.local aside.",
  );
  process.exit(1);
}
console.log(keyed ? "Deploying a KEYED build (access protection confirmed)." : "Deploying a keyless build.");
