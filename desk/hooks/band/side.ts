// The side-question panel's wording and checks. Nothing here calls the engine:
// the validator follows `$` only within one file, so the hooks live in register.tsx.
// A side question is one tool-less request over a copy of the main chat ($.model.fork),
// so the main agent never sees it and the main chat's context does not grow.
import type { ModelForkResult } from 'claude-code'

import type { Side, SideTurn } from '../../types'

export const SIDE_PANE = 'side-questions'
export const NO_SIDE: Side = { turns: [], draft: '', draftSeq: 0, isAsking: false }
/** The typing box's key in the panel. */
export const ASK_BOX = 'askbox'

/** A turn as versions before the tagged turn saved it: two nullable fields. */
type OldTurn = { question: string; answer: string | null; failure: string | null }

const turnOf = (t: SideTurn | OldTurn): SideTurn => {
  if ('state' in t) return t
  if (t.answer !== null) return { question: t.question, state: 'answered', answer: t.answer }
  if (t.failure !== null) return { question: t.question, state: 'failed', failure: t.failure }
  return { question: t.question, state: 'pending' }
}

/** Saved state outlives a reload: fills in fields an older version left out, and moves old turns to the tagged shape. */
export function sideOf(saved: Side): Side {
  const s = { ...NO_SIDE, ...saved }
  return { ...s, turns: (s.turns as readonly (SideTurn | OldTurn)[]).map(turnOf) }
}

const answered = (turns: readonly SideTurn[]) =>
  turns.filter((t): t is Extract<SideTurn, { state: 'answered' }> => t.state === 'answered')

const thread = (turns: readonly SideTurn[]) =>
  answered(turns)
    .map((t) => `Question: ${t.question}\nYour answer: ${t.answer}`)
    .join('\n\n')

/** The one message the fork answers: the framing, the side thread so far, then the new question. */
export function sidePrompt(earlier: readonly SideTurn[], question: string): string {
  const head =
    'This is a side question, asked in a separate window. It is not part of the main conversation: ' +
    'the main agent will never see it or your answer. You have no tools, so answer only from what ' +
    'is already in this conversation, and say so when that is not enough. Keep it short and plain.'
  const before = answered(earlier)
  return before.length === 0
    ? `${head}\n\nQuestion: ${question}`
    : `${head}\n\nEarlier side questions in this window:\n\n${thread(before)}\n\nNew question: ${question}`
}

/** Why a side question got no answer, in plain words. */
export function forkFailure(r: ModelForkResult): string {
  if (r.isAnswered) return ''
  switch (r.reason) {
    case 'nothing-to-fork':
      return 'No answer: the main chat has no reply yet to ask about.'
    case 'api-error':
      return `No answer: the request failed${r.status === null ? '' : ` (HTTP ${r.status})`}.`
    case 'empty-reply':
      return 'No answer: Claude sent back no text.'
    case 'aborted':
      return 'No answer: the question was cut off.'
  }
}
