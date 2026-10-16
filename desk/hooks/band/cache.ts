// The cache item: is the main thread's prompt cache still alive, and what a lapse costs.
// Nothing here calls the engine: the validator follows `$` only within one file, so the hooks live in register.tsx.
import type { AutoWarm, CacheSeen } from '../../types'

export const FIVE_MIN = 5 * 60_000
export const ONE_HOUR = 60 * 60_000
// Used until the transcript names the lifetime. The shorter one, so the item never claims warm past a lapse.
const DEFAULT_TTL = FIVE_MIN
export const TICK_MS = 30_000
/** How long Auto warm stays on once pressed. */
const AUTO_WARM_SPAN = 3 * 60 * 60_000
/** What the band's cache item adds while Auto warm is on, after a separator like the band's others. */
export const AUTO_MARK = 'auto'
/** The text of the Keep-warm ping. The band tells its own ping from the user's prompt by this text. */
export const KEEP_WARM_PROMPT = 'Keep-warm ping from desk Auto warm. Reply with only: ok'
/** Auto warm pings once the hour-long cache has this many minutes or fewer left. */
const PING_MARGIN_MIN = 10
/** No second ping this soon after the last one, so two ticks never ping twice. */
const PING_GAP = 60_000
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

/** Whether the cache lasts an hour: the only kind Auto warm can keep warm. False while the lifetime is unread. */
const isHourCache = (c: CacheSeen | null): boolean => c?.ttlMs === ONE_HOUR

type PressOn = { isOk: true; auto: AutoWarm } | { isOk: false; toast: string }

/** Whether Auto warm may be turned on now, and the switch it sets: on until AUTO_WARM_SPAN from `now`. Else the toast's reason. */
export function pressOn(c: CacheSeen | null, now: number): PressOn {
  if (!isHourCache(c)) return { isOk: false, toast: 'Auto warm needs the hour-long cache. Yours lasts 5 minutes now.' }
  return { isOk: true, auto: { isOn: true, offAt: now + AUTO_WARM_SPAN } }
}

/** The band's last Keep-warm ping: when it went, and whether it still waits for its answer. */
export type Ping = { at: number; isWaiting: boolean }
export const NO_PING: Ping = { at: Number.NEGATIVE_INFINITY, isWaiting: false }

/** What one tick does about Auto warm: nothing, switch off, or send the Keep-warm ping. */
type TickAction = { kind: 'stay' } | { kind: 'off' } | { kind: 'ping' }

export function tickAction(auto: AutoWarm, c: CacheSeen | null, t: number, ping: Ping): TickAction {
  if (!auto.isOn) return { kind: 'stay' }
  if (t >= auto.offAt || c?.ttlMs === FIVE_MIN) return { kind: 'off' }
  return isPingDue(c, t, ping) ? { kind: 'ping' } : { kind: 'stay' }
}

// Whether the cache is at the point to ping: hour-long and warm with ten minutes or fewer left, the guard passed,
// and the last ping answered (the cache's last request came after it) or never sent.
function isPingDue(c: CacheSeen | null, t: number, ping: Ping): boolean {
  if (c === null || !isHourCache(c) || t - ping.at < PING_GAP) return false
  if (ping.isWaiting && c.sentAt < ping.at) return false
  const view = cacheView(c, t)
  return view.state === 'warm' && view.minutesLeft <= PING_MARGIN_MIN
}

/** The cache after a main-thread request sent at `sentAt`: its clock restarts, and the lifetime already read stays. */
export const cacheAfterReply = (c: CacheSeen | null, sentAt: number, prefix: number): CacheSeen => ({
  sentAt,
  prefix,
  ttlMs: c?.ttlMs ?? null,
})

/** Whether a submitted prompt ends Auto warm: any but the band's own ping is the user's (or another mod's) next message. */
export const promptEndsAutoWarm = (text: string, auto: AutoWarm): boolean => text !== KEEP_WARM_PROMPT && auto.isOn
