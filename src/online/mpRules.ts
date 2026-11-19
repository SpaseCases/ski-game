import { blockedText, slurText } from '../core/playerName.ts';

// Multiplayer's rules (milestone 27), shared by the game and the leaderboard
// Worker (worker/src/room.ts), so both read and check messages the same way.
// The Worker bundles this file: keep it free of DOM, browser APIs and game
// modules (core/playerName.ts is the one import, as the boards use it).
//
// A rider's state goes out as a small binary message, 5 a second, each
// carrying two samples taken a tenth of a second apart:
//   byte 0  KIND_STATE
//   byte 1  the rider's id in the room (0 from the game; the Worker fills it)
//   2..3    the sender's sequence number (u16, wraps)
//   then sample A, every field
//   then a u32 mask of the fields that changed from A to B, and those fields of B
// Fields are whole numbers (the value times SCALE, rounded) in WIDTH bytes,
// little-endian. Everything else (hello, chat, scores, hits) is JSON text.

/** A state message's first byte. */
export const KIND_STATE = 1;
/** The fields of one sample, in order: what the other games need to draw a rider (render/skierView.ts SkierPose). */
export const FIELDS = [
  'px', 'py', 'pz', 'vx', 'vy', 'vz', 'qx', 'qy', 'qz', 'qw', 'yaw', 'nx', 'ny', 'nz', 'lean', 'crouch', 'brake', 'brakeSide',
  'polePhase', 'cx', 'cy', 'cz', 'spinRate', 'grab', 'butter', 'butterAmount', 'landTime', 'landDepth', 'bailTime', 'flags',
] as const;
export const FIELD_COUNT = FIELDS.length;
/** Bytes per field: positions are 4 (centimeters over a 6 km map), the rest 2. */
export const WIDTH: readonly number[] = FIELDS.map((f) => (f === 'px' || f === 'py' || f === 'pz' ? 4 : 2));
/** What each field is multiplied by before rounding. The center (cx, cy, cz) is sent as its offset from the position. */
export const SCALE: readonly number[] = FIELDS.map((f) => {
  switch (f) {
    case 'px': case 'py': case 'pz': case 'vx': case 'vy': case 'vz': return 100;
    case 'qx': case 'qy': case 'qz': case 'qw': case 'nx': case 'ny': case 'nz': return 32767;
    case 'yaw': case 'lean': case 'crouch': case 'brake': case 'butterAmount': case 'landDepth': return 10000;
    case 'polePhase': case 'cx': case 'cy': case 'cz': return 1000;
    case 'spinRate': case 'landTime': case 'bailTime': return 100;
    default: return 1;
  }
});
/** Bits of the `flags` field. */
export const FLAG = { grounded: 1, onRail: 2, rail3d: 4, sitting: 8 } as const;
export const SAMPLE_BYTES = WIDTH.reduce((a, b) => a + b, 0);
export const HEADER_BYTES = 4;
/** The shortest and longest state message. */
export const STATE_MIN = HEADER_BYTES + SAMPLE_BYTES + 4;
export const STATE_MAX = STATE_MIN + SAMPLE_BYTES;

/** A state message's length for B's change mask, or -1 if the mask names fields that don't exist. */
export function stateLength(mask: number): number {
  if (mask >>> FIELD_COUNT !== 0) return -1;
  let n = STATE_MIN;
  for (let i = 0; i < FIELD_COUNT; i++) if (mask & (1 << i)) n += WIDTH[i]!;
  return n;
}

// ---------------------------------------------------------------- rooms

/** Riders in one lobby (the user's pick: 16). */
export const ROOM_MAX = 16;
/** The maps a lobby can be on (src/maps/registry.ts MapId). */
export const MP_MAPS = ['park', 'jampark', 'proving', 'freeride', 'city', 'slalom', 'bigair', 'test'] as const;
/** Lobby codes: four letters with no vowels (so no words), any lobby's way in; private lobbies only by code. */
export const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_LENGTH = 4;
export const CODE_FORMAT = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;
/** A lobby's title: 3 to 24 of these, through the board names' word filter (the user's pick). */
export const TITLE_MIN = 3;
export const TITLE_MAX = 24;
const TITLE_FORMAT = /^[A-Za-z0-9 _'!.-]+$/;
/** The token a game keeps for a visit, so a rejoin replaces its own old connection. */
export const TOKEN_FORMAT = /^[a-z0-9]{8,16}$/;
/** A name stand-in for a player with no board name. */
export const STAND_IN_NAME = /^Rider \d{4}$/;

/** The longest text message taken (a hello with an outfit is the biggest). */
export const TEXT_MAX = 2600;
/** Chat: at most this many characters, one message per CHAT_GAP_MS a rider (the user's pick). */
export const CHAT_MAX = 80;
export const CHAT_GAP_MS = 2000;
/** A trick name sent with a banked combo, and the most a combo can score (online/limits.ts). */
export const TRICK_MAX = 48;
export const BEST_MAX = 10_000_000;
/** Messages a connection may send in a second (5 states and a keep-alive are normal; this allows a burst). */
export const RATE_MAX = 20;
/** Seconds over RATE_MAX in a row before the Worker closes the connection. */
export const RATE_STRIKES = 3;
/** A connection silent this long (no state, keep-alive or chat) is closed by the Worker. Longer than the game's own removal, so a sleeping lid isn't dropped early. */
export const SILENT_CLOSE_S = 90;
/** A lobby re-reports itself to the list at least this often while anyone rides in it; the list forgets one silent for LIST_STALE_S. */
export const REPORT_EVERY_S = 120;
export const LIST_STALE_S = 330;
/** One open lobby in a map's list (worker/src/lobbies.ts). */
export interface LobbyEntry {
  code: string;
  title: string;
  riders: number;
  max: number;
  /** When the lobby last reported (ms, the Worker's clock). */
  at: number;
}

/** The most lobbies one map's list shows. */
export const LIST_MAX_LOBBIES = 40;

/** WebSocket close codes the game reads (4000 to 4999 are ours). */
export const CLOSE = {
  bad: 4400,
  noLobby: 4404,
  silent: 4408,
  full: 4409,
  replaced: 4410,
  tooFast: 4413,
  fullToday: 4429,
  down: 4503,
} as const;

/** Plain words for a close code, for the game's status line. */
export function closeText(code: number): string | null {
  switch (code) {
    case CLOSE.noLobby: return 'That lobby is gone.';
    case CLOSE.full: return 'That lobby is full.';
    case CLOSE.replaced: return 'You joined from another tab.';
    case CLOSE.tooFast: return 'Too many messages: disconnected.';
    case CLOSE.fullToday: return 'Multiplayer is full today. Riding alone still works.';
    case CLOSE.down: return 'Multiplayer is down right now.';
    case CLOSE.silent: return 'Disconnected after a long silence.';
    case CLOSE.bad: return 'The server refused the connection.';
    default: return null;
  }
}

// ---------------------------------------------------------------- text

/** A title as it would be kept: no spaces at the ends, none doubled. */
export function tidyTitle(text: string): string {
  return text.trim().replace(/ {2,}/g, ' ');
}

/** What's wrong with a tidied lobby title, or null. */
export function lobbyTitleProblem(title: string): string | null {
  if (title.length < TITLE_MIN) return `At least ${TITLE_MIN} characters.`;
  if (title.length > TITLE_MAX) return `At most ${TITLE_MAX} characters.`;
  if (!TITLE_FORMAT.test(title)) return "Only letters, digits, spaces and _ ' ! . -";
  if (blockedText(title)) return "Pick a different title: that one isn't allowed.";
  return null;
}

/** A chat line as sent: printable characters only, spaces tidied, at most CHAT_MAX. */
export function tidyChat(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').trim().replace(/\s{2,}/g, ' ').slice(0, CHAT_MAX);
}

/** Whether a chat line may be sent: not empty, and no slur (swearing is allowed: the user's pick). */
export function chatAllowed(text: string): boolean {
  return text.length > 0 && text.length <= CHAT_MAX && !slurText(text);
}

/** A trick name as the game makes them (letters, digits, spaces and a few marks). */
export function trickOk(text: unknown): text is string {
  return typeof text === 'string' && text.length <= TRICK_MAX && /^[A-Za-z0-9 +°'×x&,./-]*$/.test(text);
}
