import type { Plugin } from 'vite';

/** Production builds only: obfuscates the menu, online and core modules, and base64-encodes the page's title and loading text. */
export function obfuscate(): Plugin;
