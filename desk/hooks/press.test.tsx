// The merged mod's `ui.press` hooks, band, board and tracer, take only the mod's own Buttons. A Button of another
// plugin, even one keyed like a button of one of the areas, goes on down the chain to its own closure, once.
import { expect, test } from 'claude-code/testing'

import { engine } from './board/testkit'
import { OWN_PLUGIN } from './handler'
import { CWD, boot, pressesReaching } from './testkit'
import { engine as tracerEngine, pane, touchTable } from './tracer/testkit'

const FOREIGN = {
  plugin: 'desk',
  component: 'Pane',
  requestId: 'foreign',
  surface: 'desktop',
  props: {
    title: 'Foreign',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

/** Keys a band, a board and a tracer button of the mod are drawn with. */
const OWN_KEYS = ['details', 'name:tu-a#1', 'reveal', 'claude-only']

test('a Button of another plugin keyed like one of the mod buttons is not taken: its own closure runs once', async ($, on) => {
  engine(on)
  const reached = pressesReaching(on)
  const ran: string[] = []
  on('ui.render', { component: 'Pane', requestId: 'foreign' }, ($, e) => {
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box key="foreign">
        {OWN_KEYS.map((key) => (
          <Button key={key} label={key} onPress={() => ran.push(key)} />
        ))}
      </Box>
    )
  })
  await boot($)
  const ui = await $.ui.mount(FOREIGN)

  for (const key of OWN_KEYS) await ui.press({ key, plugin: 'test' })

  expect(reached).toEqual(OWN_KEYS)
  expect(ran).toEqual(OWN_KEYS)
  await ui.unmount()
})

// The board's hook runs before the tracer's, so a tracer Button reaches the tracer only if the board lets it by. A key
// the board does not own, pressed under the mod's own name, must go on to the area that does own it.
test("a press of the mod with a key the board does not own goes on down the chain to the tracer's Button", async ($, on) => {
  tracerEngine(on)
  const reached = pressesReaching(on)
  await boot($)
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: `${CWD}/a.ts` })
  const ui = await $.ui.mount(pane('desktop'))

  await ui.press({ key: 'file:a.ts', plugin: OWN_PLUGIN })

  expect((await touchTable(ui)).heading).toEqual(['Touches', '1'])
  // The tracer took it, so nothing got past all the hooks to the Button's own closure.
  expect(reached).toEqual([])
  await ui.unmount()
})
