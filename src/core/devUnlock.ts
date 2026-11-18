// The developer's unlock (milestone 24; milestones 25 and 27 build on it):
// the developer's nickname, typed as the board name on the title, plus a
// secret code. The repo is public, so neither is written here: the game
// keeps only a salted, slow hash of the nickname (DEV_HASH, which
// tools/dev/devHash.ts prints or writes in), and the code is checked only by
// the Worker (its DEV_CODE secret) on every removal. A name that hashes to
// DEV_HASH shows the code box under the name box; the code typed there is
// saved on this computer in settings, like the name. No DOM here: the tool
// runs this file in Node.

export const DEV_SALT = 'parklaps|dev-unlock|v1';
export const DEV_ITERATIONS = 150000;

/** The developer's nickname, hashed (devHash); '' while not set up, so nobody is the developer. Written by `node tools/dev/devHash.ts --write`. */
export const DEV_HASH = 'c625cead0bf282f7a99a94c805214302090afa7ac2171e0544e63bc2d1551816';

/** A nickname's salted hash (PBKDF2-SHA-256 over it in lower case), as hex. */
export async function devHash(nickname: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(nickname.trim().toLowerCase()), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(DEV_SALT), iterations: DEV_ITERATIONS }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether `name` is the developer's nickname (false when not set up, or where Web Crypto is missing). */
export async function isDevName(name: string): Promise<boolean> {
  if (!DEV_HASH || !name) return false;
  try {
    return (await devHash(name)) === DEV_HASH;
  } catch {
    return false;
  }
}
