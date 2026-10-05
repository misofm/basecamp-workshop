// Runs the bank server + Vite together with Sui TESTNET as the default chain.
//   bun server/stage.ts            -> bank server + `vite` dev server
//   bun server/stage.ts preview    -> testnet `vite build`, then bank server + `vite preview`
// Ctrl-C (or either process dying) stops both.
import { resolve } from "node:path";
import type { Subprocess } from "bun";

const root = resolve(import.meta.dir, "..");
const mode = process.argv[2] === "preview" ? "preview" : "dev";
const env = { ...process.env, VITE_MISO_CHAIN: process.env.VITE_MISO_CHAIN ?? "testnet" };
const vite = resolve(root, "node_modules/.bin/vite");

if (mode === "preview") {
  console.log(`[stage] building with VITE_MISO_CHAIN=${env.VITE_MISO_CHAIN}`);
  const build = Bun.spawnSync([vite, "build"], { cwd: root, env, stdio: ["inherit", "inherit", "inherit"] });
  if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
}

const children: Subprocess[] = [];
let stopping = false;

function stopAll(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => {
    for (const c of children) if (c.exitCode === null) c.kill("SIGKILL");
    process.exit(code);
  }, 3000).unref();
  Promise.all(children.map((c) => c.exited)).then(() => process.exit(code));
}

function start(name: string, cmd: string[]): void {
  const child = Bun.spawn(cmd, { cwd: root, env, stdio: ["inherit", "inherit", "inherit"] });
  children.push(child);
  child.exited.then((code) => {
    if (!stopping) {
      console.log(`[stage] ${name} exited (${code}); stopping the rest`);
      stopAll(code === 0 ? 1 : code);
    }
  });
}

start("server", [process.execPath, resolve(root, "server/index.ts")]);
start("vite", [vite, mode === "preview" ? "preview" : "dev", "--host", "0.0.0.0"]);

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => stopAll(0));
