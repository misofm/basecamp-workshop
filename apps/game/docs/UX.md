# UX notes: Miso Records · After Hours

The point, made through play: a Record on Sui is a real object you can carry, play,
pay for, abuse and resell, and the chain round-trips are part of the fun, not a form.

**Player-facing copy never mentions the chain.** No "Sui", "blockchain", "chain",
"testnet", "wallet address", "object", "digest", "PTB", "gas", "faucet", "mint" (in the
chain sense) or "explorer" in the HUD, intro, missions, dialogs, toasts, help, collection,
in-world signs or error messages. Errors are mapped to plain game language
(`src/miso/testnet/errors.ts`); developer detail goes to `console.warn`. Money is FakeUSD /
FUSD. ("Mint condition" is the vinyl sense and stays.)

## The loop

| Step | Player action | What they see | Chain call |
| --- | --- | --- | --- |
| 1 | Walk from the street into the shop | Door chime, street noise fades, mission "Dig through the crates" | none |
| 2 | E on a record | Big sleeve, artist, genre/year/label, description, price, edition bar ("105 / 250 sold") | none |
| 3 | Pick up | Record in hand (3D + HUD card marked **UNPAID**) | none |
| 4 | E on the deck | Place / drop the needle / next track / lift / take back / swap; now-playing bar with HLS/SYNTH badge and 30 s progress | none (CDN audio only) |
| 5 | E at the counter → Pay | Summary ("Paid in FakeUSD. It's yours the moment the till rings.") → "Ringing it up…" (clerk bubble in the world, spinner under the money) → receipt "Paid in full. Bag's yours.": Record #N of max + *View record ↗*, Paid, Balance, "Receipt no." (short id) + *View receipt ↗* | `purchase`, then `getWallet` + `listOwnedRecords` |
| 5b | Purchase fails | "PAYMENT FAILED · The register jammed." + the adapter's message (e.g. "Couldn't complete the purchase — try again."), **Retry** / Cancel. Nothing charged, record still in hand | |
| 6 | Try to leave unpaid | Invisible wall in the doorway + "Oi! Pay for that first." | none |
| 7 | E on a parked car (holding a record) | Swing, glass, alarm, big centre banner **RECORD CONDITION: STILL MINT** | none |
| 8 | E on the collector | "Sell *title* for N FUSD" (paid / offer / profit; "Hand the record over and the collector pays you in FakeUSD on the spot.") → "The collector inspects the grooves…" / "Closing the deal" → collector walks off with it, cash counts up green with a ka-ching, toast "Sold *title*" with *View receipt ↗*. Fails? "SALE FAILED · The deal fell through." + **Retry** | `sellToNpc`, then `getWallet` + `listOwnedRecords` |
| 8b | E at the FakeUSD ATM (sidewalk, left of the shop door; any time, holding a record or not) | "FakeUSD ATM" · "Withdraw 50 FUSD in cash." · "FakeUSD is play money: free to withdraw, no real money involved." → *Withdraw 50 FUSD* → "Counting out your FakeUSD" → receipt "50.00 FUSD in your pocket.": Withdrew, Balance, "Receipt no." + *View receipt ↗*; cash counts up green with a ka-ching. Fails? "ATM ERROR" + adapter's message (e.g. "The ATM couldn't reach the bank.") + **Retry** / Cancel | `withdrawFakeUsd`, then `getWallet` |
| 9 | C | "YOUR RECORDS": collection read from the adapter (skeleton + "Flipping through your records…", error + Retry), #serial · *View record ↗*, Hold / Put away, sales history (title + paid) | `listOwnedRecords` |

Mission text (top-left) and the waypoint (3D marker + minimap) always point at the next
step; the waypoint hides within 2.5 m of its target. Listening is suggested, never required.
When the known balance can't cover the cheapest record (empty-handed) or the held unpaid
record, the mission reads "Short on FakeUSD. Hit the ATM outside the shop." and the
waypoint points at the ATM.

## The ATM (FakeUSD on demand)

- A lit kiosk ("FakeUSD ATM" topper, green "FakeUSD · CASH · 24 HRS" screen) on the sidewalk just west of the shop
  door, visible from the spawn; minimap blip ¤ (blue). Prompt: `[E] Withdraw FakeUSD`.
- One withdrawal = 50 FUSD (`ATM_WITHDRAW_AMOUNT` in `game/flows/atm-flow.ts`). It is an
  ordinary chain op (`withdraw` in state.ts): blocked while a purchase or sale is pending,
  never locks the record in your hands.
- No silent mints anywhere: when the balance is known to be short, the counter does not
  call the chain and says "Not enough FakeUSD — the ATM outside dispenses cash." (an
  adapter "Not enough FakeUSD" rejection gets the same hint).

## Rules the player can feel

- One physical object per release: it is on the shelf, in your hand, on the deck, or
  walking away with the collector. Buying mints a new Record; the shelf copy is stock.
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
  deal…", "Withdrawing FakeUSD…"); a tiny dot + "online" (testnet) / "offline demo" (mock)
  indicator (no address; it is only in `data-address` for developers); mute badge.
- Intro: kicker + the same small indicator, "Buy a record. Smash a car with it. Sell it
  on.", loading lines "N records in the crates" and "Cash: 100.00 FUSD".
- Bottom-left: circular north-up minimap (roads, buildings, shop highlighted, ♪ deck,
  $ counter, ★ collector, ¤ ATM, parked cars, traffic, pedestrians, waypoint with edge arrow).
- Bottom-centre: `[E] label` interaction prompt above the controls footer.
- Bottom-right: now-playing bar above the held-record card.
- Top-centre (below the mission): toasts; centre screen: big mission banners.

## Keyboard

WASD move · Shift sprint · Space jump · E/Enter interact · N next track · I inspect ·
C collection · M mute · H help · Esc close. Menus: ↑↓ or W/S select, Enter/E/Space confirm, Esc close.
Everything works without a mouse; mouse look (L / drag) is optional. Menus freeze the
player but never the render loop.

## Onstage rehearsal

- `npm run build && npm run preview`, desktop Chrome, real projector resolution.
- `?latency=1500` makes the pending states readable from the back of the room;
  `?fail=purchase` (then reload without it) demos the error path; `?fail=withdraw` does
  the same for the ATM.
- Reload the page to reset the mock chain (balance 100.00 FUSD).
