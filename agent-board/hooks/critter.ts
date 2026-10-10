// The board's pictures, as SVG strings: a pixel critter whose hat shows the effort tier, and a progress bar.
// Nothing here calls the engine.

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

const INK: Record<string, string> = {
  b: '#e8836b',
  e: '#2b1d1a',
  g: '#2fa36b',
  p: '#c9d1d9',
  F: '#e5534b',
  w: '#f0f0f0',
  u: '#4c8df6',
  k: '#1e293b',
  y: '#f2c94c',
  n: '#7a5230',
  L: '#f5e7a1',
  c: '#a371f7',
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
      const fill = INK[ch]
      return fill === undefined ? [] : [`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`]
    }),
  )
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CRITTER_W}" height="${CRITTER_H}" viewBox="0 0 ${COLS} ${ROWS}" shape-rendering="crispEdges">` +
    `<g opacity="${isFaded ? 0.45 : 1}">${rects.join('')}</g></svg>`
  )
}

/** A bar filled to `fraction` in `color`, over a grey track. It stretches to the width of its box. */
export function barSvg(fraction: number, color: string): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * 1000)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${BAR_H}" viewBox="0 0 1000 ${BAR_H}" preserveAspectRatio="none" style="display:block">` +
    `<rect width="1000" height="${BAR_H}" fill="#8b949e" fill-opacity="0.3"/>` +
    `<rect width="${filled}" height="${BAR_H}" fill="${color}"/></svg>`
  )
}
