# State model: Nozomi · Playback

What the game can be in, what moves it, and what must never happen. The code is
`src/game/state.ts` (pure, one transition function `step()`), the UI layers in
`src/game/controller.ts` + `src/ui/*`, and the chain calls in `src/game/flows/*`.
The tests that pin this document down are `tests/unit/state-machine.spec.ts` (every
state × every event), `tests/unit/input-routing.spec.ts` (layers and keys) and
`tests/e2e/state-safety.spec.ts` (the nasty sequences in a real build).

The game is three orthogonal pieces:

1. **Game state** (`GameState`, pure data): where each record is, what you own, the one
   chain operation in flight, smashed cars, the exit beat.
2. **UI layers** (controller + DOM): which overlay owns the keyboard.
3. **Async transactions**: a chain call between `xStart` and `xSuccess` / `xFail`.

## 1. Game state

| Field | Values | Notes |
| --- | --- | --- |
| `hand` | `null` · `{ shopRecordId, recordId: null }` (unpaid stock) · `{ shopRecordId, recordId }` (owned Record) | |
| `deck` | `null` · same shape as `hand` | |
| `playing` | `null` · `{ trackIndex }` | only while `deck` is set |
| `owned` | `OwnedRecord[]` | cache of chain truth, newest first |
| `sold` | `{ recordId, shopRecordId, npcId, paid }[]` | this session's sales |
| `buyerAway` | `null` · `{ npcId, shopRecordId }` | the collector carrying the last sale away |
| `op` | `null` · `{ kind, status: "pending", targetId? }` · `{ kind, status: "error", error, targetId? }` | one at a time; `kind` = purchase · sell · withdraw · catalog · wallet · collection |
| `balance` | `null` (unknown) · `bigint ≥ 0` | FakeUSD base units |
| `zone` | `street` · `shop` | reported by the world |
| `smashedCars`, `listened`, `prices`, `lastReceipt`, `wentHome` | | |

Derived: `recordPlace(id)` = `hand` › `deck` › `npc` (buyerAway) › `shelf`.
`handLocked` = a **purchase or sale** is pending (a withdrawal never locks the hand).
`canLeaveShop` = not holding unpaid stock (the world turns on the doorway wall).

### Transition table

`step(state, event)` returns `{ state, rejected }`. **Rejected** = same object back plus a
reason (the controller prints it as a dev-console warning; never a crash, never a partial
change). **No-op** = same object, not an error. Anything not listed as a guard is accepted.
"Clears a stale error" means: if `op` is a purchase/sell *error*, it becomes `null` (the
error was about the record that was in your hand).

| Event | Accepted when (guards) | Effect |
| --- | --- | --- |
| `pick(id)` | hand not locked · not holding an owned Record · `id` is on the shelf | hand = unpaid `id` (unpaid stock in hand goes back to its shelf) · clears a stale error |
| `putBack` | hand not locked · holding unpaid stock | hand = null · clears a stale error |
| `placeOnDeck` | hand not locked · hand set · deck empty | deck = hand, hand = null, playing = null · clears a stale error |
| `takeFromDeck` | hand not locked · deck set · hand empty | hand = deck, deck = null, playing = null · clears a stale error |
| `swapWithDeck` | hand not locked · hand and deck set | exchange, playing = null · clears a stale error |
| `holdOwned(recordId)` | hand not locked · Record owned · not holding an owned Record · that Record / release not on the deck · release not with the collector | hand = that Record (unpaid stock goes back) · clears a stale error |
| `stowOwned` | hand not locked · holding an owned Record | hand = null · clears a stale error |
| `play(track?)` | deck set | playing = track (≥ 0), release marked listened |
| `nextTrack(n)` | playing · n ≥ 1 | track = (track + 1) mod n |
| `stop` | always | playing = null (no-op if silent) |
| `purchaseStart` | nothing pending · holding unpaid stock | op = purchase pending (target = that release); a previous error is replaced |
| `purchaseSuccess(owned, balance?)` | purchase pending · holding unpaid stock of `owned.shopRecordId` | hand = the Record, owned += it, balance = new (null keeps the known one), op = null, receipt |
| `purchaseFail(msg)` | purchase pending | op = purchase error(msg); hand unchanged |
| `sellStart(npc)` | nothing pending · holding an owned Record · that buyer is not away | op = sell pending |
| `sellSuccess(paid, balance?)` | sale pending · holding an owned Record | hand = null, owned −= it, sold += it, buyerAway = it, balance, op = null, receipt |
| `sellFail(msg)` | sale pending | op = sell error(msg); you keep the Record |
| `withdrawStart` | nothing pending | op = withdraw pending |
| `withdrawSuccess(amount, balance?)` | withdrawal pending | balance, op = null, receipt |
| `withdrawFail(msg)` | withdrawal pending | op = withdraw error(msg) |
| `buyerReturned(npc)` | always | buyerAway = null if it was that buyer (else no-op: timer and "return now" can both fire) |
| `loadStart(kind)` / `loadFail(kind)` | nothing pending / that read pending | read op pending / error (unused by the UI today) |
| `catalogLoaded(prices)` | always | prices; ends a pending catalog read |
| `collectionLoaded(list)` | always | owned = list **minus Records sold this session, plus the Record in hand / on the deck if the read missed it**; ends a pending collection read |
| `walletLoaded(balance)` | balance ≥ 0 | balance; ends a pending wallet read |
| `smash(car)` | holding a record · hand not locked · car not smashed yet | car smashed |
| `setZone(z)` | always | zone (no-op if unchanged) |
| `dismissError` | always | op = null if it was an error (no-op otherwise: a Retry may already be pending) |
| `goHome` | at least one sale · nothing pending · not home yet | wentHome = true |
| `reset` | always | initial state |

### Invariants (`invariantViolations(state)` returns the broken ones)

Every state reachable from `initialState()` satisfies all of these; the controller checks
them after every accepted transition in dev builds.

1. `playing` ⇒ a record is on the deck.
2. One physical object per release: hand, deck and the collector never hold the same release.
3. A Record in hand or on the deck is in `owned`, and belongs to that release.
4. The same Record is never both in hand and on the deck; `owned` has no duplicates.
5. A Record sold this session is never in `owned` (sold ⇒ not owned, not holdable).
6. Purchase pending ⇒ holding unpaid stock of exactly the release being bought.
7. Sale pending ⇒ holding an owned Record.
8. An error op always carries a player-safe message.
9. `balance` is null or ≥ 0.
10. `wentHome` ⇒ at least one sale.
11. A car is smashed at most once.

World-enforced (not representable in pure state, covered by e2e): unpaid stock never
reaches the street (the doorway wall is on whenever `canLeaveShop` is false; the record
stands are > 1.35 m from the doorway, so nothing can be picked up inside it).

## 2. UI layers (who owns the keyboard)

Highest first. A layer that is up takes every key it handles in the capture phase and stops
it; nothing below sees it.

| Layer | Up while | Keys it takes | Leaves to the browser |
| --- | --- | --- | --- |
| Loading screen (`ui/intro.ts`) | until Enter / click after "ready" | **all** (Enter / click start, only once ready) | F-keys, Ctrl/Cmd/Alt chords |
| Title card (`ui/title-card.ts`) | after the exit beat until dismissed | **all** (Enter / Space / Esc / click dismiss) | F-keys, Ctrl/Cmd/Alt chords |
| Dialog (`ui/dialogs.ts`, modal) | a menu is open | arrows, WASD, Home/End, Tab, Enter/E/Space, Esc, the screen's hotkeys (N) | everything else; C / H / I close their own screen; M mutes |
| Scripted moment | smash swing; exit beat (boom → card) | world input frozen (beat) / no menus may open (C, H, I, E refused) | M, N |
| World | otherwise | WASD/Shift move, Space jump, E/Enter interact, arrows/+/−/Home camera, L mouse look, C/H/I/U/M/N | |

Rules:

- Opening any layer above the world freezes the player: held keys are released, a crouch
  is cancelled (a jump already in the air finishes its arc), pointer lock is released.
- Closing a dialog returns focus to where it was (or nowhere), never to a removed node.
- Window blur / tab hidden releases all held keys and drags; audio suspends while hidden.
- One-shot actions (interact, confirm, jump, C/H/I/U/M/N/L) never fire on key auto-repeat.
- While a purchase, sale or withdrawal is pending the overlay is forced visible and **U** is
  ignored, so its spinner and its result (toast or dialog) are never hidden.

## 3. Transactions

```
idle ──xStart──► pending ──adapter resolves──► xSuccess ──► idle (+ receipt)
                    │
                    └──adapter rejects──► error ──Retry (xStart)──► pending
                                            └──Esc / Back (dismissError) / hand changes──► idle
```

- **One at a time.** `xStart` is refused while anything is pending. The counter and Stonks
  say "One thing at a time." instead of offering a dead button; the ATM already did.
- **Double confirm.** The first Pay / Sell / Withdraw / Retry swaps the dialog to the
  pending screen synchronously (no buttons left to hit), and a second `xStart` is refused
  by the state machine anyway: one charge, one Record.
- **Esc during pending** closes the screen only. The HUD spinner stays; the result arrives
  as a toast (or in the dialog if you reopen that station). The hand stays locked, the
  doorway stays shut for unpaid stock, jumping and smashing are refused, Reset demo is
  disabled, U is ignored.
- **Failure.** The adapter's player-safe message + Retry (focused) / Back. After any failure
  the wallet (and for purchase / sale the collection) is re-read, so a transaction that
  landed but whose answer was lost never leaves a stale balance.
- **Lost answer** (landed on chain, response timed out): Retry of a purchase or sale returns
  the earlier result (testnet: stored digest; mock: `?fail=purchase-lost|sell-lost`), so
  nothing is charged or paid twice. If you don't retry, the re-read collection already
  shows the Record and you can hold it from C. The earlier answer is only handed back while
  that Record is unsold (selling it and buying the release again is a new purchase), and the
  state machine refuses a `purchaseSuccess` for a Record sold this session. A lost ATM withdrawal retried dispenses
  again (testnet has no idempotency for the faucet; play money, accepted).
- **Sale half done** (testnet: Record transferred, payout failed): the pending sale is kept
  in `localStorage` before each submission; the Record stays in your hand and collection
  and Retry pays exactly once (`src/miso/testnet/sell.ts`). A reload keeps that entry.
- **Reload / Reset demo mid-transaction**: Reset is disabled while a transaction is
  pending. A browser reload (F5) is still possible: mock state is in memory (a reload is a
  fresh wallet); on testnet the transaction may still land and is picked up from chain on
  the next load (pending sales from `localStorage`).
- **Results arriving late**: a success whose dialog was closed becomes a toast; a result for
  an action the state machine no longer accepts is refused (no-op + dev warning).
