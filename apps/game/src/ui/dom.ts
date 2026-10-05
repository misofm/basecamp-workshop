/**
 * Tiny DOM builder shared by the UI modules.
 *
 * Owns: `h()` for creating elements without innerHTML (catalog text may come from
 * chain data on testnet, so everything is set as textContent, never parsed as HTML).
 * Must not: contain game logic.
 */
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (typeof value === "function") el.addEventListener(key.replace(/^on/, ""), value);
      else if (key === "class") el.className = String(value);
      else if (key === "text") el.textContent = String(value);
      else if (value === true) el.setAttribute(key, "");
      else el.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** Copy text to the clipboard; resolves false if the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * A key the browser owns (reload, fullscreen, dev tools, zoom, tab switching): overlays
 * that swallow the keyboard still let these through to the browser.
 */
export function isBrowserShortcut(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey || /^F\d{1,2}$/.test(e.code);
}
