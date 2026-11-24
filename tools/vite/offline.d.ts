import type { Plugin } from 'vite';

/** Production builds only: writes dist/sw.js, the offline service worker (src/core/offline.ts registers it). */
export function offline(): Plugin;
