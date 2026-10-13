// The cache item: is the main thread's prompt cache still alive, and what a lapse costs.
// Nothing here calls the engine: the validator follows `$` only within one file, so the hooks live in register.tsx.
import type { AutoWarm, CacheSeen } from '../types'

export const FIVE_MIN = 5 * 60_000
export const ONE_HOUR = 60 * 60_000
// Used until the transcript names the lifetime. The shorter one, so the item never claims warm past a lapse.
const DEFAULT_TTL = FIVE_MIN
export const TICK_MS = 30_000
/** How long Auto warm stays on once pressed. */
export const AUTO_WARM_SPAN = 3 * 60 * 60_000
/** What the band's cache item adds while Auto warm is on, after a separator like the band's others. */
export const AUTO_MARK = 'auto'
/** The text of the Keep-warm ping. The band tells its own ping from the user's prompt by this text. */
export const KEEP_WARM_PROMPT = 'Keep-warm ping from desk-status Auto warm. Reply with only: ok'
/** Auto warm pings once the hour-long cache has this many minutes or fewer left. */
export const PING_MARGIN_MIN = 10
/** No second ping this soon after the last one, so two ticks never ping twice. */
export const PING_GAP = 60_000
export const NO_AUTO_WARM: AutoWarm = { isOn: false, offAt: 0 }

/** Saved state outlives a reload: fills in a field a half-written save left out, so a missing off time cannot keep the switch on. */
export const autoWarmOf = (saved: AutoWarm): AutoWarm => ({ ...NO_AUTO_WARM, ...saved })

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
