/** One source of context, as /context names it. */
export type Part = { name: string; tokens: number }

export type Line = {
  branch: string | null
  ctxUsed: number | null
  ctxWindow: number
  ctxPercent: number | null
  rate5: number | null
  rate7: number | null
  /** Context by source; null until the first breakdown arrives. */
  parts: Part[] | null
  /** True when parts came from the exact token count, false for the local estimate. */
  isExact: boolean
}

/** The Handoff button's progress: pressed and queued, then being written. */
export type Handoff =
  | { phase: 'idle' }
  | {
      phase: 'queued' | 'writing'
      /** The surface the press came from, so the copy lands on that clipboard. */
      surface: 'terminal' | 'desktop' | 'mobile' | 'vscode'
    }

/** One question in the side-question panel: waiting, answered, or failed. */
export type SideTurn =
  | { question: string; state: 'pending' }
  | { question: string; state: 'answered'; answer: string }
  | {
      question: string
      state: 'failed'
      /** Why no answer came, in plain words. */
      failure: string
    }

/** The side-question panel: its thread, the unsent text, and what it is busy with. */
export type Side = {
  turns: SideTurn[]
  /** The text in the typing box, kept so a redraw or a reopened panel does not lose it. */
  draft: string
  /** Bumped each time a question is taken, which empties the typing box. */
  draftSeq: number
  isAsking: boolean
}

/** The main thread's prompt cache, as of its last model request. */
export type CacheSeen = {
  /** When that request was sent, in ms; the cache's lifetime counts from here. */
  sentAt: number
  /** That request's whole input plus its output: about what the next request re-stores once the cache lapses. */
  prefix: number
  /** The cache's lifetime in ms, read from the transcript; null until read. */
  ttlMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'desk-status': {
      line: Line | null
      isOpen: boolean
      /** The time the cache item counts from; only moves forward. Ticks every 30 seconds. */
      now: number
      handoff: Handoff
      /** True from a Compact press until the compaction ends or is refused. */
      isCompacting: boolean
      side: Side
      /** Null until the main thread's first reply. */
      cache: CacheSeen | null
    }
  }
}
