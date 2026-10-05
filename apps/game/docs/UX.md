# UX notes: Miso Records · After Hours

The point, made through play: a Record on Sui is a real object you can carry, play,
pay for, abuse and resell, and the chain round-trips are part of the fun, not a form.

## The loop

| Step | Player action | What they see | Chain call |
| --- | --- | --- | --- |
| 1 | Walk from the street into the shop | Door chime, street noise fades, mission "Dig through the crates" | none |
| 2 | E on a record | Big sleeve, artist, genre/year/label, description, price, edition bar (minted / max) | none |
| 3 | Pick up | Record in hand (3D + HUD card marked **UNPAID**) | none |
| 4 | E on the deck | Place / drop the needle / next track / lift / take back / swap; now-playing bar with HLS/SYNTH badge and 30 s progress | none (CDN audio only) |
| 5 | E at the counter → Pay | Summary → "Processing on Sui…" (clerk bubble in the world, spinner under the money) → receipt: Record id (copy), digest, explorer links, new balance | `purchase`, then `getWallet` + `listOwnedRecords` |
| 5b | Purchase fails | "The register jammed." + the adapter's message, **Retry** / Cancel. Nothing charged, record still in hand | |
| 6 | Try to leave unpaid | Invisible wall in the doorway + "Oi! Pay for that first." | none |
| 7 | E on a parked car (holding a record) | Swing, glass, alarm, big centre banner **RECORD CONDITION: STILL MINT** | none |
| 8 | E on the collector | "Sell *title* for N FUSD" (paid / offer / profit) → "The collector inspects the grooves…" → collector walks off with it, cash counts up green with a ka-ching, receipt toast with tx link | `sellToNpc`, then `getWallet` + `listOwnedRecords` |
| 9 | C | Collection read from the adapter (skeleton while loading, error + Retry), Hold / Put away, sales history | `listOwnedRecords` |

Mission text (top-left) and the waypoint (3D marker + minimap) always point at the next
step; the waypoint hides within 2.5 m of its target. Listening is suggested, never required.

## Rules the player can feel

- One physical object per release: it is on the shelf, in your hand, on the deck, or
  walking away with the collector. Buying mints a new Record; the shelf copy is stock.
- Unpaid stock never leaves the shop. Owned Records can be put away (collection) and
  taken out again (C → Hold).
- One transaction at a time. While a purchase or sale is pending the record is locked;
  closing the pending screen is fine, the HUD spinner keeps you informed and the
  result arrives as a toast.
- Every failure message comes from the adapter and is written for players; Retry is
  always the focused action.

## HUD layout (tuned at 1600×900 for a projector)

- Top-left: **MISSION** label + objective (≥ 22 px, outlined white).
- Top-right: money counter `FUSD 100.00` (≥ 40 px), animates over ~1 s, flashes green
  up / red down with a floating delta; pending spinner; network badge (MOCK CHAIN /
  SUI TESTNET) + short wallet address; mute badge.
- Bottom-left: circular north-up minimap (roads, buildings, shop highlighted, ♪ deck,
  $ counter, ★ collector, parked cars, traffic, pedestrians, waypoint with edge arrow).
- Bottom-centre: `[E] label` interaction prompt above the controls footer.
- Bottom-right: now-playing bar above the held-record card.
- Top-centre (below the mission): toasts; centre screen: big mission banners.

## Keyboard

WASD move · Shift sprint · E/Enter interact · N next track · I inspect · C collection ·
M mute · H help · Esc close. Menus: ↑↓ or W/S select, Enter/E/Space confirm, Esc close.
Everything works without a mouse; mouse look (L / drag) is optional. Menus freeze the
player but never the render loop.

## Onstage rehearsal

- `npm run build && npm run preview`, desktop Chrome, real projector resolution.
- `?latency=1500` makes the pending states readable from the back of the room;
  `?fail=purchase` (then reload without it) demos the error path.
- Reload the page to reset the mock chain (balance 100.00 FUSD).
