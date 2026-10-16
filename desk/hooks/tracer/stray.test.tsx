// The tracer's `ui.press` hook takes only the keys its own buttons carry: a press of the mod's own plugin on any
// other key goes on to the next hook. The tracer draws no Button with such a key, so a plugin above the mod
// rewrites a real press to one.
import { expect, test, type Plugin } from 'claude-code/testing'

import { engine, pane } from './testkit'
import { CWD, boot, pressesReaching } from '../testkit'

/** A plugin above the mod that sends every press on to the key `stray-key`, as a Button the mod never drew would have. */
const STRAYER: Plugin = {
  name: 'strayer',
  tier: 'prepend',
  register(on) {
    on('ui.press', async (_$, e, next) => next({ ...e, element: 'stray-key' }))
  },
}

test(
  "a press of the mod's own plugin on a key no tracer button has goes on to the next hook",
  { plugins: [STRAYER] },
  async ($, on) => {
    engine(on)
    const reached = pressesReaching(on)
    await boot($)
    await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: `${CWD}/a.ts` })
    const ui = await $.ui.mount(pane('desktop'))

    await ui.press({ key: 'show-trail' })

    expect(reached).toEqual(['stray-key'])
    await ui.unmount()
  },
)
