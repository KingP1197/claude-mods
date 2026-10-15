// The entry file of the merged mod `desk`: it calls each area's `register(on)`, band, board, tracer, in that order.
// The loader's rules: a hook hands `$` only to functions declared in its own file, never across an import; and
// one hook per event without a matcher. So an event two areas hook is registered by each area in its own file,
// behind an empty matcher `{}`, which the loader counts as matched and which every event satisfies. The engine
// chains them in registration order, and each carries `.catch(($, e, next) => next(e))` so a throw in one area
// leaves the others whole: the event goes on as if that area were absent, with a `next()` it made replayed.
import type { Register } from 'claude-code'

import { register as registerBand } from './band/register'
import { register as registerBoard } from './board/register'
import { register as registerTracer } from './tracer/register'

export const register: Register = (on) => {
  registerBand(on)
  registerBoard(on)
  registerTracer(on)
}
