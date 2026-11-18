// The developer's unlock (milestone 24): run it yourself, in your own
// terminal, so your nickname and code never pass through a chat or a file.
//
//   node tools/dev/devHash.ts            asks for your nickname (typed hidden), prints its salted hash
//   node tools/dev/devHash.ts --write    the same, and writes the hash into src/core/devUnlock.ts (DEV_HASH)
//   node tools/dev/devHash.ts --check    asks for your nickname and your code, then says whether
//                                        either appears anywhere in the repo's files or dist/ (never printing them)
//
// The game compares the board name's hash with DEV_HASH; the code goes to
// the Worker as a secret (from worker/: `npx wrangler secret put DEV_CODE`),
// and the title's code box under your nickname saves it on your computer.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { devHash } from '../../src/core/devUnlock.ts';

const UNLOCK = 'src/core/devUnlock.ts';

/** Piped input not yet read (when stdin isn't a terminal). */
let piped = '';
let pipedEnded = false;

/** Reads a line from the terminal without showing it (shown as *), or plainly when stdin isn't a terminal. */
function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      const take = (): boolean => {
        const end = piped.indexOf('\n');
        if (end < 0 && !pipedEnded) return false;
        const line = end < 0 ? piped : piped.slice(0, end);
        piped = end < 0 ? '' : piped.slice(end + 1);
        process.stdout.write('\n');
        resolve(line.replace(/\r$/, ''));
        return true;
      };
      if (take()) return;
      const onData = (d: string): void => {
        piped += d;
        if (take()) {
          stdin.off('data', onData);
          stdin.off('end', onEnd);
          stdin.pause();
        }
      };
      const onEnd = (): void => {
        pipedEnded = true;
        stdin.off('data', onData);
        take();
      };
      stdin.setEncoding('utf8');
      stdin.on('data', onData);
      stdin.once('end', onEnd);
      stdin.resume();
      return;
    }
    let text = '';
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const onKey = (key: string): void => {
      for (const ch of key) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onKey);
          process.stdout.write('\n');
          resolve(text);
          return;
        }
        if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(1);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (text.length > 0) {
            text = text.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        text += ch;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onKey);
  });
}

/** The repo's tracked files, every file under dist/, and the worker's own files. */
function filesToScan(): string[] {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter((f) => f && existsSync(f));
  const walk = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])) : []);
  return [...new Set([...tracked, ...walk('dist'), ...(existsSync('worker/.dev.vars') ? ['worker/.dev.vars'] : [])])];
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '';
  if (mode === '--check') {
    const nickname = (await ask('Your dev nickname (hidden): ')).trim().toLowerCase();
    const code = (await ask('Your dev code (hidden, Enter to skip): ')).trim();
    const files = filesToScan();
    for (const [what, needle, anyCase] of [
      ['nickname', nickname, true],
      ['code', code, false],
    ] as const) {
      if (!needle) continue;
      const hits = files.filter((f) => {
        const text = readFileSync(f, 'latin1');
        return anyCase ? text.toLowerCase().includes(needle) : text.includes(needle);
      });
      console.log(hits.length ? `Your ${what} appears in ${hits.length} file(s): ${hits.join(', ')}` : `Your ${what}: in none of the ${files.length} files.`);
    }
    return;
  }
  const nickname = (await ask('Your dev nickname (hidden): ')).trim();
  if (nickname.length < 3) {
    console.log('A board name is 3 to 16 characters.');
    process.exit(1);
  }
  const again = (await ask('Again, to be sure: ')).trim();
  if (again.toLowerCase() !== nickname.toLowerCase()) {
    console.log('Those two differ: nothing done.');
    process.exit(1);
  }
  const hash = await devHash(nickname);
  if (mode === '--write') {
    const src = readFileSync(UNLOCK, 'utf8');
    const out = src.replace(/export const DEV_HASH = '[0-9a-f]*';/, `export const DEV_HASH = '${hash}';`);
    if (out === src && !src.includes(`'${hash}'`)) throw new Error(`No DEV_HASH line found in ${UNLOCK}`);
    writeFileSync(UNLOCK, out);
    console.log(`Wrote the hash into ${UNLOCK}.`);
  } else {
    console.log(hash);
  }
}

void main();
