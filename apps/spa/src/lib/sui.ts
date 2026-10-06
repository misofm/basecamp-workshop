import { bcs } from "@mysten/sui/bcs";
import { deriveObjectID } from "@mysten/sui/utils";
import { MIN_CHECKPOINT, RECORD_PACKAGE, RELEASE_TYPE, SUI_GRAPHQL } from "../config";
import { postJson } from "./http";

/** Oldest checkpoint whose releases the catalog shows. `?since=<checkpoint>` overrides it; `?since=0` shows all. */
export const SINCE_CHECKPOINT: number = (() => {
  const param = new URLSearchParams(window.location.search).get("since")?.trim();
  return param && /^\d+$/.test(param) ? Number(param) : MIN_CHECKPOINT;
})();

// There is no "list releases" REST endpoint, so the chain is the index: every live object of the Release
// type, with the checkpoint of the transaction that created it. A release's first version was written by
// its creating transaction; a release that was never modified has only that version.
export const RELEASES_QUERY = `query Releases($type: String!, $after: String) {
  objects(first: 50, after: $after, filter: { type: $type }) {
    pageInfo { hasNextPage endCursor }
    nodes {
      address
      previousTransaction { effects { checkpoint { sequenceNumber } } }
      objectVersionsBefore(first: 1) {
        nodes { previousTransaction { effects { checkpoint { sequenceNumber } } } }
      }
    }
  }
}`;

type Written = { previousTransaction: { effects: { checkpoint: { sequenceNumber: number } | null } | null } | null };
type ReleasesData = {
  objects: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: (Written & { address: string; objectVersionsBefore: { nodes: Written[] } })[];
  };
};
type GraphQlResponse<T> = { data?: T; errors?: { message: string }[] };

// Never cached: discovery is polled.
async function query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await postJson<GraphQlResponse<T>>(SUI_GRAPHQL, { query, variables }, { cache: false });
  if (!res.data) throw new Error(res.errors?.[0]?.message ?? "GraphQL query failed");
  return res.data;
}

const checkpointOf = (written: Written | undefined) =>
  written?.previousTransaction?.effects?.checkpoint?.sequenceNumber ?? null;

// Ids of the releases created at or after `since`.
export async function listReleaseIds(since: number = SINCE_CHECKPOINT): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;
  while (true) {
    const data: ReleasesData = await query(RELEASES_QUERY, { type: RELEASE_TYPE, after });
    for (const node of data.objects.nodes) {
      const created = checkpointOf(node.objectVersionsBefore.nodes[0]) ?? checkpointOf(node);
      if (created !== null && created >= since) ids.push(node.address);
    }
    if (!data.objects.pageInfo.hasNextPage) return ids;
    after = data.objects.pageInfo.endCursor;
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
