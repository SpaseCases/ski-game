// The Worker's address for multiplayer (milestone 27), in a module of its own
// so the production build obfuscates it: connection.ts runs per message and
// is only minified (tools/vite/obfuscate.js EXCLUDE), so reading the address
// there would leave it in plain text. Dev builds take ?mpapi= (a play-test's
// latency relay in front of the local Worker).

export function apiBase(): string {
  const relay = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('mpapi') : null;
  return (relay ?? (import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');
}
