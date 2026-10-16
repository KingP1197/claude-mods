// Which form the tracer takes, per drawing and per press. Plain values only; register.tsx asks the engine for the
// surface and the roster and passes them here.
import type { RenderSurface } from 'claude-code'

import { isAppAttached } from '../surface'

/**
 * Whether a drawing, or a press, on `surface` takes the App form: the tree and the Trail with no File view, a file
 * press following the Open rule into the app's own panes. `roster` is what `$.session.surfaces()` answers. The
 * terminal always takes the full form, even with the app attached; every other surface takes the App form wherever
 * the desktop app is attached.
 */
export const isAppFormOn = (surface: RenderSurface, roster: readonly string[]): boolean =>
  surface !== 'terminal' && isAppAttached(roster)
