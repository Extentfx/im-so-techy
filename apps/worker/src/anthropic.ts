import type { Env } from './env';

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_SMALL_MODEL = 'claude-haiku-5-5';

/** One call to the Claude Messages API. The key never leaves the Worker. */
export function callClaude(
  env: Env,
  f: typeof fetch,
  body: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<Response> {
  return f(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export const hasClaude = (env: Env): boolean => !!env.ANTHROPIC_API_KEY;
