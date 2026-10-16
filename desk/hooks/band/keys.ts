// The addresses of the band's buttons: each drawn Button's key, and the name a pressed key stands for.
// Nothing here calls the engine.

/** The band's pressable Buttons; each one's key is its name. */
export const BAND_BUTTONS = [
  'tracer',
  'side',
  'compact',
  'handoff',
  'agents',
  'details',
  'openpane',
  'clearthread',
  'autowarm',
  'cstate',
] as const

/** One of the band's Buttons. */
export type BandButton = (typeof BAND_BUTTONS)[number]

const isBandButton = (key: string): key is BandButton => (BAND_BUTTONS as readonly string[]).includes(key)

/** The band Button a pressed key names; null for a key that is none of the band's, such as a board or tracer button. */
export const bandButtonOf = (key: string | undefined): BandButton | null =>
  key !== undefined && isBandButton(key) ? key : null

/** What each Button's press does, in words that finish "Could not ...": the toast for a press whose action threw. */
export const BAND_DOING: Record<BandButton, string> = {
  tracer: 'open the file tracer',
  side: 'show or hide the side question',
  compact: 'compact the chat',
  handoff: 'write the handoff',
  agents: 'open the agent board',
  details: 'show or hide the details',
  openpane: 'open the side questions pane',
  clearthread: 'clear the side questions',
  autowarm: 'turn auto warm on or off',
  cstate: 'turn auto warm on or off',
}
