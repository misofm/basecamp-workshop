// Response shapes from the Miso read API. Only the fields this app uses.

export type Credit = {
  partyId: string;
  displayName: string;
  roles: string[];
};

export type Track = {
  no: string;
  title: string;
  disc: number;
  recording: { id: string; compositionId: string };
  composition: { id: string; title: string };
  master: { sample_rate_hz: number; samples: string }; // samples is a string (u64)
  transcodeQuiltId: string;
};

export type TrackCredits = {
  compositionCredits: Credit[];
  recordingCredits: { credits: Credit[]; primaryArtistIds: string[]; featuredArtistIds: string[] };
};

export type Release = {
  id: string;
  title: string;
  subtitle: string | null;
  kind: string | null;
  description: string | null;
  state: { type: string; timestampMs: number };
  publishedAtMs: number;
  cover: { still: { kind: string; blobId: string } | null } | null;
  credits: Credit[];
  primaryArtists: string[];
  genres: string[];
  tracks: Track[];
  trackCredits: Record<string, TrackCredits>; // keyed by recording id
};

export type Lyrics = {
  compositionId: string;
  lyrics: { language: string; text: string }[];
};

export type Artist = {
  id: string;
  kind: "individual" | "group";
  name: string;
  bioShort: string | null;
  bioLong: string | null;
  country: string | null;
  links: { platform: string; value: string; url: string }[];
  members: { id: string; name: string }[];
  avatarUrl: string | null;
};

export type Pressing = {
  id: string;
  releaseId: string;
  edition: number;
  supply: number;
  maxSupply: number;
};

export type Listing = {
  id: string;
  pressingId: string;
  pricing: { kind: "floor" | "fixed"; amount: string };
  currency: { type: string; symbol: string; decimals: number };
  state: "enabled" | "disabled";
};

export type WalletRecord = {
  id: string;
  releaseId: string;
  pressingId: string;
  edition: number;
  number: number;
  purchasePrice: string;
  purchasedTimestampMs: string;
};
