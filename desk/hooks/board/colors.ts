// Every colour value the board draws with, from the design system's tokens. Nothing here calls the engine.
// An Svg cannot read the theme, and a Box fill takes a value rather than a theme key, so these are written out.
// Text colours are not here: they are the engine's theme keys, which follow the theme.

/** `line-divider`: the rule between an open Card's sections. See-through grey, so one value reads on either theme. */
export const LINE_DIVIDER = 'rgba(128, 128, 128, 0.25)'
/** `line-guide`: the timeline that joins a Transcript's rows. */
export const LINE_GUIDE = 'rgba(128, 128, 128, 0.40)'

/** `fill-raised`: a Card's block, a step off either theme's pane. */
export const FILL_RAISED = 'rgba(128, 128, 128, 0.10)'
/** `fill-failed`: the tint of a failed Tool call's row. */
export const FILL_FAILED = 'rgba(229, 83, 75, 0.14)'

/** `icon-ink`: the one grey every tool icon is drawn in. */
export const ICON_INK = '#8b949e'

/** The progress bar's fill while the agent runs, and the Transcript's dot for the message being written. */
export const BAR_LIVE = '#d77757'
/** The progress bar's fill once the agent finished or stopped, and the Transcript's dot for a message. */
export const BAR_DONE = '#8b949e'
/** The red of the critter's flame and of a failed agent's bar. */
export const FAILED_RED = '#e5534b'
/** The bar's track, under its fill. */
export const BAR_TRACK = 'rgba(139, 148, 158, 0.3)'

/** The critter's pixels, one letter each: body, eye, and the colours of its six hats. */
export const CRITTER_INK: Record<string, string> = {
  b: '#e8836b',
  e: '#2b1d1a',
  g: '#2fa36b',
  p: '#c9d1d9',
  F: FAILED_RED,
  w: '#f0f0f0',
  u: '#4c8df6',
  k: '#1e293b',
  y: '#f2c94c',
  n: '#7a5230',
  L: '#f5e7a1',
  c: '#a371f7',
}
