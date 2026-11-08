// Production builds only: makes the game's own menu, online and settings
// code hard to read in the built files, and keeps the page's words out of
// the HTML source. Nothing changes for players: the menus read the same.
//
// - Code: javascript-obfuscator rewrites the modules in INCLUDE. Every
//   string goes into an encoded table (base64), and local names become hex.
//   Settings that cost frame time (control-flow flattening, dead code,
//   self-defending) stay off. The per-frame code (sim, render, maps, audio,
//   config, the input and loop modules) is only minified, so the frame rate
//   on a Chromebook doesn't change. A fixed seed keeps builds reproducible.
// - HTML: the <title> and the loading screen's words are written by a tiny
//   inline script from base64, so "view source" doesn't show them.
//
// This is obfuscation, not security: a determined reader can still decode it,
// and anything the page sends shows in the browser's network panel.

import JavaScriptObfuscator from 'javascript-obfuscator';

/** Modules to obfuscate (paths with forward slashes). */
const INCLUDE = /\/src\/(boot\.ts$|main\.ts$|poses\.ts$|ui\/.+\.ts$|online\/.+\.ts$|core\/.+\.ts$)/;
/** Read on every frame or every key: left minified only. */
const EXCLUDE = /\/src\/core\/(loop|input)\.ts$/;

/** @type {import('javascript-obfuscator').ObfuscatorOptions} */
const OPTIONS = {
  compact: true,
  sourceType: 'module',
  target: 'browser',
  seed: 'parklaps',
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  ignoreImports: true,
  simplify: true,
  stringArray: true,
  stringArrayThreshold: 1,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 1,
  stringArrayWrappersType: 'variable',
  splitStrings: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  transformObjectKeys: false,
  numbersToExpressions: false,
  unicodeEscapeSequence: false,
  sourceMap: false,
};

/** A string as base64 of its UTF-8 bytes. */
function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

/** The inline script's decoder: base64 back to UTF-8 text. */
const DECODE = 'const d=s=>new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0)));';

/** @returns {import('vite').Plugin} */
export function obfuscate() {
  /** Vite's import.meta.env for this build (MODE, DEV, PROD, BASE_URL, SSR, VITE_*). */
  let env = {};
  return {
    name: 'park-laps-obfuscate',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      env = { ...config.env, SSR: false };
    },
    transform(code, id) {
      const path = id.split('?')[0].replace(/\\/g, '/');
      if (!INCLUDE.test(path) || EXCLUDE.test(path)) return null;
      // Fill in import.meta.env.X first. The obfuscator would turn it into a
      // computed lookup, and Vite would then inline its whole env object as
      // plain text (the Worker's address included) and keep DEV-only code.
      const filled = code.replace(/\bimport\.meta\.env\.([A-Za-z_]\w*)/g, (_, name) => (name in env ? JSON.stringify(env[name]) : 'undefined'));
      const result = JavaScriptObfuscator.obfuscate(filled, OPTIONS);
      return { code: result.getObfuscatedCode(), map: null };
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        let script = DECODE;
        let found = 0;
        html = html.replace(/<title>([^<]*)<\/title>/, (_, title) => {
          found++;
          script += `document.title=d('${b64(title)}');`;
          return '<title></title>';
        });
        html = html.replace(/<div id="boot">([\s\S]*?)<\/div>/, (_, inner) => {
          found++;
          script += `document.getElementById('boot').innerHTML=d('${b64(inner)}');`;
          return '<div id="boot"></div>';
        });
        // The game page must have both, so a change to index.html can't quietly stop hiding them.
        if (ctx.path.endsWith('/index.html') && found < 2) throw new Error('obfuscate: index.html needs its <title> and <div id="boot">');
        if (!found) return html;
        // Right after the boot div (or at the body's end), so the element exists when it runs.
        const at = html.includes('<div id="boot"></div>') ? '<div id="boot"></div>' : '</body>';
        const tag = `<script>(()=>{${script}})()</script>`;
        return html.replace(at, at === '</body>' ? `${tag}</body>` : `${at}${tag}`);
      },
    },
  };
}
