// Miso workshop "bank server" (Sui TESTNET ONLY). Run: bun server/index.ts
// Routes (JSON): GET /api/health, GET /api/collector, POST /api/fund, POST /api/collector/buy
import { chain, config } from "./config";
import { getBalance, parseAddress, parseDigest } from "./chain";
import { HttpError } from "./errors";
import { fund } from "./fund";
import { buy, collectorInfo, paidStore } from "./collector";
import { collectorAddress, operatorAddress } from "./wallets";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Request body must be a JSON object.");
  return body as Record<string, unknown>;
}

async function route(req: Request, path: string): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const key = `${req.method} ${path}`;
  switch (key) {
    case "GET /api/health": {
      let operatorSui = "unknown";
      try {
        operatorSui = (await getBalance(operatorAddress)).toString();
      } catch {
        /* health stays up even if the fullnode is flaky */
      }
      return json({ ok: true, network: chain.network, operator: operatorAddress, collector: collectorAddress, operatorSui });
    }
    case "GET /api/collector":
      return json(collectorInfo());
    case "POST /api/fund": {
      const body = await readBody(req);
      const address = parseAddress(body.address, "address");
      return json(await fund(address));
    }
    case "POST /api/collector/buy": {
      const body = await readBody(req);
      const recordId = parseAddress(body.recordId, "recordId");
      const digest = parseDigest(body.digest, "digest");
      return json(await buy(recordId, digest));
    }
  }
  if (path.startsWith("/api/")) {
    const known = ["/api/health", "/api/collector", "/api/fund", "/api/collector/buy"];
    if (known.includes(path)) throw new HttpError(405, "Method not allowed.");
  }
  throw new HttpError(404, "Not found.");
}

const server = Bun.serve({
  port: config.port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const started = performance.now();
    const path = new URL(req.url).pathname;
    let res: Response;
    try {
      res = await route(req, path);
    } catch (err) {
      if (err instanceof HttpError) {
        res = json({ error: err.message }, err.status);
      } else {
        console.log(`[error] ${req.method} ${path}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`.slice(0, 1000));
        res = json({ error: "The bank server hit an unexpected error." }, 500);
      }
    }
    console.log(`${new Date().toISOString()} ${req.method} ${path} ${res.status} ${Math.round(performance.now() - started)}ms`);
    return res;
  },
});

console.log(
  `[bank] Sui ${chain.network} bank server on http://${server.hostname}:${server.port} ` +
    `operator=${operatorAddress} collector=${collectorAddress} payouts=${paidStore.size} data=${config.dataDir}`,
);
