// The board's pictures, as SVG strings: a pixel critter whose hat shows the effort tier, and a progress bar.
// Nothing here calls the engine.

import { BAR_DONE, BAR_LIVE, BAR_TRACK, CRITTER_INK, FAILED_RED } from './colors'

export type Hat = 'light' | 'medium' | 'careful' | 'heavy' | 'max' | 'none'

// One letter per pixel, twelve across; a dot is see-through. Each hat is three rows, the body six.
const HATS: Record<Hat, readonly string[]> = {
  // A green cap with a flag.
  light: ['........pFF.', '...gggg.p...', '..gggggggggg'],
  // A white captain's hat with a blue band and a dark brim.
  medium: ['...wwwwww...', '..uuuuuuuu..', '..kkkkkkkkkk'],
  // A yellow hard hat.
  careful: ['....yyyy....', '...yyyyyy...', '.yyyyyyyyyy.'],
  // A brown miner's helmet with a lamp.
  heavy: ['....nnnn....', '...nnnnnnLL.', '..nnnnnnnn..'],
  // A purple crown.
  max: ['..c..cc..c..', '..cccccccc..', '..cccccccc..'],
  none: ['............', '............', '............'],
}

const BODY = ['..bbbbbbbb..', '..bebbbbeb..', 'bbbbbbbbbbbb', '..bbbbbbbb..', '..b.b..b.b..', '..b.b..b.b..']

// The pixel letter that carries each hat's own colour (the medium captain's hat is white, so its blue band).
const HAT_INK: Record<Hat, string | null> = { light: 'g', medium: 'u', careful: 'y', heavy: 'n', max: 'c', none: null }

/** The colour a hat is drawn in, for the terminal's text marks. Null for no hat. */
export function hatColor(hat: Hat): string | null {
  const letter = HAT_INK[hat]
  return letter === null ? null : (CRITTER_INK[letter] ?? null)
}

const COLS = 12
const ROWS = 9
// CSS pixels per critter pixel.
const PX = 3
export const CRITTER_W = COLS * PX
export const CRITTER_H = ROWS * PX
// The progress bar's height in CSS pixels.
export const BAR_H = 5

/** The critter in its tier's hat; faded for an agent that failed, was stopped or got lost. */
export function critterSvg(hat: Hat, isFaded: boolean): string {
  const rows = [...HATS[hat], ...BODY]
  const rects = rows.flatMap((row, y) =>
    [...row].flatMap((ch, x) => {
      const fill = CRITTER_INK[ch]
      return fill === undefined ? [] : [`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`]
    }),
  )
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CRITTER_W}" height="${CRITTER_H}" viewBox="0 0 ${COLS} ${ROWS}" shape-rendering="crispEdges">` +
    `<g opacity="${isFaded ? 0.45 : 1}">${rects.join('')}</g></svg>`
  )
}

/** The bar's fill by state: while running; finished or stopped; failed. Fixed colours, since an Svg cannot read the theme. */
export type BarKind = 'live' | 'done' | 'failed'
const BAR_FILL: Record<BarKind, string> = { live: BAR_LIVE, done: BAR_DONE, failed: FAILED_RED }

/** A bar filled to `fraction` in its kind's colour, over a see-through grey track. It stretches to the width of its box. */
export function barSvg(fraction: number, kind: BarKind): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * 1000)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${BAR_H}" viewBox="0 0 1000 ${BAR_H}" preserveAspectRatio="none" style="display:block">` +
    `<rect width="1000" height="${BAR_H}" fill="${BAR_TRACK}"/>` +
    `<rect width="${filled}" height="${BAR_H}" fill="${BAR_FILL[kind]}"/></svg>`
  )
}
