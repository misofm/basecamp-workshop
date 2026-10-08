# UX notes: Nozomi · Playback (Saisei Records)

Setting: a grungy, retrofuturist back street in Nozomi at dusk (Book 3, "As The World
Shook"; world bible §7). You are Gamer. Names on the street: **Saisei Records** (the shop),
**Jazz** (runs the counter), **TriMart** (the ATM is in its vestibule, next door), the **dead
Triangle sedan** (the smashable car, `car:0`), **Stonks** (the collector, BUYING table
across the street), **Inicio** (the friend at the listening bar; you take him home).

The point, made through play: a Record on Sui is a real object you can carry, play,
pay for, abuse and resell, and the chain round-trips are part of the fun, not a form.

**Player-facing copy never mentions the chain.** No "Sui", "blockchain", "chain",
"testnet", "wallet address", "object", "digest", "PTB", "gas", "faucet", "mint" (in the
chain sense) or "explorer" in the HUD, intro, missions, dialogs, toasts, help, collection,
in-world signs or error messages. Adapters reject with plain game language (see
`src/miso/testnet-adapter.ts`); developer detail goes to `console.warn`. Money is FakeUSD /
FUSD. ("Mint condition" is the vinyl sense and stays.)

## The loop

> **Note:** the overlays were restyled and the copy shortened (docs/UI-STYLE.md). Where this table
> disagrees with the game, UI-STYLE.md and the code win; the rows below are the older, longer wording.

| Step | Player action | What they see | Chain call |
| --- | --- | --- | --- |
| 0 | Intro | Dusk card (orange-to-violet, CRT scanlines): NOZOMI · "Book 3 — As The World Shook", level "Playback", the 57-word intro, "Buy a record. Smash a car with it. Sell it on.", loading lines, *Press Enter*, "Tamashi and Nozomi © Studio Mirai" | catalog + wallet reads |
| 1 | Spawn at the hotel side door (west end), walk east into Saisei Records | Mission "Get to Saisei Records, the record shop."; fire / diner / band / vending ambience mixed by distance; door chime, street noise fades, mission "Dig through the crates" | none |
| 2 | E on a record | Big sleeve, artist, genre/year/label, description, price, edition bar ("105 / 250 sold"), and Jazz's line on the section (`JAZZ: “…”`, `game/jazz-notes.ts`) | none |
| 3 | Pick up | Record in hand (3D + HUD card marked **UNPAID**) | none |
| 4 | E on the deck | Place / drop the needle / next track / lift / take back / swap; now-playing bar with HLS/SYNTH badge and 30 s progress | none (CDN audio only) |
| 5 | E at the counter (Jazz) → Pay | Summary ("Paid in FakeUSD. It's yours the moment the till rings.") → "Ringing it up…" (Jazz's bubble in the world, spinner under the money) → receipt "Paid in full. Bag's yours.": Record #N of max + *View record ↗*, Paid, Balance, "Receipt no." (short id) + *View receipt ↗* | `purchase`, then `getWallet` + `listOwnedRecords` |
| 5b | Purchase fails | "PAYMENT FAILED · The register jammed." + the adapter's message (e.g. "Couldn't complete the purchase — try again."), **Retry** / Cancel. Nothing charged, record still in hand | |
| 6 | Try to leave unpaid | Invisible wall in the doorway + "Oi! Pay for that first." | none |
| 7 | E on the dead Triangle sedan across the street (holding a record) | Swing, glass, alarm, big centre banner **RECORD CONDITION: STILL MINT** | none |
| 8 | E on Stonks (prompt "Talk to Stonks" / "Sell to Stonks") | Eyebrow STONKS, "Sell *title* for N FUSD" (paid / Stonks offers / profit; "Hand the record over and Stonks pays you in FakeUSD on the spot.") → "Stonks inspects the grooves…" / "Closing the deal" → he takes it inside, cash counts up green with a ka-ching, toast "Sold *title*" with *View receipt ↗*. Fails? "SALE FAILED · The deal fell through." + **Retry** | `sellToNpc`, then `getWallet` + `listOwnedRecords` |
| 8b | E at the ATM in TriMart's vestibule, next door (any time, holding a record or not) | "FakeUSD ATM" · CRT greeting "WELCOME BACK, KA▒▒▒ TAKAHA▒▒" glitches, then resolves to "ACCOUNT HOLDER: GAMER" + *(You angle the screen away.)* · "Withdraw 50 FUSD in cash." · "FakeUSD is play money: free to withdraw, no real money involved." → *Withdraw 50 FUSD* → "Counting out your FakeUSD" → receipt "50.00 FUSD in your pocket.": Withdrew, Balance, "Receipt no." + *View receipt ↗*; cash counts up green with a ka-ching. Fails? "ATM ERROR" + adapter's message (e.g. "The ATM couldn't reach the bank.") + **Retry** / Cancel | `withdrawFakeUsd`, then `getWallet` |
| 9 | E at the hotel door after a sale (prompt "Head home with Inicio"; mission "Job done. Head home with Inicio: hotel door, west end. (C: collection)") | The boom from the facility (camera shake, a brown-out), iron footsteps far away a second later, the band falls silent → title card **Book 3 — Dawn of the Machin** ("Nozomi · Tamashi and Nozomi © Studio Mirai", *Press Enter*; Enter / Esc / click dismiss) → mission "Home. Press H to reset the demo." Free to walk on. Only after a sale, never while a transaction is pending, once per session | none |
| 10 | C | "YOUR RECORDS": collection read from the adapter (skeleton + "Flipping through your records…", error + Retry), #serial · *View record ↗*, Hold / Put away, sales history (title + paid) | `listOwnedRecords` |

Mission text (top-left) and the waypoint (3D marker + minimap) always point at the next
step; the waypoint hides within 2.5 m of its target. Listening is suggested, never required.
When the known balance can't cover the cheapest record (empty-handed) or the held unpaid
record, the mission reads "Short on FakeUSD. Hit the ATM in TriMart, next door." and the
waypoint points at the ATM.

## The ATM (FakeUSD on demand)

- A chunky beige ATM with a CRT screen against the back wall of TriMart's open vestibule,
  next door (east) to Saisei Records; minimap blip ¤ (blue). Prompt: `[E] Withdraw FakeUSD`.
- One withdrawal = 50 FUSD (`ATM_WITHDRAW_AMOUNT` in `game/flows/atm-flow.ts`). It is an
  ordinary chain op (`withdraw` in state.ts): blocked while a purchase or sale is pending,
  never locks the record in your hands.
- No silent mints anywhere: when the balance is known to be short, the counter does not
  call the chain and says "Not enough FakeUSD — the ATM in TriMart next door dispenses
  cash." (an adapter "Not enough FakeUSD" rejection gets the hint "The ATM in TriMart next
  door dispenses cash." unless it already mentions the ATM).

## Rules the player can feel

- One physical object per release: it is on the shelf, in your hand, on the deck, or
  walking away with Stonks. Buying mints a new Record; the shelf copy is stock.
- Unpaid stock never leaves the shop. Owned Records can be put away (collection) and
  taken out again (C → Hold).
- One transaction at a time (purchase, sale or ATM withdrawal). While a purchase or sale is pending the record is locked;
  closing the pending screen is fine, the HUD spinner keeps you informed and the
  result arrives as a toast.
- Every failure message comes from the adapter and is written for players; Retry is
  always the focused action. The main mappings:

  | Situation | Player sees |
  | --- | --- |
  | Purchase rejected / unknown failure | "Couldn't complete the purchase — try again." |
  | Short on FakeUSD | "Not enough FakeUSD — … The ATM outside dispenses cash." |
  | Network down | "The shop's connection dropped. Check your internet and try again." |
  | Timeout | "The shop took too long to answer. Try again." |
  | Player out of gas, keys missing / invalid | "The shop's till is offline right now. Try again later." |
  | Collector (game key) out of gas | "The collector has your record but hasn't paid yet: The collector's till is offline right now. Press Retry…" |
  | ATM failure | "The ATM couldn't reach the bank. Try again." |
  | Sale rejected | "The sale didn't go through. You still own the record." |
  | Shop file broken | "The shelves aren't stocked right now. Try reloading in a moment." |

## HUD layout (tuned at 1600×900 for a projector)

- Top-left: **MISSION** label + objective (≥ 22 px, outlined white).
- Top-right: money counter `FUSD 100.00` (≥ 40 px), animates over ~1 s, flashes green
  up / red down with a floating delta; pending spinner ("Ringing it up…", "Closing the
  deal…", "Withdrawing FakeUSD…"); mute badge. No connection indicator is shown (the game is
  always on testnet; the address is only in `data-address` for developers).
- Intro: dusk card (see step 0): kicker, the intro text, the
  pitch, loading lines "N records in the crates" and "Cash: 100.00 FUSD".
- Bottom-left: circular north-up minimap (roads, buildings, shop highlighted, ♪ deck,
  $ counter, ★ Stonks, ¤ ATM in TriMart, ⌂ hotel door (only once the exit beat is open),
  the sedan, pedestrians, waypoint with edge arrow). No traffic: nothing drives any more.
- Bottom-centre: `[E] label` interaction prompt above the controls footer.
- Bottom-right: now-playing bar above the held-record card.
- Top-centre (below the mission): toasts; centre screen: big mission banners.

## Keyboard

WASD move · Shift sprint · Space jump · E/Enter interact · arrows camera · N next track · I inspect ·
C collection · M mute · H help · Esc close. Menus: ↑↓ or W/S select, Enter/E/Space confirm, Esc close.
C / H / I toggle their screen. Audit and rules: docs/CONTROLS-AUDIT.md, docs/STATE-MODEL.md.
Everything works without a mouse; mouse look (L / drag) is optional. Menus freeze the
player but never the render loop.

## Onstage rehearsal

- `npm run build && npm run preview`, desktop Chrome, real projector resolution.
- The game always runs on Sui testnet (keyed build, see README "Connecting the shop to Miso testnet"); there is no
  offline mode. The pending states and errors are real testnet timings and failures.
- Reload the page (or H → Reset demo) to reset the exit beat. The testnet wallet keeps its
  balance and collection across reloads.
- The error / Retry paths with injected failures (`?fail=`, `?latency=`) exist only in the
  e2e test build (MockAdapter, `vite build --mode e2e`), not in anything you rehearse with.
