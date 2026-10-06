import { bcs } from "@mysten/sui/bcs";
import { deriveObjectID } from "@mysten/sui/utils";
import { RECORD_PACKAGE, RELEASE_TYPE, SUI_GRAPHQL } from "../config";
import { postJson } from "./http";

// There is no "list releases" REST endpoint, so the chain is the index: every live object of the Release type.
export const RELEASES_QUERY = `query Releases($type: String!, $after: String) {
  objects(first: 50, after: $after, filter: { type: $type }) {
    pageInfo { hasNextPage endCursor }
    nodes { address }
  }
}`;

type ReleasesData = {
  objects: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { address: string }[] };
};
type GraphQlResponse<T> = { data?: T; errors?: { message: string }[] };

// Never cached: discovery is polled.
async function query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await postJson<GraphQlResponse<T>>(SUI_GRAPHQL, { query, variables }, { cache: false });
  if (!res.data) throw new Error(res.errors?.[0]?.message ?? "GraphQL query failed");
  return res.data;
}

// Ids of every Release on testnet.
export async function listReleaseIds(): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;
  while (true) {
    const data: ReleasesData = await query(RELEASES_QUERY, { type: RELEASE_TYPE, after });
    ids.push(...data.objects.nodes.map((node) => node.address));
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
