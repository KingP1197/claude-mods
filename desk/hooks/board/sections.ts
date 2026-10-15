// The open Card's sections: the divider that opens each one, and what each remembers. Nothing here calls the engine.
import type { CardSections } from '../../types'
import type { SectionName } from './agents'
import { LINE_DIVIDER } from './colors'

/** The pixel height of a desktop divider. */
export const DIVIDER_H = 1

/** A one-pixel line that stretches to the width of its box. */
export const dividerSvg = (): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${DIVIDER_H}" viewBox="0 0 1000 ${DIVIDER_H}" preserveAspectRatio="none" style="display:block">` +
  `<rect width="1000" height="${DIVIDER_H}" fill="${LINE_DIVIDER}"/></svg>`

/** What a terminal rule says between its corners: the chevron, the title and the count, with the spaces
 *  that set them off. The untitled footer rule says nothing. */
export const ruleLabel = (title: string, count: number | null): string =>
  title === '' ? '' : ` ▾ ${title}${count === null ? '' : ` ${count}`} `

/** The run of `─` that carries a rule from its label to its `┤`, so the whole rule is `cells` wide: a titled
 *  rule opens with `├─`, an untitled one with `├`. */
export const ruleTail = (cells: number, label: string): string =>
  '─'.repeat(Math.max(1, cells - (label === '' ? 2 : 3) - label.length))

/** How many characters of the Brief show before `Show whole brief`, the ellipsis counted. */
export const BRIEF_CHARS = 240

/** The Brief as the card shows it: whole, or cut to 240 characters ending in `…` when longer. */
export const briefShown = (task: string, isWhole: boolean): string =>
  isWhole || task.length <= BRIEF_CHARS ? task : `${task.slice(0, BRIEF_CHARS - 1)}…`

/** A card's sections with every missing field filled: both open, the brief cut, only the newest entries. */
export const sectionsOf = (saved: Record<string, CardSections>, id: string) => {
  const now = saved[id] ?? {}
  return {
    isBriefOpen: now.isBriefOpen ?? true,
    isTranscriptOpen: now.isTranscriptOpen ?? true,
    isBriefWhole: now.isBriefWhole ?? false,
    isEarlierShown: now.isEarlierShown ?? false,
    flippedCalls: now.flippedCalls ?? [],
    openThoughts: now.openThoughts ?? [],
  }
}

/** The saved sections with one card's Brief shown whole if it was cut, cut if it was whole. */
export const toggledWhole = (saved: Record<string, CardSections>, id: string) => ({
  ...saved,
  [id]: { ...sectionsOf(saved, id), isBriefWhole: !sectionsOf(saved, id).isBriefWhole },
})

/** The saved sections with one card's Transcript showing every entry if it showed the newest, the newest if all. */
export const toggledEarlier = (saved: Record<string, CardSections>, id: string) => ({
  ...saved,
  [id]: { ...sectionsOf(saved, id), isEarlierShown: !sectionsOf(saved, id).isEarlierShown },
})

/** The saved sections with one section of one card opened if it was closed, closed if it was open. */
export const toggledSection = (saved: Record<string, CardSections>, id: string, which: SectionName) => {
  const now = sectionsOf(saved, id)
  return {
    ...saved,
    [id]: {
      ...now,
      ...(which === 'brief' ? { isBriefOpen: !now.isBriefOpen } : { isTranscriptOpen: !now.isTranscriptOpen }),
    },
  }
}

/** Whether a Tool call of a card is open: it starts closed, or open when it failed, and each press flips it. */
export const isCallOpen = (saved: Record<string, CardSections>, id: string, callId: string, isFailed: boolean) =>
  sectionsOf(saved, id).flippedCalls.includes(callId) !== isFailed

/** The saved sections with one Tool call of one card flipped: opened if it was closed, closed if it was open. */
export const toggledCall = (saved: Record<string, CardSections>, id: string, callId: string) => {
  const flipped = sectionsOf(saved, id).flippedCalls
  return {
    ...saved,
    [id]: {
      ...sectionsOf(saved, id),
      flippedCalls: flipped.includes(callId) ? flipped.filter((c) => c !== callId) : [...flipped, callId],
    },
  }
}

/** Whether a Thought of a card is open: it starts closed, and each press flips it. */
export const isThoughtOpen = (saved: Record<string, CardSections>, id: string, thoughtId: string) =>
  sectionsOf(saved, id).openThoughts.includes(thoughtId)

/** The saved sections with one Thought of one card opened if it was closed, closed if it was open. */
export const toggledThought = (saved: Record<string, CardSections>, id: string, thoughtId: string) => {
  const open = sectionsOf(saved, id).openThoughts
  return {
    ...saved,
    [id]: {
      ...sectionsOf(saved, id),
      openThoughts: open.includes(thoughtId) ? open.filter((t) => t !== thoughtId) : [...open, thoughtId],
    },
  }
}

/** The key of a Tool call's chevron: its card, then the call. */
export const callKey = (id: string, callId: string) => `call:${id}:${callId}`

/** The card and Tool call a chevron's key names, or null for any other key. */
export function callPress(key: string | undefined): { id: string; callId: string } | null {
  const m = /^call:([^:]+):(.+)$/.exec(key ?? '')
  return m === null ? null : { id: m[1] ?? '', callId: m[2] ?? '' }
}

/** The key of a Thought's chevron: its card, then the Thought. */
export const thoughtKey = (id: string, thoughtId: string) => `thought:${id}:${thoughtId}`

/** The card and Thought a Thought chevron's key names, or null for any other key. */
export function thoughtPress(key: string | undefined): { id: string; thoughtId: string } | null {
  const m = /^thought:([^:]+):(.+)$/.exec(key ?? '')
  return m === null ? null : { id: m[1] ?? '', thoughtId: m[2] ?? '' }
}
