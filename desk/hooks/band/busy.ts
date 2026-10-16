// The band's busy flags (Handoff, Compact, the side question) and the one claim that takes them. Nothing here calls
// the engine: register.tsx runs each change inside one state update, so two presses at once cannot both take a flag.
// A reload cancels the module's pending waits, so the work that would free a flag may never report back; each flag
// says what a load of the mod leaves it as, and the band's session.start applies that.
import type { RenderSurface } from 'claude-code'

import type { Handoff, Side } from '../../types'

import { IDLE } from './handoff'

/** One busy flag: when it is held, and the value each step leaves. `Args` is what a claim needs to take it. */
export type BusyFlag<T, Args extends unknown[] = []> = {
  isHeld: (v: T) => boolean
  /** The value once a claim takes the flag. */
  take: (v: T, ...args: Args) => T
  /** The value a claim leaves when the flag was already held. */
  onHeld: (v: T) => T
  /** The value once the claimed work ends. */
  release: (v: T) => T
  /** The value at a load or reload of the mod: work that can no longer report back is let go. */
  atLoad: (v: T) => T
}

/** The Compact button: held while `/compact` runs. A reload ends the press's wait, so a load frees it. */
export const COMPACT: BusyFlag<boolean> = {
  isHeld: (v) => v,
  take: () => true,
  onHeld: (v) => v,
  release: () => false,
  atLoad: () => false,
}

/** The Handoff button: a press while held frees the button (register.tsx ends the handoff turn if one runs). At a
 *  load, a queued request's submit will never report back, so it resets; a turn being written still runs and ends. */
export const HANDOFF: BusyFlag<Handoff, [surface: RenderSurface]> = {
  isHeld: (h) => h.phase !== 'idle',
  take: (_h, surface) => ({ phase: 'queued', surface }),
  onHeld: () => IDLE,
  release: () => IDLE,
  atLoad: (h) => (h.phase === 'queued' ? IDLE : h),
}

const CUT_OFF = 'No answer: the question was cut off by a reload. Ask it again.'

/** The side question: held while a question waits for its fork. A claim adds the question and empties the box.
 *  At a load the fork's wait is gone, so a waiting question shows as cut off and a new one can be asked. */
export const SIDE: BusyFlag<Side, [question: string]> = {
  isHeld: (s) => s.isAsking,
  take: (s, question) => ({
    ...s,
    draft: '',
    draftSeq: s.draftSeq + 1,
    isAsking: true,
    turns: [...s.turns, { question, state: 'pending' }],
  }),
  onHeld: (s) => s,
  release: (s) => ({ ...s, isAsking: false }),
  atLoad: (s) => ({
    ...s,
    isAsking: false,
    turns: s.turns.map((t) =>
      t.state === 'pending' ? { question: t.question, state: 'failed', failure: CUT_OFF } : t,
    ),
  }),
}

/** A claim on a flag: `change` goes to one state update. The engine may run it more than once; each run decides
 *  afresh, and `isTaken` and `seen` answer for the last run. */
export function claim<T, Args extends unknown[]>(flag: BusyFlag<T, Args>, ...args: Args) {
  let isTaken = false
  let seen: T | undefined
  return {
    change: (v: T): T => {
      seen = v
      isTaken = !flag.isHeld(v)
      return isTaken ? flag.take(v, ...args) : flag.onHeld(v)
    },
    isTaken: () => isTaken,
    /** The value the last run found: what held the flag, when the claim was refused. */
    seen: () => seen,
  }
}
