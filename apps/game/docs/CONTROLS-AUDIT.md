# Controls audit: Nozomi · Playback

Every input binding in every context, checked against common conventions for third-person
keyboard + mouse games, before the stage build was locked. Scope: navigation and input
routing only; the look and the features are unchanged. The keyboard ownership model behind
this table is in [STATE-MODEL.md](STATE-MODEL.md) §2.

Verdicts: **OK** (meets the convention) · **Fixed** (was wrong, fixed on `fix/nav-state-audit`)
· **Left** (deliberate, reason given) · **Doc** (code right, docs were wrong).
Tests: `tests/unit/input-routing.spec.ts` (DOM, layers, keys), `tests/unit/state-machine.spec.ts`
(state rules), `tests/e2e/state-safety.spec.ts` (real build), `tests/unit/dialog-keys.spec.ts`.

## Loading screen and title card

| # | Binding / context | Expected | Actual (before) | Verdict | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Any key before "Press Enter" is ready | Ignored, nothing reaches the game | Swallowed in the capture phase | OK | |
| 2 | Enter / click once ready | Starts once; held Enter does not start twice | Starts once; repeat ignored | OK | |
| 3 | F5, Ctrl/Cmd+R, F11, dev tools while loading or on the title card | Browser shortcuts keep working (a hung load must be reloadable) | `preventDefault()` on every key blocked reload and fullscreen shortcuts | Fixed | Overlays still stop every key from reaching the game but leave F-keys and Ctrl/Cmd/Alt chords to the browser (`isBrowserShortcut`) |
| 4 | Title card: Enter / Space / Esc / click | Any of them dismisses; nothing else leaks | Same | OK | |
| 4a | E right after dismissing the title card or the loading screen | Works at once | The fading overlay's button kept focus for 500–600 ms; the world ignores E/Enter on a focused button, and a menu opened meanwhile gave focus back to it on close (E dead) | Fixed | Overlays blur their button when dismissed |

## World (free roam, carrying a record)

| # | Binding / context | Expected | Actual (before) | Verdict | Fix |
| --- | --- | --- | --- | --- | --- |
| 5 | W A S D, Shift | Camera-relative walk, sprint while held | Same | OK | |
| 6 | Arrow keys | Often a second movement set | Orbit / pitch the camera (keyboard-only camera; the game is fully playable without a mouse). README claimed "W A S D (or arrows): Walk" | Doc | Kept the behaviour (arrows-as-movement would leave keyboard players without a camera); README controls table corrected |
| 7 | Mouse: drag to look, L pointer lock, wheel / + − zoom, Home reset | Standard; pointer lock released whenever a menu or overlay opens | Same (`setBlocked` exits pointer lock) | OK | |
| 8 | Space | Jump, edge-triggered; not in menus, mid-swing or while a transaction is pending | Same (jump buffer, no double jump) | OK | |
| 9 | E / Enter | Interact with the nearest enabled interactable, once per press | Same; but Ctrl/Cmd/Alt+Enter also interacted | Fixed | Modifier chords ignored |
| 10 | Esc with nothing open | Usually opens a pause menu | No-op (the browser uses it to leave pointer lock) | Left | H is the help/pause screen; adding an Esc menu is a new feature and would fight pointer-lock release |
| 11 | C / H / I | Same key opens and closes its screen | C and H toggled; I only opened (I again did nothing) | Fixed | I toggles inspect |
| 12 | C / H / I during the smash swing, or between the boom and the title card | No menu over a scripted moment | Menus opened: inspect → "Put away" mid-swing emptied the hand mid-air; help opened under the title card and took Enter/Esc first, with "Reset demo" one arrow away | Fixed | Menus and E are refused during the swing and the whole exit beat |
| 13 | U (hide overlay) | Screenshot toggle, but never hides something that needs the player | Hid the pending spinner and the failure toast of a transaction in flight | Fixed | While a purchase / sale / withdrawal is pending the overlay is forced visible and U is ignored |
| 14 | M, N | Mute anywhere; next track at / while playing the deck | Same | OK | |
| 15 | Key auto-repeat on one-shot actions (E, Enter, Space, C, H, I, U, M, N, L) | Never repeats the action | All check `e.repeat` | OK | |
| 16 | Keys held when a menu / overlay opens or closes | Released, no "stuck walking" | Released on block; auto-repeat resumes walking if still held | OK | |
| 17 | Window blur, tab hidden | Release all keys and drags; audio suspends | Same | OK | |
| 18 | macOS Cmd chords while walking (Cmd+Shift+4 screenshot, Cmd+A) | No stuck movement | A letter released while Cmd is down gets no keyup: the player walked forever | Fixed | Movement ignores Ctrl/Cmd chords; Cmd keyup clears held keys |
| 19 | Alt/Cmd+Arrow (browser back) during play | Must not navigate away mid-demo | Movement handler prevents it | OK | Kept |
| 20 | Interaction prompt | Shows the right key and verb | "[E] Pay Jazz", "[E] Smash"…; Enter also works | OK | |
| 21 | Walking out with unpaid stock | Blocked with feedback | Doorway wall + "Oi! Pay for that first."; no record stand is within reach of the doorway | OK | |
| 22 | Jump while carrying / near interactables | Allowed, harmless | Same | OK | |

## Menus (record tag, turntable, counter, ATM, Stonks, collection, inspect, help)

| # | Binding / context | Expected | Actual (before) | Verdict | Fix |
| --- | --- | --- | --- | --- | --- |
| 23 | ↑ ↓ ← → / W A S D, Home / End, Tab | Move selection (wrap), Tab trapped in the modal | Same | OK | |
| 24 | Enter / E / Space | Confirm the focused action, once per press | Same; repeat ignored | OK | |
| 25 | Esc | Closes the topmost menu, never destructive, same as the "back" button | Every Esc button (Not yet, Back, Keep, Close, Put back) only closes | OK | |
| 26 | Keys outside the menu set | Never reach the world | Movement / E / Space / L / zoom blocked; C / H / I close their own screen; M mutes | OK | |
| 27 | Focus | Visible, starts on the primary action, remembered when a screen refreshes, returned on close | Same (per-skin focus styles; selection kept by action id) | OK | |
| 28 | Mouse parity | Every action clickable | Same; backdrop clicks pull focus back | OK | |
| 29 | Keycap on buttons | Key shown where it acts | `[E]` stays on the primary button when focus moves to another one (E then activates the focused button) | Left | Moving keycaps is a visual change; the focus highlight shows the target |
| 30 | Rapid double confirm (Pay / Sell / Withdraw / Retry, keys or double click) | One transaction | The first press swaps to the pending screen synchronously; a second start is refused by the state machine | OK | Now covered by tests |
| 31 | Pay / Sell while another transaction is pending | Not offered | The menu offered Pay / Sell; the button did nothing | Fixed | "One thing at a time." (as the ATM already said) |
| 32 | Help → Reset demo | Destructive actions guarded | Reachable with ↓ Enter at any time, also mid-transaction | Fixed (partly) | Disabled while a transaction is pending. No confirm step (new UI); Esc never triggers it |
| 33 | Help screen key list | All bindings | Lists WASD / Shift / Space / E / N / I / C / M / U / L; not arrows, + / −, Home | Left | Copy change; the README lists them |

## Pending transaction, smash, exit beat

| # | Binding / context | Expected | Actual (before) | Verdict | Fix |
| --- | --- | --- | --- | --- | --- |
| 34 | Esc on a pending screen | Closes the screen only; progress stays visible | HUD spinner; result as a toast | OK | |
| 35 | Moving / C / H / I / M while pending | Allowed, but the record can't move | Hand locked, doorway shut for unpaid stock, jump refused | OK | |
| 36 | E on the sedan with the record mid-sale | Refused | Smashed with the record Stonks was inspecting | Fixed | Refused (state rule) with "One thing at a time." |
| 37 | E / Space during the smash swing | Ignored | Same | OK | |
| 38 | E at the hotel door twice / with a menu open | Beat runs once, never over a menu | Guarded | OK | |
| 38a | Turntable menu while the held record is being paid for | Locked actions not offered | "Put it on" / "Swap" were enabled and silently refused | Fixed | Disabled while the hand is locked (as inspect's Put back already was) |
| 38b | E with two interactables in range | The nearest one, shown by the ring and the prompt | Nearest enabled one by distance | OK | |
| 38c | E / smash in mid-air | Allowed or refused, never broken | Allowed: the swing plays in the air, jump input is refused until it ends | OK | |
| 38d | Speech bubbles / toasts vs an open menu | Menu on top, readable | Bubbles are drawn in the 3D scene and toasts in the HUD, both under the modal top layer; the prompt hides while a menu is open | OK | |
| 38e | Adaptive quality changing while a menu is open | No effect on input or focus | Render-scale changes only resize the canvas | OK | |

## Accessibility and display

| # | Item | Expected | Actual (before) | Verdict | Fix |
| --- | --- | --- | --- | --- | --- |
| 39 | `prefers-reduced-motion` | No shake, no flashing | CSS animations respected it; camera shake (smash, boom, hard landings) and the brown-out strobe (50–110 ms flicker) did not | Fixed | No camera shake and a smooth light ramp when reduced motion is set |
| 40 | Keyboard traps | Only intentional modals, each with an exit | Dialogs (Esc), loading screen (Enter), title card (Enter / Esc) | OK | |
| 41 | Window resize | Re-layout | Handled | OK | |
| 42 | devicePixelRatio change (dragging the window to the projector) | Re-evaluate render scale | The scale cap is computed at load | Left | Rendering change; load the page on the stage display (rehearsal note) |
| 43 | Audio context | Unlocks on the first gesture, suspends when hidden | Same; M works before unlock | OK | |
