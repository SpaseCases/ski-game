// What the Worker's routes share: a refusal the game can read, the JSON body
// reader, and Cloudflare's rate limiting binding.

/** A refusal the game can read: a status and a short code. */
export class Refused extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

/** Cloudflare's rate limiting binding (wrangler.jsonc "ratelimits"). */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The largest request body taken (a look with every slot painted is about 46 kB). */
export const BODY_MAX = 64 * 1024;

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > BODY_MAX) throw new Refused(413, 'too big');
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Falls through to the refusal.
  }
  throw new Refused(400, 'body');
}
