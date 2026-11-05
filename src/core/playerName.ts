// The name a player posts under on the online leaderboards (GAME_DESIGN.md,
// milestone 13): 3 to 16 letters, digits, spaces, - and _, through a small
// word filter. Nobody owns a name. It's saved in settings; this module only
// tidies and checks it, so the title screen's name box needs nothing from
// the leaderboard chunk. The leaderboard Worker (worker/) runs this same
// module, filter included, so a hand-made request can't skip it. Keep it
// free of DOM and browser APIs for that reason.

export const NAME_MIN = 3;
export const NAME_MAX = 16;
const FORMAT = /^[A-Za-z0-9 _-]+$/;

/** What the name box says for each problem (null: the name is fine). */
export type NameProblem = 'short' | 'long' | 'chars' | 'word';
export const NAME_PROBLEM_TEXT: Record<NameProblem, string> = {
  short: `At least ${NAME_MIN} characters.`,
  long: `At most ${NAME_MAX} characters.`,
  chars: 'Only letters, digits, spaces, - and _.',
  word: "Pick a different name: that one isn't allowed.",
};

/** Typed text as it would be saved: no spaces at the ends, none doubled. */
export function tidyName(text: string): string {
  return text.trim().replace(/ {2,}/g, ' ');
}

/** What's wrong with an already tidied name, or null when it can be used. */
export function nameProblem(name: string): NameProblem | null {
  if (name.length < NAME_MIN) return 'short';
  if (name.length > NAME_MAX) return 'long';
  if (!FORMAT.test(name)) return 'chars';
  if (blocked(name)) return 'word';
  return null;
}

/** The name's entry key on every board: the same name in any case is one entry. */
export function nameKey(name: string): string {
  return name.toLowerCase();
}

// The word filter. Words are stored ROT13 so the source doesn't spell them
// out. Look-alike digits are read as letters and separators dropped
// ("f_u_c_k", "sh1t"), then real words that contain a blocked one are
// blanked (SAFE: "Classic", "Scunthorpe"), and the rest is checked as it is
// and with repeated letters squeezed ("fuuuck"). A BLOCKED word counts
// anywhere in the name; a short START word only at the start of one of its
// words, so "Cassie" and "Cumberland" pass and "ass_man" doesn't.
const BLOCKED = words(
  'shpx fuvg phag ovgpu avtt snttbg fyhg juber qvpx pbpx chffl cravf intvan cbea frk encr anmv uvgyre xxx ergneq ' +
    'gvgf obbo wvmm gjng jnax onfgneq cvff puvax genaal qlxr zbyrfg ubeal ahqr anxrq qvyqb betnfz grfgvpyr fpebghz frzra ' +
    'obare zvys jrgonpx oybjwbo unaqwbo',
);
const START = words('nff phz ubr snt nany nahf fcvp xvxr crqb gvg');
const SAFE = [
  'class', 'pass', 'bass', 'grass', 'glass', 'brass', 'assist', 'assassin', 'assault', 'asset', 'cucumber', 'cumul', 'cumber',
  'circum', 'sussex', 'essex', 'sextet', 'sexton', 'dickens', 'peacock', 'hancock', 'cockpit', 'cocktail', 'cockatoo', 'grape',
  'drape', 'scrape', 'trapeze', 'therapist', 'scunthorpe', 'shitake', 'shiitake', 'pissarro', 'title', 'titan', 'spice', 'spici',
];
const LOOKALIKE: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' };

function blocked(name: string): boolean {
  const parts = name.toLowerCase().split(/[ _-]+/).map(letters);
  const all = parts.join('');
  const squeezed = (s: string): string => s.replace(/(.)\1+/g, '$1');
  if (inside(all) || inside(squeezed(unsafe(all)))) return true;
  return parts.some((p) => START.some((w) => unsafe(p).startsWith(w) || squeezed(unsafe(p)).startsWith(w)));
}

/** Only the letters, with look-alikes read as the letter they stand for. */
function letters(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch >= 'a' && ch <= 'z') out += ch;
    else if (LOOKALIKE[ch]) out += LOOKALIKE[ch];
  }
  return out;
}

/** The string with every SAFE word blanked out. */
function unsafe(s: string): string {
  for (const safe of SAFE) s = s.split(safe).join('.');
  return s;
}

function inside(s: string): boolean {
  const left = unsafe(s);
  return BLOCKED.some((w) => left.includes(w));
}

function words(rot: string): string[] {
  return rot.split(' ').map((w) => w.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97)));
}
