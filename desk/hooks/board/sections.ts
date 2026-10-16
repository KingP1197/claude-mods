// The open Card's sections: the divider that opens each one, and what each remembers. Nothing here calls the engine.
import type { CardSections } from '../../types'
import { LINE_DIVIDER } from './colors'
import type { Pressed } from './keys'

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

/** A card's sections before the user changes any: both open, the brief cut, only the newest entries. */
const DEFAULT_SECTIONS: CardSections = {
  isBriefOpen: true,
  isTranscriptOpen: true,
  isBriefWhole: false,
  isEarlierShown: false,
  flippedCalls: [],
  openThoughts: [],
}

/** A card's sections: its saved ones, or the defaults for a card with none saved. */
export const sectionsOf = (saved: Record<string, CardSections>, id: string): CardSections =>
  saved[id] ?? DEFAULT_SECTIONS

/** A press that flips part of a card's sections. */
export type SectionPress = Extract<Pressed, { kind: 'more' | 'earlier' | 'section' | 'call' | 'thought' }>

/** One card's sections with the part a press names flipped: the Brief whole or cut, the Transcript's earlier
 *  entries shown or not, a section open or closed, one Tool call or Thought opened or closed. */
function flipped(now: CardSections, p: SectionPress): CardSections {
  const flipIn = (list: readonly string[], item: string) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
  switch (p.kind) {
    case 'more':
      return { ...now, isBriefWhole: !now.isBriefWhole }
    case 'earlier':
      return { ...now, isEarlierShown: !now.isEarlierShown }
    case 'section':
      return p.which === 'brief'
        ? { ...now, isBriefOpen: !now.isBriefOpen }
        : { ...now, isTranscriptOpen: !now.isTranscriptOpen }
    case 'call':
      return { ...now, flippedCalls: flipIn(now.flippedCalls, p.callId) }
    case 'thought':
      return { ...now, openThoughts: flipIn(now.openThoughts, p.thoughtId) }
  }
}

/** The saved sections with the part of one card that a press names flipped. */
export const toggled = (saved: Record<string, CardSections>, p: SectionPress) => ({
  ...saved,
  [p.id]: flipped(sectionsOf(saved, p.id), p),
})

/** Whether a Tool call of a card is open: it starts closed, or open when it failed, and each press flips it. */
export const isCallOpen = (saved: Record<string, CardSections>, id: string, callId: string, isFailed: boolean) =>
  sectionsOf(saved, id).flippedCalls.includes(callId) !== isFailed

/** Whether a Thought of a card is open: it starts closed, and each press flips it. */
export const isThoughtOpen = (saved: Record<string, CardSections>, id: string, thoughtId: string) =>
  sectionsOf(saved, id).openThoughts.includes(thoughtId)
