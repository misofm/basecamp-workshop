# Nozomi UI: style + copy spec

The world is a grungy, retrofuturist Tokyo back street at dusk (Nozomi, chapter 3.0). The
UI currently looks like a modern web app (rounded slate cards, gold pills, eyebrow labels,
footer hints). Make every overlay feel like an object from that street, and say less.

## 1. Visual language

Two families of overlay, chosen by what the moment is:

**A. CRT terminal** (machines: ATM, the shop's register screen while paying, errors from a
machine, the collection list, help/controls). It is a Tamashi-era CRT:
- Near-black glass (#0b0f0c) with a 2px bezel in dark enamel (#1d1a17) and a soft inner glow.
- Phosphor text: amber (#ffb547) for ATM and register, green (#7dff9a) for the collection
  and help. Monospace for everything on the glass (e.g. "JetBrains Mono" / "IBM Plex Mono",
  bundled locally, or the system monospace stack).
- Scanlines (repeating-linear-gradient, 2–3px, ~6% opacity), slight barrel vignette, a 1-frame
  flicker on open, a faint text glow (text-shadow in the phosphor color).
- Square corners. No pills. Selected option = inverted block (phosphor background, black text)
  with a blinking `▮` cursor.
- Pending state: a scrolling `PROCESSING ▮▮▮▯▯` bar or blinking dots, not a spinner.

**B. Paper and enamel** (people and things: picking up a record, Jazz at the counter's
receipt, Stonks's offer, the loading screen, speech bubbles):
- Aged paper (#efe6d2 with a subtle noise/grain texture and a darker fibrous edge) or a
  weathered enamel shop plate (deep red #8f1d1d / navy #1f2a44 with chipped white lettering).
- Slightly rotated (−1.5° to 1.5°), hard shadow offset (no blur glow), masking-tape or pin
  details on corners where it fits.
- A red hanko-style stamp for confirmations: circular/square red (#c0392b) stamp with 済
  (done) or 領収 (received) plus a small English word (PAID / SOLD), slightly rotated and
  semi-transparent like real ink.
- Record dialog = a shop price tag: torn top edge, hole with string, price in a bold
  hand-stamped style.
- Typography: a condensed bold sans for titles (the existing display font is fine if
  condensed/uppercase is used), body in the existing sans; small bilingual tags use the
  existing Japanese signage subset font (src/world/signage.ts font). Keep Japanese to
  short labels that already exist in docs/SIGNAGE.md vocabulary or are trivially correct
  (領収書 receipt, 買取 buying, 試聴 listen, 現金 cash, 済 done); add any new ones to the
  SIGNAGE review list.

**HUD** (always on screen):
- Mission: a strip of masking tape / torn paper note in the top-left with marker-style text.
- Money: an amber vacuum-fluorescent (VFD) / 7-segment readout in a dark metal bezel,
  `¥`-free: `FUSD 0100.00` style with leading zeros dimmed.
- Controls bar: square keycaps like an old arcade cabinet label, smaller, lower contrast.
- No connection indicator: the game is testnet-only, nothing about the network is shown.
- Speech bubbles: hand-cut paper or a small paper lantern tag with the speaker's name stamped.
- Minimap: frame it like a station map plate (enamel ring, Japanese-style N marker).

**Motion**: overlays open with a quick 120ms step (CRT power-on line → full for A; paper
drops in with a 3° settle for B). Respect `prefers-reduced-motion`.

**Readability on a projector is non-negotiable**: body ≥ 22px at 1080p, titles ≥ 40px,
contrast ≥ 4.5:1, grain/scanlines never under small text at more than ~6% opacity.

## 2. Copy rules

- One title (≤ 4 words), at most one line of body (≤ 12 words), one primary action.
- Drop eyebrow labels ("PAID · RECEIPT", "STREET ATM · FAKEUSD") unless they are a short
  bilingual stamp/tag that adds flavor.
- Drop footer hint lines ("↑↓ select · Enter confirm · Esc close"); put the key on the
  button itself as a keycap (`[E]`, `[Esc]`).
- No explanations of the system. Don't explain FakeUSD, offline mode or links in dialogs.
- Numbers only when they change a decision: price, balance after, edition number.
- Missions ≤ 6 words, imperative ("Get cash at the ATM.", "Find a record.", "Pay Jazz.",
  "Take it outside.", "Sell to Stonks.", "Head home with Inicio.").
- Errors ≤ 8 words, human ("Card reader jammed. Try again." for a machine, "Jazz frowns:
  short on cash." for money).
- Characters speak in their own voice (short, specific, no exclamation marks spam).
- Keep the "View receipt ↗" link as the single small link on the receipt.

### Target copy for the main moments (adapt names/values from the code)

| Moment | Title | Body | Actions |
|---|---|---|---|
| ATM | ATM | Balance 100.00 → 150.00 | [E] Withdraw 50 · [Esc] Back |
| ATM done | 済 CASH OUT | +50.00 FUSD | [E] OK |
| Record tag | Low Tide Tapes | Harbor Lights · #106/250 | [E] Pick up · [Esc] Put back |
| Turntable | Now playing | Ferry at Dawn | [N] Next · [E] Lift needle |
| Counter | Low Tide Tapes | 12.00 FUSD · you'll have 138.00 | [E] Pay · [Esc] Not yet |
| Paying | PROCESSING | — | — |
| Receipt | 領収 PAID | Low Tide Tapes · #106/250 · 12.00 FUSD | [E] Take it outside · View receipt ↗ |
| Stonks offer | Stonks wants it | 18.00 FUSD for Low Tide Tapes | [E] Sell · [Esc] Keep |
| Sold | 済 SOLD | +18.00 FUSD | [E] OK |
| Collection | MY RECORDS | list rows: cover · title · #no | [Esc] Close |
| Help | CONTROLS | keycap grid only | [Esc] Close |

## 3. As implemented

- **Loading screen** (replaces the old intro card): a paper card with a small "NOZOMI · 再生" mark,
  a loading bar driven by real progress (catalog 2 / assets 5 / pipeline warm-up 3, each creeping
  towards ~90 % until it settles), then "Press [Enter] to continue" (a click works). No story text,
  checklist or controls list. Enter is swallowed and starts the game and audio. `?ui=0` still shows it.
- **Skins**: ATM, counter, pending, machine errors = amber CRT; collection, help = green CRT;
  record tag = price tag; receipt, Stonks, sold, loading screen = paper (red hanko stamp for 領収 PAID
  and 済 SOLD); turntable = navy enamel plate. Bubbles in the world are hand-cut paper with a stamped name.
- **Sizes** use `--u` (1 u = 1 px at 1600x900, scales with the window): body 24-26 u, titles 44 u.
- **Keys on buttons**: `[E]` for the focused/primary action, `[Esc]` for the closing one, `[N]` on
  Next (a real hotkey). No footer hint lines.
- **U** hides the whole overlay (HUD, minimap, prompts, toasts, waypoint, interaction ring, bubbles)
  for clean screenshots; dialogs still show normally and U is ignored while one is open.
  `?ui=0` starts hidden.
- Japanese UI strings (再生 済 領収 北) live in `SIGNS` (`ui*` keys) so the font subset and the
  review list in docs/SIGNAGE.md cover them.
- Kept beyond the table: the ATM's CRT greeting line and the single small "View receipt ↗" link
  on the ATM / receipt / sold screens; a small "Reset demo" action on the help screen.
