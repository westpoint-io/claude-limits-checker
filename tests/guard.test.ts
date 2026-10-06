import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const RESEARCH = 'Do a deep research on how the top 10 open source vector databases handle sharding'

type Setup = {
  model?: string
  kind?: 'deep-research' | 'other'
  resetInMinutes?: number
  weeklyPct?: number
  answer?: string
}

/** What the engine answers beneath the plugin, and what reached it. */
const engine = (on: On, s: Setup) => {
  const seen = { asked: 0, classified: 0, models: [] as string[], sent: [] as string[], ran: [] as string[] }
  const clock = mock.clock(on, { now: NOW })
  on('session.model', (() => ({ value: s.model ?? 'claude-fable-5-1' })) as never)
  on('session.usage', (() => ({ value: {
    startedAt: NOW,
    context: {} as never,
    rateLimits: [
      {
        kind: 'five_hour',
        percentUsed: 40,
        resetsAt: new Date(NOW + (s.resetInMinutes ?? 180) * 60_000).toISOString(),
      },
      { kind: 'seven_day', percentUsed: s.weeklyPct ?? 50 },
    ],
  } })) as never)
  on('model.classify', (() => {
    seen.classified++
    return { value: s.kind ?? 'deep-research' }
  }) as never)
  // $.ui.ask runs the AskUserQuestion tool; answer it as the person would.
  on('tool.call', { tool: 'AskUserQuestion' }, (($: unknown, e: { questions: { question: string }[] }) => {
    seen.asked++
    const questions = e.questions
    return { result: { questions, answers: { [questions[0]!.question]: s.answer ?? 'Cancel' } } }
  }) as never)
  on('command.run', ($, e) => {
    if (e.command === 'model') seen.models.push(e.args)
    else seen.ran.push(`/${e.command} ${e.args}`.trim())
    return { text: '' }
  })
  on('prompt.submit', ($, e) => {
    seen.sent.push(e.text)
    return { text: e.text }
  })

  return { seen, clock }
}

const submit = (text: string) => ({ text, attachments: undefined }) as never

test('deep research on Fable far from the reset: asks, Cancel drops it', async ($, on) => {
  const { seen } = engine(on, { answer: 'Cancel' })
  const out = await $.prompt.submit(submit(RESEARCH))
  expect(seen.asked).toBe(1)
  expect(out.drop).toMatch(/cancelled/)
  expect(seen.sent).toEqual([])
})

test('Keep Fable sends it as is', async ($, on) => {
  const { seen } = engine(on, { answer: 'Keep Fable' })
  const out = await $.prompt.submit(submit(RESEARCH))
  expect(out.drop).toBeUndefined()
  expect(seen.sent).toEqual([RESEARCH])
  expect(seen.models).toEqual([])
})

for (const [answer, alias] of [
  ['Sonnet', 'sonnet'],
  ['Opus', 'opus'],
] as const) {
  test(`${answer} switches the model and sends the prompt again`, async ($, on) => {
    const { seen, clock } = engine(on, { answer })
    const out = await $.prompt.submit(submit(RESEARCH))
    expect(out.drop).toMatch(new RegExp(answer))
    await clock.advance(1)
    expect(seen.models).toEqual([alias])
    expect(seen.sent).toEqual([RESEARCH])
  })
}

test('under 30m to the 5h reset and weekly under 75%: no question', async ($, on) => {
  const { seen } = engine(on, { resetInMinutes: 20, weeklyPct: 60 })
  await $.prompt.submit(submit(RESEARCH))
  expect(seen.asked).toBe(0)
  expect(seen.sent).toEqual([RESEARCH])
})

test('close to the reset but weekly over 75%: still asks', async ($, on) => {
  const { seen } = engine(on, { resetInMinutes: 20, weeklyPct: 80 })
  await $.prompt.submit(submit(RESEARCH))
  expect(seen.asked).toBe(1)
})

test('thresholds come from the config', { options: { resetWithinMinutes: 60, weeklyMaxPercent: 90 } }, async ($, on) => {
  const { seen } = engine(on, { resetInMinutes: 45, weeklyPct: 85 })
  await $.prompt.submit(submit(RESEARCH))
  expect(seen.asked).toBe(0)
})

test('not deep research: no question', async ($, on) => {
  const { seen } = engine(on, { kind: 'other' })
  await $.prompt.submit(submit('rename this variable to userId please'))
  expect(seen.asked).toBe(0)
})

test('not on Fable: no classify, no question', async ($, on) => {
  const { seen } = engine(on, { model: 'claude-sonnet-5-5' })
  await $.prompt.submit(submit(RESEARCH))
  expect(seen.classified).toBe(0)
  expect(seen.asked).toBe(0)
})

test('Opus is not watched by default', async ($, on) => {
  const { seen } = engine(on, { model: 'claude-opus-5-5' })
  await $.prompt.submit(submit(RESEARCH))
  expect(seen.asked).toBe(0)
})

test('watching Opus asks there too, and Keep Opus sends it', { options: { models: 'fable, opus' } }, async ($, on) => {
  const { seen } = engine(on, { model: 'claude-opus-5-5', answer: 'Keep Opus' })
  const out = await $.prompt.submit(submit(RESEARCH))
  expect(seen.asked).toBe(1)
  expect(out.drop).toBeUndefined()
  expect(seen.sent).toEqual([RESEARCH])
})

test('/limits explains the current verdict', async ($, on) => {
  on('ui.open', (() => ({ value: { isPlaced: true } })) as never)
  engine(on, { resetInMinutes: 192, weeklyPct: 42 })
  const out = await $.command.run({ command: 'limits', args: '' } as never)
  expect(out.text).toMatch(/Deep research on Fable asks first right now\. You're on Fable\./)
  expect(out.text).toMatch(/✗ 5h resets in 3h 12m/)
  expect(out.text).toMatch(/✓ Weekly 42% used/)
})

const command = (name: string, args = '') => ({ command: name, args }) as never

test('/deep-research on Fable far from the reset: asks, Cancel stops it', async ($, on) => {
  const { seen } = engine(on, { answer: 'Cancel' })
  const out = await $.command.run(command('deep-research', 'what are claude code mods'))
  expect(seen.asked).toBe(1)
  expect(out.text).toMatch(/cancelled/)
  expect(seen.ran).toEqual([])
})

test('/deep-research with Keep Fable runs as typed', async ($, on) => {
  const { seen } = engine(on, { answer: 'Keep Fable' })
  await $.command.run(command('deep-research', 'what are claude code mods'))
  expect(seen.ran).toEqual(['/deep-research what are claude code mods'])
  expect(seen.models).toEqual([])
})

test('/deep-research with Sonnet switches the model and runs it again', async ($, on) => {
  const { seen, clock } = engine(on, { answer: 'Sonnet' })
  const out = await $.command.run(command('deep-research', 'what are claude code mods'))
  expect(out.text).toMatch(/Switching to Sonnet/)
  expect(seen.ran).toEqual([])
  await clock.advance(1)
  expect(seen.models).toEqual(['sonnet'])
  expect(seen.ran).toEqual(['/deep-research what are claude code mods'])
})

test('/deep-research inside the window runs without asking', async ($, on) => {
  const { seen } = engine(on, { resetInMinutes: 20, weeklyPct: 60 })
  await $.command.run(command('deep-research', 'x'))
  expect(seen.asked).toBe(0)
  expect(seen.ran).toEqual(['/deep-research x'])
})

test('/deep-research on an unwatched model, and /autoresearch, are left alone', async ($, on) => {
  const { seen } = engine(on, { model: 'claude-sonnet-5-5' })
  await $.command.run(command('deep-research', 'x'))
  await $.command.run(command('autoresearch', 'y'))
  expect(seen.asked).toBe(0)
  expect(seen.ran).toEqual(['/deep-research x', '/autoresearch y'])
})
