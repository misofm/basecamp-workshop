# Miso testnet read endpoints

All are `GET`, keyless, CORS `*`. Base: `https://api.testnet.miso.fm/v1`. Live contract:
`/v1/openapi.json`. Ids in the samples are shortened; read real ones from responses.

| Endpoint | Returns |
|---|---|
| `/protocol/releases/{id}[?include=trackCredits]` | Full release in one response. |
| `/releases/{id}` and `/{tracks,credits,cover,kind,description,genres}` | The same data, one field per call. |
| `/recordings/{id}` and `/{credits,stream,master}` | `stream` → `transcodeQuiltId`; `master` → FLAC metadata + `masterBlobId`. |
| `/compositions/{id}` and `/{credits,lyrics}` | Lyrics decoded to text. |
| `/parties/{id}` and `/{profile,members,links,roles}` | Party identity, bio, group members. |
| `/parties?ids=a,b,c` | Up to 100 parties by id (not a directory). |
| `/platform/artists/{partyId}` | Artist view of a party. |
| `/platform/pressings/{id}` | Edition, supply, maxSupply. |
| `/platform/pressings/{id}/listing?currencyType={type}` | Listing price and state in that currency. |
| `/platform/wallets/{address}/records` | Records an address owns, hydrated. |
| `/wallets/{address}/records` | Same, paged ids. |
| `/records/{id}` | One Record. |
| `/health`, `/config`, `/openapi.json` | Service metadata. |
| `https://cdn.miso.fm/v1/blobs/{blobId}?w=512&f=webp`, `…/blobs/by-quilt-id/{quiltId}/{file}` | Media (other host): covers, HLS playlists and segments. Only media Miso hosts; anything else returns 404. |
| `https://aggregator.walrus-testnet.walrus.space/v1/blobs/{blobId}`, `…/blobs/by-quilt-id/{quiltId}/{file}` | Media for anything the CDN 404s (e.g. releases published with publish-release): any Walrus testnet blob or quilt item. No `?w=`, slower. |

## Release (`/protocol/releases/{id}?include=trackCredits`, trimmed)

```json
{
  "id": "0x3f3a…1cd8",
  "title": "Between the Doors",
  "kind": "ExtendedPlay",
  "description": "…",
  "state": { "type": "Published", "timestampMs": 1789644765136 },
  "publishedAtMs": 1789644765136,
  "primaryArtists": ["Gateway Girl"],
  "cover": { "still": { "kind": "blob", "blobId": "nbLH…9aKU" }, "animated": null },
  "credits": [{ "partyId": "0x6ac5…0b86", "displayName": "Gateway Girl", "roles": ["Primary"] }],
  "genres": ["Electronic", "Alternative"],
  "tracks": [{
    "no": "1", "title": "Ghost", "splitBps": 3500,
    "recording": { "id": "0xccea…8fe1", "compositionId": "0xf9cb…4ab4" },
    "composition": { "id": "0xf9cb…4ab4", "title": "Ghost", "royaltyRate": { "value": 2000 } },
    "master": { "format": "flac", "channels": 2, "bit_depth": 24, "sample_rate_hz": 44100, "samples": "6221947" },
    "masterBlobId": "VwMO…UAE",
    "transcodeQuiltId": "h23-…PxLY"
  }],
  "trackCredits": {
    "0xccea…8fe1": {
      "compositionCredits": [{ "partyId": "0x6ac5…0b86", "displayName": "Rebekah Searle", "roles": ["Composer", "Songwriter", "Lyricist"] }],
      "recordingCredits": { "credits": [{ "partyId": "0x6ac5…0b86", "displayName": "Gateway Girl", "roles": ["Producer (Principal)"] }], "primaryArtistIds": ["0x6ac5…0b86"] }
    }
  }
}
```

## Party (`/parties/{id}`)

```json
{ "id": "0x6ac5…0b86", "kind": "individual", "name": "Rebekah Searle", "createdAtMs": 1789628321209 }
```

## Pressing and listing

```json
{ "id": "0xdd2c…216d", "releaseId": "0x3f3a…1cd8", "edition": 1, "supply": 1, "maxSupply": 1000 }
```

```json
{
  "id": "0xdd64…69d5", "pressingId": "0xdd2c…216d", "releaseId": "0x3f3a…1cd8",
  "pricing": { "kind": "floor", "amount": "20000000" },
  "currency": { "type": "0x7777…::fakeusd::FakeUsd", "symbol": "FAKEUSD", "decimals": 6 },
  "state": "enabled", "totalProceeds": "20000000"
}
```

## Owned Records (`/platform/wallets/{address}/records`)

```json
[{
  "id": "0x3eda…9798", "type": "0xf51a…::record::Record",
  "releaseId": "0x3f3a…1cd8", "pressingId": "0xdd2c…216d", "edition": 1, "number": 1,
  "purchaseCurrency": "0x7777…::fakeusd::FakeUsd", "purchasePrice": "20000000",
  "purchasedBy": "0xad69…795f", "purchasedTimestampMs": "1789632874379"
}]
```
