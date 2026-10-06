import { bcs } from "@mysten/sui/bcs";
import { deriveObjectID } from "@mysten/sui/utils";
import { PUBLISHER, RECORD_PACKAGE, RELEASE_TYPE, SUI_GRAPHQL } from "../config";
import { postJson } from "./http";

/** Whose releases the catalog shows: a wallet address, or null for every Release on testnet. Fixed per page load. */
export const PUBLISHER_SCOPE: string | null = (() => {
  const param = new URLSearchParams(window.location.search).get("publisher")?.trim().toLowerCase();
  if (param === "all") return null;
  return param && /^0x[0-9a-f]{1,64}$/.test(param) ? param : PUBLISHER;
})();

// There is no "list releases" REST endpoint, so the chain is the index. Default: Release objects created in
// transactions sent by the publisher wallet (oldest first; we sort by publish time afterwards).
export const PUBLISHER_QUERY = `query PublisherReleases($sender: SuiAddress!, $after: String) {
  address(address: $sender) {
    transactions(first: 50, after: $after, relation: SENT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        effects {
          objectChanges(first: 50) {
            nodes {
              address
              idCreated
              outputState { asMoveObject { contents { type { repr } } } }
            }
          }
        }
      }
    }
  }
}`;

// With ?publisher=all: every object of the Release type.
export const ALL_RELEASES_QUERY = `query AllReleases($type: String!, $after: String) {
  objects(first: 50, after: $after, filter: { type: $type }) {
    pageInfo { hasNextPage endCursor }
    nodes { address }
  }
}`;

type PageInfo = { pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type GraphQlResponse<T> = { data?: T; errors?: { message: string }[] };
type PublisherData = {
  address: {
    transactions: PageInfo & {
      nodes: {
        effects: {
          objectChanges: {
            nodes: {
              address: string;
              idCreated: boolean;
              outputState: { asMoveObject: { contents: { type: { repr: string } } | null } | null } | null;
            }[];
          };
        } | null;
      }[];
    };
  } | null;
};
type AllData = { objects: PageInfo & { nodes: { address: string }[] } };

// Never cached: discovery is polled.
async function query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await postJson<GraphQlResponse<T>>(SUI_GRAPHQL, { query, variables }, { cache: false });
  if (!res.data) throw new Error(res.errors?.[0]?.message ?? "GraphQL query failed");
  return res.data;
}

// Release ids in `scope`, or all of them when scope is null.
export async function listReleaseIds(scope: string | null = PUBLISHER_SCOPE): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;
  while (true) {
    let page: PageInfo["pageInfo"];
    if (scope === null) {
      const data: AllData = await query(ALL_RELEASES_QUERY, { type: RELEASE_TYPE, after });
      ids.push(...data.objects.nodes.map((node) => node.address));
      page = data.objects.pageInfo;
    } else {
      const data: PublisherData = await query(PUBLISHER_QUERY, { sender: scope, after });
      const transactions = data.address?.transactions;
      if (!transactions) return ids;
      for (const tx of transactions.nodes) {
        for (const change of tx.effects?.objectChanges.nodes ?? []) {
          if (change.idCreated && change.outputState?.asMoveObject?.contents?.type.repr === RELEASE_TYPE) {
            ids.push(change.address);
          }
        }
      }
      page = transactions.pageInfo;
    }
    if (!page.hasNextPage) return ids;
    after = page.endCursor;
  }
}

// A Pressing's object id is derived deterministically from its release id and edition number,
// so we can compute it locally instead of needing an indexer.
export function derivePressingId(releaseId: string, edition: number): string {
  return deriveObjectID(
    releaseId,
    `${RECORD_PACKAGE}::pressing::PressingKey`,
    bcs.u16().serialize(edition).toBytes(),
  );
}
