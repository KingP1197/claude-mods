// The cache item: is the main thread's prompt cache still alive, and what a lapse costs.
// Nothing here calls the engine: the validator follows `$` only within one file, so the hooks live in register.tsx.
import type { CacheSeen } from '../types'

export const FIVE_MIN = 5 * 60_000
export const ONE_HOUR = 60 * 60_000
// Used until the transcript names the lifetime. The shorter one, so the item never claims warm past a lapse.
const DEFAULT_TTL = FIVE_MIN
export const TICK_MS = 30_000

export const WARM_COLOR = '#ff9e64'

export const KEEP_WARM_PROMPT = 'Keep-warm ping from the desk-status cache button. Reply with only: ok'

// The turn's usage carries no lifetime; the transcript records each write split by it.
// Its tail holds the last writes; a whole read would hit the 4 MiB limit on a long session.
export const TTL_SCRIPT = `tail -c 2000000 "$1" | grep -o '"cache_creation":{[^}]*}' | tail -n 50`

/** The lifetime of the newest cache write in `grep` output from TTL_SCRIPT; null when none wrote. */
export function ttlFrom(out: string): number | null {
  const lines = out.trim().split('\n').reverse()
  for (const l of lines) {
    const hour = Number(/"ephemeral_1h_input_tokens":(\d+)/.exec(l)?.[1] ?? 0)
    const five = Number(/"ephemeral_5m_input_tokens":(\d+)/.exec(l)?.[1] ?? 0)
    if (hour > 0) return ONE_HOUR
    if (five > 0) return FIVE_MIN
  }
  return null
}

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export const prefixOf = (u: Usage) =>
  u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens

export type CacheView =
  { state: 'warm'; coldAt: number; minutesLeft: number } | { state: 'cold'; coldAt: number; prefix: number }

export function cacheView(c: CacheSeen, now: number): CacheView {
  const coldAt = c.sentAt + (c.ttlMs ?? DEFAULT_TTL)
  if (now >= coldAt) return { state: 'cold', coldAt, prefix: c.prefix }
  return { state: 'warm', coldAt, minutesLeft: Math.max(1, Math.ceil((coldAt - now) / 60_000)) }
}

/** A time of day in Eastern time, labeled EDT or EST. */
export function eastern(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return `${new Date(ms).toISOString().slice(11, 16)} UTC`
  }
}
