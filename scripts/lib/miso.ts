// Run the Miso CLI (github.com/misofm/cli) from a script.
//
// A shell alias is invisible to child processes, so set MISO_CLI to the command
// that starts the CLI, e.g. MISO_CLI="bun /path/to/cli/src/index.ts". It defaults
// to `miso` on PATH. The signer is SUI_PRIVATE_KEY (suiprivkey1...), which the CLI
// reads from the environment this process passes through.

export const MISO_CLI = (process.env.MISO_CLI?.trim() || "miso").split(/\s+/);

export type MisoRun = { stdout: string; stderr: string; exitCode: number; json: any };

/** Run `miso <args> --json` and return its raw output plus the parsed JSON (or undefined). */
export async function misoRaw(args: string[], opts: { cwd?: string } = {}): Promise<MisoRun> {
  const proc = Bun.spawn([...MISO_CLI, ...args, "--json"], {
    cwd: opts.cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  let json: any;
  try { json = JSON.parse(stdout); } catch { json = undefined; }
  return { stdout, stderr, exitCode, json };
}

/**
 * Run `miso <args> --json` and return its result. Most commands print
 * `{ ok, result | error }`; `release publish --dry-run` prints `{ ok, dryRun, plan }`;
 * the offline helpers (`blobs id`, `blobs store`, `stems identify`) print a bare array.
 */
export async function misoIn(cwd: string | undefined, ...args: string[]): Promise<any> {
  const { stdout, stderr, exitCode, json } = await misoRaw(args, { cwd });
  const what = `miso ${args.join(" ")}`;
  if (json === undefined) throw new Error(`${what} failed (exit ${exitCode}): ${(stderr || stdout).trim().slice(-2000)}`);
  if (Array.isArray(json)) {
    if (exitCode !== 0) throw new Error(`${what} failed (exit ${exitCode}): ${stderr.trim()}`);
    return json;
  }
  if (json.ok !== true || exitCode !== 0) {
    const err = typeof json.error === "string" ? json.error : JSON.stringify(json.error ?? json);
    throw new Error(`${what} failed (exit ${exitCode}): ${err}`);
  }
  return "result" in json ? json.result : json;
}

export const miso = (...args: string[]) => misoIn(undefined, ...args);

/** Fail early with a readable message when a script needs a signer. */
export function requireSigner(): void {
  if (!process.env.SUI_PRIVATE_KEY?.trim()) {
    throw new Error("SUI_PRIVATE_KEY is not set; export your suiprivkey1... key (see .env.example)");
  }
}
