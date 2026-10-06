import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-06T12:00:00Z')

const PANE = {
  plugin: 'limits',
  component: 'Pane',
  requestId: 'limits-settings',
  props: {
    title: 'Limits settings',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

/** The engine beneath the plugin; records every setting written. */
const engine = (on: On, deny?: string, noRow = false) => {
  const saved: Record<string, unknown> = {}
  const stored: Record<string, unknown> = {}
  const opened: string[] = []
  mock.clock(on, { now: NOW })
  on('store.get', (($: unknown, e: { key: string }) => ({ value: stored[e.key] })) as never)
  on('store.set', (($: unknown, e: { key: string; value: unknown }) => {
    stored[e.key] = e.value
    return { value: undefined }
  }) as never)
  on('store.delete', (($: unknown, e: { key: string }) => {
    delete stored[e.key]
    return { value: undefined }
  }) as never)
  on('session.model', (() => ({ value: 'claude-fable-5-1' })) as never)
  on('session.usage', (() => ({
    value: {
      startedAt: NOW,
      context: {},
      rateLimits: [
        { kind: 'five_hour', percentUsed: 1, resetsAt: new Date(NOW + 240 * 60_000).toISOString() },
        { kind: 'seven_day', percentUsed: 50, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() },
      ],
    },
  })) as never)
  on('config.set', ($, e) => {
    if (noRow) throw new Error(`no config row ${e.key}`)
    if (deny) return { deny }
    saved[e.key] = e.value
    return { value: e.value }
  })
  on('ui.open', (($: unknown, e: { id: string }) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  }) as never)
  on('ui.status', (() => ({ value: undefined })) as never)

  return { saved, stored, opened }
}

test('/limits shows the report and opens the pane with it', async ($, on) => {
  const { opened } = engine(on)
  const out = await $.command.run({ command: 'limits', args: '' } as never)
  expect(out.text).toMatch(/5h 1% .* 7d 50%/)
  expect(out.text).not.toMatch(/Change it/)
  expect(opened).toEqual(['limits-settings'])
})

test('/limits:settings and /limits settings both open the pane, quietly', async ($, on) => {
  const { opened } = engine(on)
  const a = await $.command.run({ command: 'limits', args: 'settings' } as never)
  const b = await $.command.run({ command: 'limits:settings', args: '' } as never)
  expect(a.text).toBeUndefined()
  expect(b.text).toBeUndefined()
  expect(opened).toEqual(['limits-settings', 'limits-settings'])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: toggling Opus saves the models setting`, async ($, on) => {
    const { saved } = engine(on)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'model-fable', text: /✓ Fable/ })).toBeDefined()
    await ui.press({ key: 'model-opus' })
    expect(saved['limits.models']).toBe('fable, opus')
    expect(await ui.find({ type: 'Text', text: /Watching Fable, Opus/ })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: the dropdowns save both thresholds`, async ($, on) => {
    const { saved } = engine(on)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.select({ key: 'minutes', value: '60' })
    await ui.select({ key: 'percent', value: '90' })
    expect(saved['limits.resetWithinMinutes']).toBe(60)
    expect(saved['limits.weeklyMaxPercent']).toBe(90)
    await ui.unmount()
  })
}

test('a refused save says so in the pane', async ($, on) => {
  engine(on, 'locked by your organization')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'model-opus' })
  expect(await ui.find({ type: 'Text', text: /Couldn't save: locked/ })).toBeDefined()
  await ui.unmount()
})

test('without a config row the pane still saves, in its own store', async ($, on) => {
  const { stored } = engine(on, undefined, true)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'model-opus' })
  expect(await ui.find({ type: 'Text', text: /Saved. Watching Fable, Opus/ })).toBeDefined()
  expect(stored.settings).toMatchObject({ models: 'fable, opus' })
  await ui.unmount()
})

test('a refused save puts the old value back', async ($, on) => {
  const { stored } = engine(on, 'locked')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'model-opus' })
  expect(await ui.find({ key: 'model-opus', text: /○ Opus/ })).toBeDefined()
  expect(stored.settings).toBeUndefined()
  await ui.unmount()
})

test('only Fable and Opus are offered', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'model-opus' })).toBeDefined()
  expect(await ui.find({ key: 'model-sonnet' })).toBeUndefined()
  expect(await ui.find({ key: 'model-haiku' })).toBeUndefined()
  await ui.unmount()
})

const OUTPUT = (text: string) =>
  ({
    plugin: 'limits',
    component: 'CommandOutput',
    props: { command: 'limits', args: '', text, isErrored: false },
  }) as const

test('/limits draws its own block, no plugin-name prefix', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      ...OUTPUT('limits: 🕤 5h 1% 21:20\nDeep research on Fable asks first right now.\n✗ 5h resets in 4h 7m (needs under 30 min)'),
      surface,
    })
    expect(await ui.find({ type: 'Text', text: /^🕤 5h 1% 21:20$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^  ✗ 5h resets/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^limits:/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the toggle turns opening on start off and saves it', async ($, on) => {
  const { saved } = engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'open-on-start', text: /✓ Open this panel/ })).toBeDefined()
  await ui.press({ key: 'open-on-start' })
  expect(saved['limits.openOnStart']).toBe(false)
  expect(await ui.find({ key: 'open-on-start', text: /○ Open this panel/ })).toBeDefined()
  await ui.unmount()
})

for (const [openOnStart, expected] of [
  [true, ['limits-settings']],
  [false, []],
] as const) {
  test(`a new session ${openOnStart ? 'opens' : 'does not open'} the panel`, { options: { openOnStart } }, async ($, on) => {
    const { opened } = engine(on)
    on('command.register', (() => ({ value: undefined })) as never)
    on('session.start', (() => ({ cwd: '/tmp' })) as never)
    await ($ as never as { session: { start: (e: unknown) => Promise<unknown> } }).session.start({ source: 'startup', cwd: '/tmp' })
    expect(opened).toEqual([...expected])
  })
}
