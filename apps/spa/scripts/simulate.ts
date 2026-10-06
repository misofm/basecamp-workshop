// Dry-runs the app's transactions against Sui testnet. Nothing is signed or executed:
// every case is a fullnode simulation with a mocked gas coin.
//
//   npm run simulate
//
// Exits non-zero if any case does not behave as expected.

import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeStructTag } from "@mysten/sui/utils";
import { FAKEUSD_TYPE, FAUCET_AMOUNT, MISO_API, SUI_FULLNODE, SUI_GRAPHQL } from "../src/config";
import { derivePressingId } from "../src/lib/sui";
import {
  buildMintFakeUsdTransaction,
  buildPurchaseTransaction,
  deriveListingId,
  formatFakeUsd,
  formatSui,
  getBalances,
  readPurchasedRecord,
  RECORD_TYPE,
  simulateTransaction,
  type Pricing,
  type SimulationReport,
} from "../src/lib/transactions";
import { classifyAbort, classifyTxError } from "../src/lib/txErrors";

const STAGE = "0xf5ef55754ed5a2ab4cac85f0370c77417b8ac406fbbe620616e53981b3095446"; // SUI, no FakeUSD
const REHEARSAL = "0x09fc758d6cce80ec4dafedb1e2bb8f52d5a5687eceafa130e1e4e42fae04571e"; // SUI + FakeUSD
const NEON_OVERPASS = "0x8b783a8e66a4f3fed771294b1f00bfebd50fc6db217b3dbf2862aa55e953ffe5";
const EXAMPLE_COLLECTOR = "0xad69173b206b5c0be6a83f6e6cde2a282d2ada46c4c81ab491b0fdc646e5795f";

// The one Node global this script uses (the app has no @types/node; this keeps it typecheckable).
declare const process: { exit(code: number): never };

const client = new SuiGrpcClient({ network: "testnet", baseUrl: SUI_FULLNODE });

let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

function printReport(r: SimulationReport): void {
  console.log(`  success   ${r.success}`);
  if (r.error) console.log(`  error     ${r.error}`);
  if (r.abort) console.log(`  abort     ${r.abort.module} ${r.abort.code}`);
  console.log(`  gas       ${r.gasEstimateMist} MIST (~${formatSui(r.gasEstimateMist)} SUI)`);
  for (const c of r.created) console.log(`  created   ${c.objectId}  ${c.type ?? "?"}`);
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

type ApiPressing = { id: string; edition: number; supply: number; maxSupply: number };
type ApiListing = { id: string; pricing: { kind: "fixed" | "floor"; amount: string }; state: string };

// The first edition still for sale: supply left and an enabled FakeUSD listing.
async function findForSale(releaseId: string) {
  for (let edition = 1; edition <= 20; edition++) {
    const pressingId = derivePressingId(releaseId, edition);
    const pressing = await getJson<ApiPressing>(`${MISO_API}/platform/pressings/${pressingId}`);
    if (!pressing) break;
    const listing = await getJson<ApiListing>(
      `${MISO_API}/platform/pressings/${pressingId}/listing?currencyType=${encodeURIComponent(FAKEUSD_TYPE)}`,
    );
    console.log(
      `  edition ${edition}: pressing ${pressingId} supply ${pressing.supply}/${pressing.maxSupply}, ` +
        (listing ? `listing ${listing.id} ${listing.pricing.kind} ${listing.pricing.amount} ${listing.state}` : "no FakeUSD listing"),
    );
    if (listing) check(deriveListingId(pressingId) === listing.id, `deriveListingId(edition ${edition}) matches the API`);
    if (listing && listing.state === "enabled" && pressing.supply < pressing.maxSupply) {
      const pricing: Pricing = { kind: listing.pricing.kind, amount: BigInt(listing.pricing.amount) };
      return { edition, pressing, pricing };
    }
  }
  return null;
}

async function main() {
  console.log(`Sui testnet ${SUI_FULLNODE}, simulation only\n`);

  // a) MINT as a wallet with SUI and no FakeUSD
  console.log(`a) MINT ${formatFakeUsd(FAUCET_AMOUNT)} FakeUSD as STAGE ${STAGE}`);
  const stageBal = await getBalances(client, STAGE);
  console.log(`  balances  ${formatSui(stageBal.suiMist)} SUI, ${formatFakeUsd(stageBal.fakeUsd)} FakeUSD`);
  const mint = await simulateTransaction(
    client,
    () => buildMintFakeUsdTransaction({ amount: FAUCET_AMOUNT, recipient: STAGE }),
    STAGE,
  );
  printReport(mint);
  check(mint.success, "mint simulates");
  const coinType = normalizeStructTag(`0x2::coin::Coin<${FAKEUSD_TYPE}>`);
  check(mint.created.some((c) => c.type && normalizeStructTag(c.type) === coinType), "mint creates a Coin<FakeUsd>");

  // b) BUY the first edition of Neon Overpass still for sale
  console.log(`\nb) BUY Neon Overpass ${NEON_OVERPASS} as REHEARSAL ${REHEARSAL}`);
  const sale = await findForSale(NEON_OVERPASS);
  check(sale !== null, "found an edition for sale");
  if (sale) {
    const rehearsalBal = await getBalances(client, REHEARSAL);
    console.log(`  balances  ${formatSui(rehearsalBal.suiMist)} SUI, ${formatFakeUsd(rehearsalBal.fakeUsd)} FakeUSD`);
    console.log(`  buying    edition ${sale.edition}, ${sale.pricing.kind} ${formatFakeUsd(sale.pricing.amount)} FakeUSD`);
    const buy = await simulateTransaction(
      client,
      () => buildPurchaseTransaction({ releaseId: NEON_OVERPASS, edition: sale.edition, pricing: sale.pricing, buyer: REHEARSAL }),
      REHEARSAL,
    );
    printReport(buy);
    check(buy.success, "buy simulates");
    check(buy.created.some((c) => c.type === RECORD_TYPE), "buy creates a Record");
    // Simulation results carry types, not field values; the next copy is supply + 1.
    console.log(`  record    would be #${sale.pressing.supply + 1} of ${sale.pressing.maxSupply} (from the pressing supply)`);

    // c) NEGATIVE checks: expected failures, classified for the visitor
    console.log(`\nc1) BUY as STAGE (no FakeUSD): expect "fakeUsd"`);
    try {
      const r = await simulateTransaction(
        client,
        () => buildPurchaseTransaction({ releaseId: NEON_OVERPASS, edition: sale.edition, pricing: sale.pricing, buyer: STAGE }),
        STAGE,
      );
      printReport(r);
      check(false, "simulation should have thrown before running");
    } catch (error) {
      console.log(`  thrown    ${error instanceof Error ? error.message : String(error)}`);
      const f = classifyTxError(error);
      check(f.kind === "fakeUsd", `classified ${f.kind}`, f.message);
    }

    console.log(`\nc2) BUY as REHEARSAL expecting the wrong price: expect abort listing 4 -> "priceChanged"`);
    const wrong: Pricing = { kind: sale.pricing.kind, amount: sale.pricing.amount + 1n };
    const r = await simulateTransaction(
      client,
      () => buildPurchaseTransaction({ releaseId: NEON_OVERPASS, edition: sale.edition, pricing: wrong, buyer: REHEARSAL }),
      REHEARSAL,
    );
    printReport(r);
    check(!r.success && r.abort?.module === "listing" && r.abort.code === 4, "aborts in listing with code 4");
    if (r.abort) {
      const f = classifyAbort(r.abort);
      check(f.kind === "priceChanged", `classifyAbort -> ${f.kind}`, f.message);
    }
    if (r.error) {
      const f = classifyTxError(new Error(r.error));
      check(f.kind === "priceChanged", `classifyTxError(error text) -> ${f.kind}`);
    }
  }

  // c3) A brand-new wallet with 0 SUI still gets a gas estimate (mocked gas coin)
  const fresh = Ed25519Keypair.generate().toSuiAddress(); // random address; the key is discarded
  console.log(`\nc3) MINT as a fresh 0-SUI address ${fresh}: expect success with mocked gas`);
  const freshBal = await getBalances(client, fresh);
  console.log(`  balances  ${formatSui(freshBal.suiMist)} SUI, ${formatFakeUsd(freshBal.fakeUsd)} FakeUSD`);
  const freshMint = await simulateTransaction(
    client,
    () => buildMintFakeUsdTransaction({ amount: FAUCET_AMOUNT, recipient: fresh }),
    fresh,
  );
  printReport(freshMint);
  check(freshMint.success, "mint simulates for a 0-SUI wallet");
  check(freshBal.suiMist < freshMint.gasEstimateMist, "app would see: gas needed > SUI balance");

  // d) The post-purchase read path, on a real past purchase (read-only)
  console.log(`\nd) readPurchasedRecord on an existing Record's creating transaction`);
  const records = await getJson<{ id: string; number: number }[]>(`${MISO_API}/platform/wallets/${EXAMPLE_COLLECTOR}/records`);
  const known = records?.[0];
  check(!!known, "example collector owns a record");
  if (known) {
    const { object } = await client.core.getObject({
      objectId: known.id,
      include: { json: true, previousTransaction: true },
    });
    const json = object.json as { number?: unknown } | null | undefined;
    console.log(`  record    ${known.id} json.number=${String(json?.number)} (API number ${known.number})`);
    check(Number(json?.number) === known.number, "getObject json.number matches the API");
    const digest = object.previousTransaction;
    console.log(`  last tx   ${digest}`);
    if (digest) {
      // Fullnodes prune old transactions. readPurchasedRecord is meant for a digest that just
      // executed, so for an old one fall back to the archival GraphQL service, which offers
      // the same core API.
      const pruned = await client.core
        .getTransaction({ digest })
        .then(() => false)
        .catch(() => true);
      const reader = pruned ? new SuiGraphQLClient({ network: "testnet", url: SUI_GRAPHQL }) : client;
      console.log(`  reader    ${pruned ? "GraphQL (fullnode has pruned this digest)" : "fullnode gRPC"}`);
      const found = await readPurchasedRecord(reader, digest);
      console.log(`  read      ${JSON.stringify(found)}`);
      check(found?.recordId === known.id && found.number === known.number, "readPurchasedRecord finds it from the digest");
    }
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
