/**
 * Show / hide the gameplay overlay (HUD, minimap, prompts, toasts, 3D helper markers) so
 * the bare world can be screenshotted. `U` toggles it; `?ui=0` starts hidden.
 *
 * Owns: the pure toggle state. Must not: touch the DOM or the world (the controller applies it).
 */
export class UiVisibility {
  constructor(public visible = true) {}

  /** Flip and return the new value. Ignored (returns the current value) while a dialog is open. */
  toggle(dialogOpen = false): boolean {
    if (!dialogOpen) this.visible = !this.visible;
    return this.visible;
  }
}

/** `?ui=0` (or `off` / `false`) starts hidden; anything else starts visible. */
export function uiVisibleFromSearch(search: string): boolean {
  const v = new URLSearchParams(search).get("ui");
  return !(v === "0" || v === "off" || v === "false");
}
