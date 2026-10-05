import Hls from "hls.js";

// Public, keyless endpoints (from the miso-read-catalog skill / `bun scripts/ids.ts`).
const MISO_API = "https://api.testnet.miso.fm/v1";
const MISO_CDN = "https://cdn.miso.fm/v1";
const WALRUS = "https://aggregator.walrus-testnet.walrus.space/v1"; // fallback: media Miso didn't upload (CDN 404)
const SUI_GRAPHQL = "https://graphql.testnet.sui.io/graphql";
const RELEASE_TYPE =
  "0x02dda3f548d9d38a9122a714663b4d304dad03499879f270f5769bc96e235c67::release::Release";
const PREVIEW = 30;

type Track = { no: string; title: string; transcodeQuiltId: string; master: { samples: string; sample_rate_hz: number } };
type Release = {
  id: string; title: string; primaryArtists: string[]; publishedAtMs: number;
  state: { type: string }; cover: { still: { blobId: string } | null } | null; tracks: Track[];
};

// 1. Discover: every on-chain object of the Release type, paginated.
async function listReleaseIds(): Promise<string[]> {
  const query = `query($type: String!, $after: String) {
    objects(first: 50, after: $after, filter: { type: $type }) {
      pageInfo { hasNextPage endCursor } nodes { address } } }`;
  const ids: string[] = [];
  let after: string | null = null;
  for (;;) {
    const res = await fetch(SUI_GRAPHQL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { type: RELEASE_TYPE, after } }),
    });
    const { data, errors } = await res.json();
    if (!data) throw new Error(errors?.[0]?.message ?? "GraphQL failed");
    ids.push(...data.objects.nodes.map((n: { address: string }) => n.address));
    if (!data.objects.pageInfo.hasNextPage) return ids;
    after = data.objects.pageInfo.endCursor;
  }
}

// 2. One call per release returns title, cover and tracks.
async function getRelease(id: string): Promise<Release> {
  const res = await fetch(`${MISO_API}/protocol/releases/${id}`);
  if (!res.ok) throw new Error(`${res.status} for ${id}`);
  return res.json();
}

// 3. Media URLs on the Miso CDN (same paths on the Walrus aggregator, without ?w= resizing).
const coverUrl = (r: Release, base = MISO_CDN) =>
  r.cover?.still ? `${base}/blobs/${r.cover.still.blobId}` + (base === MISO_CDN ? "?w=512&f=webp" : "") : "";
const previewUrl = (t: Track, base = MISO_CDN) => `${base}/blobs/by-quilt-id/${t.transcodeQuiltId}/aac-96.m3u8`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = $<HTMLAudioElement>("audio");
let hls: Hls | null = null;
let window_ = { start: 0, end: 0 };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  node.textContent = text; // textContent: chain data is untrusted
  return node;
}

// 30 s preview from the middle of the track, 1 s fade in, 5 s fade out.
function play(release: Release, track: Track) {
  const duration = Number(track.master.samples) / track.master.sample_rate_hz;
  const start = Math.max(0, duration / 2 - PREVIEW / 2);
  window_ = { start, end: Math.min(duration, start + PREVIEW) };
  hls?.destroy();
  hls = null;
  audio.volume = 0;
  if (Hls.isSupported()) {
    const player = new Hls({ startPosition: start });
    const fallback = previewUrl(track, WALRUS);
    player.on(Hls.Events.ERROR, (_e, data) => {
      // CDN 404 → retry once from the aggregator (segment URLs are relative to the playlist).
      if (!data.fatal || player.url === fallback) return;
      player.loadSource(fallback);
      player.once(Hls.Events.MANIFEST_PARSED, () => audio.play().catch(() => {}));
    });
    player.loadSource(previewUrl(track));
    player.attachMedia(audio);
    hls = player;
  } else {
    audio.src = previewUrl(track); // Safari: native HLS
    audio.onerror = () => {
      audio.onerror = null; // once
      audio.src = previewUrl(track, WALRUS);
      audio.play().catch(() => {});
    };
    audio.addEventListener("loadedmetadata", () => (audio.currentTime = start), { once: true });
  }
  audio.play().catch(() => {});
  $("now").textContent = `▶ ${track.title} — ${release.primaryArtists.join(", ")}`;
  $("player").hidden = false;
}

function stop() {
  audio.pause();
  hls?.destroy();
  hls = null;
  $("player").hidden = true;
}

audio.addEventListener("timeupdate", () => {
  const t = audio.currentTime;
  audio.volume = Math.min(1, Math.max(0, Math.min((t - window_.start) / 1, (window_.end - t) / 5)));
  if (window_.end && t >= window_.end) stop();
});
$("stop").addEventListener("click", stop);

function card(release: Release) {
  const article = el("article", "card");
  const img = el("img");
  img.src = coverUrl(release);
  img.onerror = () => {
    img.onerror = null; // once
    img.src = coverUrl(release, WALRUS);
  };
  img.alt = release.title;
  img.loading = "lazy";
  const list = el("ol");
  for (const track of release.tracks) {
    const button = el("button", "track", track.title);
    button.addEventListener("click", () => play(release, track));
    const li = el("li");
    li.append(button);
    list.append(li);
  }
  article.append(img, el("h2", "", release.title), el("p", "artist", release.primaryArtists.join(", ")), list);
  return article;
}

async function main() {
  const ids = await listReleaseIds();
  const results = await Promise.allSettled(ids.map(getRelease));
  const releases = results
    .flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))
    .filter((r) => r.state.type === "Published")
    .sort((a, b) => b.publishedAtMs - a.publishedAtMs);
  $("grid").append(...releases.map(card));
  $("status").textContent = `${releases.length} releases · click a track for a 30 s preview`;
}

main().catch((err) => ($("status").textContent = `Error: ${err.message}`));
