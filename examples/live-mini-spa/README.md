# Live mini SPA

The small web app built live in section 2 of the workshop, from one prompt, in an empty folder,
with [misofm/skills](https://github.com/misofm/skills) installed. It is kept as it came out,
for comparison with the finished reference app in [`apps/spa`](../../apps/spa/README.md).

## The prompt

> Using the miso skills, build a small single-page web app that lists every Miso release on testnet with its cover and plays a 30-second preview of any track. No API key. Use ../apps/spa as a reference.

## What was built

One TypeScript file (`src/main.ts`, about 140 lines), plain DOM, Vite and hls.js:

1. **Discover**: Sui GraphQL, every object of the Release type, paginated. There is no "list
   releases" endpoint; the chain is the index.
2. **Read**: one `GET https://api.testnet.miso.fm/v1/protocol/releases/{id}` per release for
   title, artists, cover and tracks. Only published releases are shown, newest first.
3. **Media**: covers and HLS previews from `cdn.miso.fm`. The CDN serves only media Miso uploaded
   itself; anything else 404s there, so covers and audio retry once from the public Walrus
   aggregator (same paths, no resizing).
4. **Play**: a 30-second preview from the middle of the track, with a 1 s fade-in and 5 s
   fade-out. Safari uses native HLS.

No key, no backend, no signup. Since it lists every release on Miso testnet, it shows the
workshop catalog alongside anything else published there, including releases you publish
yourself.

## Run it

```sh
npm install && npm run dev      # http://localhost:5173
```

`npm run build` typechecks and builds into `dist/`.

Compared with `apps/spa`, it has no routing, credits, artist pages, pressings, request log or
in-memory cache, and it fetches every release at once on load, which counts against the API's
rate limit (roughly 300 requests per minute per IP).
