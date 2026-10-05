/**
 * The cast: which Tamashi plays which role in the game. The ONE place to change it.
 *
 * Owns: token ids, names and lines for the player, the shopkeeper, the collector, the
 * named story characters around the block, and the street crowd (everyone else).
 * Canon: the Nozomi world bible, chapter 3.0 setting (§2 characters, §7.9 NPC positions
 * and lines). Lines are verbatim canon lines or new lines in the character's canon voice,
 * as listed there. src/world/npcs.ts shows them as speech bubbles: the nearest named NPC
 * within a few metres cycles through its lines, the shopkeeper talks when the player is at
 * the counter, the collector between his "Got any wax?" calls, Miné from the hotel window.
 * Must not: hold coordinates. A role's `spot` is a key into CAST_SPOTS in
 * src/world/layout.ts, so the environment pass can move everyone in one place.
 */
import { TAMASHI_COUNT } from "./traits";

/** How a placed character holds itself (TamashiCharacter.pose). */
export type CastPose = "stand" | "sit" | "crouch";

export interface CastRole {
  /** Tamashi token number (1..100). */
  id: number;
  name: string;
  /** Who they are in this scene (one line, for humans reading the code). */
  role: string;
  /** Things they say (speech bubbles, in this order, starting from the first). */
  lines: string[];
}

/** A named NPC standing, sitting or crouching somewhere on the block. */
export interface PlacedRole extends CastRole {
  /** Key into CAST_SPOTS (src/world/layout.ts); null = not placed (e.g. a voice only). */
  spot: string | null;
  pose: CastPose;
}

export interface Cast {
  /**
   * A real-person cameo for the Sui Basecamp stage build: Adeniyi Abiodun (Mysten Labs
   * co-founder), consented, hanging out by Saisei's window (src/tamashi/cameo.ts +
   * src/world/cameo.ts). `?cameo=0` removes him (public take-home build).
   */
  cameo?: "adeniyi";
  /** The player character. */
  player: CastRole;
  /** Behind the shop counter. */
  cashier: CastRole;
  /** Buys your records on the street (BUYER_SPOT in layout.ts). */
  collector: CastRole;
  /** Named NPCs placed around the block (never swapped out). */
  named: PlacedRole[];
  /**
   * Street crowd, in order of appearance: every id not cast above. Walkers and idlers take
   * ids from this list and swap to the next unused one now and then (out of view), so over
   * a session every id in it shows up.
   */
  crowd: number[];
}

const PLAYER: CastRole = {
  id: 95,
  name: "Gamer",
  role: "the player; a Takahashi who goes by Gamer now",
  lines: ["'Gamer' is my name now."],
};

const CASHIER: CastRole = {
  id: 52,
  name: "Jazz",
  role: "shopkeeper of the record shop; the band member who left (joined Team Order)",
  lines: [
    "Saisei. Means 'playback.' Also means starting over. Seemed fitting.",
    "Register's all gears and springs. Nothing in here answers to the Triangle network.",
    "Four of the five out there drinking? Don't tell them I'm in here. ...Tell Disco the jacket still looks like a beehive.",
  ],
};

const COLLECTOR: CastRole = {
  id: 35,
  name: "Stonks",
  role: "record collector and hoarder, behind a folding BUYING table across from the shop",
  lines: [
    "You need to HODL them now and wait until there's demand.",
    "Records! It's limited. No one's going to make any more. It's a limited supply.",
    "What's the rent on this place anyway?",
  ],
};

/**
 * Inicio's answer when Gamer asks him over (the exit beat, Npcs.sendInicioHome). The last
 * of his lines; npcs.ts only cycles it once he has gone home with Gamer.
 */
export const INICIO_HOME_LINE = "Your room? Sure. I'll bring the orb.";

const NAMED: PlacedRole[] = [
  // Inside the shop.
  {
    id: 74,
    name: "Inicio",
    role: "Gamer's new friend, a tinkerer; crouched at the listening bar with tools",
    spot: "inicio",
    pose: "crouch",
    lines: [
      "It's amazing how much tech is lying around the facility!",
      "It's not really anything",
      "It looks cool though, right?",
      "Motor was dead. Gave it a nudge. Want to hear something?",
      INICIO_HOME_LINE,
    ],
  },
  // The band, on the curb by the casino's east fire exit, sharing Disco's sake.
  {
    id: 60,
    name: "Habiki",
    role: "the band's DJ",
    spot: "band1",
    pose: "sit",
    lines: ["Well that got out of hand", "Has anyone seen Jazz?", "Hey... that's our old mix. Who's spinning that?"],
  },
  {
    id: 66,
    name: "Ongaku",
    role: "the band's guitarist, the gruff one",
    spot: "band2",
    pose: "sit",
    lines: ["Just like old times… All we need now's some liquor.", "I miss that jackass."],
  },
  {
    id: 76,
    name: "Disco",
    role: "the band's joker; smuggles sake",
    spot: "band3",
    pose: "sit",
    lines: [
      "But this jacket will win you over one of these days!",
      "Sake's for grown-ups, kid. The jacket, though — the jacket is for everyone.",
    ],
  },
  {
    id: 38,
    name: "Wolfgang",
    role: "the band's violist",
    spot: "band4",
    pose: "sit",
    lines: ["No. Not since he joined Team Order."],
  },
  // Celebrity fans on the bench across from the band (FAN_BENCH), whispering.
  {
    id: 54,
    name: "Kasimir",
    role: "celebrity living incognito; a fan of the band",
    spot: "fan1",
    pose: "sit",
    lines: ["Is that them?", "Don't worry darling. We're going to make this work."],
  },
  {
    id: 65,
    name: "Natsuki",
    role: "celebrity escaping fame; a fan of the band",
    spot: "fan2",
    pose: "sit",
    lines: ["At least four of the five, yeah?", "...Turn that off. Please. We're nobody. Just fans."],
  },
  // Near the casino at the east end.
  {
    id: 78,
    name: "Mizuto",
    role: "sitting against the wall by the dead hydrant",
    spot: "casinoWall1",
    pose: "sit",
    lines: ["Every time I blink, there's another fire.", "Although it would be nice to have a working fire truck."],
  },
  {
    id: 6,
    name: "Heart",
    role: "sitting against the wall by the dead hydrant; reacts to the car smash",
    spot: "casinoWall2",
    pose: "sit",
    lines: ["They just want to feel something.", "But someone needs to look out for these people."],
  },
  {
    id: 39,
    name: "Shimo",
    role: "crossing to the casino fire door with a med kit",
    spot: "casinoDoor",
    pose: "stand",
    lines: ["Is everyone alright here?"],
  },
  // The diner alley.
  {
    id: 82,
    name: "Noir",
    role: "in the diner alley, telling Takahashi stories",
    spot: "alley1",
    pose: "stand",
    lines: ["'Strong men shape the world'. I'll never forget it."],
  },
  {
    id: 79,
    name: "Itamae",
    role: "in the diner alley",
    spot: "alley2",
    pose: "stand",
    lines: ["Tell me a Takahashi story.", "No one back there can cook as well as me."],
  },
  {
    id: 55,
    name: "Waitress",
    role: "at the diner door",
    spot: "dinerDoor",
    pose: "stand",
    lines: ["Pancakes are off. Coffee's mostly hot water. Jukebox still works, though."],
  },
  // The hotel end (west): Gamer's mother at a window, and the tableau around Vine.
  {
    id: 57,
    name: "Miné",
    role: "Gamer's mother; a voice from a hotel window at the west end",
    spot: null, // voice only in canon: npcs.ts shows her line at HOTEL_WINDOW (layout.ts)
    pose: "stand",
    lines: ["Ka-Gamer... home before dark!"],
  },
  {
    id: 50,
    name: "Kasumi",
    role: "kneeling by Vine at the hotel front",
    spot: "hotel1",
    pose: "crouch",
    lines: ["We're going to get you help, alright?", "Carry a little nozomi home with you."],
  },
  {
    id: 3,
    name: "Vine",
    role: "sitting by her dent at the hotel front",
    spot: "hotel2",
    pose: "sit",
    lines: ["I … I … there's so much anger … urgh."],
  },
  {
    id: 10,
    name: "Birdcage",
    role: "at the hotel front",
    spot: "hotel3",
    pose: "stand",
    lines: ["Go on home, kid. It's been a day."],
  },
  {
    id: 73,
    name: "Hero",
    role: "at the hotel front",
    spot: "hotel4",
    pose: "stand",
    lines: ["Is she going to be alright?"],
  },
];

const taken = new Set([PLAYER.id, CASHIER.id, COLLECTOR.id, ...NAMED.map((r) => r.id)]);

export const CAST: Cast = {
  cameo: "adeniyi", // consented cameo for the Basecamp stage build; ?cameo=0 disables it
  player: PLAYER,
  cashier: CASHIER,
  collector: COLLECTOR,
  named: NAMED,
  crowd: Array.from({ length: TAMASHI_COUNT }, (_, i) => i + 1).filter((id) => !taken.has(id)),
};

/** Named role for a token id (player, cashier, collector or placed), if it has one. */
export function castRoleFor(id: number): CastRole | undefined {
  return [CAST.player, CAST.cashier, CAST.collector, ...CAST.named].find((r) => r.id === id);
}
