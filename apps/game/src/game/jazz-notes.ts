/**
 * Jazz's notes: one short line per catalog section, in Jazz's dry voice, shown in the
 * record dialog (shop-flow.ts) as "JAZZ: “…”". Jazz (#52) runs the counter at Saisei
 * Records (world bible §7.4 step 3: "each sleeve opens a close-up with a one-line note
 * from Jazz").
 *
 * Owns: the copy. Lines are about the music in general, never canon facts or real
 * artists. PURE data.
 * Must not: know about records, prices or the chain.
 */

/** Section sign text (ShopRecord.section, e.g. "HIP HOP") → Jazz's line. */
export const JAZZ_NOTES: Readonly<Record<string, string>> = {
  "HIP HOP": "Drums first, words second. Same as it ever was.",
  SYNTHWAVE: "Somebody's idea of the future. Aged better than the real one.",
  FOLK: "Three chords and the truth. Mostly the truth.",
  AFROBEATS: "Put this on and the room stops pretending it can't dance.",
  JAZZ: "Alphabetized, obviously. I'm not an animal.",
  AMBIENT: "For when the lights go out. Which they will.",
  "CITY POP": "Neon on a Friday night, back when we had both.",
  "DRUM & BASS": "Fast. Faster than the news, anyway.",
  "SURF ROCK": "Nobody's surfed here in years. The reverb doesn't care.",
  HOUSE: "Four on the floor. The floor still holds. For now.",
};

/** Jazz's line for a section, or null for an unknown section (then the dialog shows none). */
export function jazzNote(section: string): string | null {
  return JAZZ_NOTES[section.trim().toUpperCase()] ?? null;
}
