import type { Plugin } from 'vite';

/** Dev server only: saves WAV files POSTed to /__audio-wav?name=x.wav into .playwright-mcp/audio/. */
export function wavSink(): Plugin;
