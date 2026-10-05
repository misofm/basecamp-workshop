import { bcs } from "@mysten/sui/bcs";
import { deriveObjectID } from "@mysten/sui/utils";
import { RECORD_PACKAGE, RELEASE_TYPE, SUI_GRAPHQL } from "../config";
import { postJson } from "./http";

// There is no "list releases" REST endpoint: we ask the chain itself for every object of the Release type.
const RELEASES_QUERY = `
  query Releases($type: String!, $after: String) {
    objects(first: 50, after: $after, filter: { type: $type }) {
      pageInfo { hasNextPage endCursor }
      nodes { address }
    }
  }`;

type ReleasesResponse = {
  data?: {
    objects: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: { address: string }[];
    };
  };
  errors?: { message: string }[];
};

export async function listReleaseIds(): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;
  while (true) {
    const res: ReleasesResponse = await postJson(SUI_GRAPHQL, {
      query: RELEASES_QUERY,
      variables: { type: RELEASE_TYPE, after },
    });
    if (!res.data) throw new Error(res.errors?.[0]?.message ?? "GraphQL query failed");
    const { nodes, pageInfo } = res.data.objects;
    ids.push(...nodes.map((node) => node.address));
    if (!pageInfo.hasNextPage) return ids;
    after = pageInfo.endCursor;
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
