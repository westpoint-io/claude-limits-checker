import { describe, expect, test } from 'claude-code/testing'

import { allows, choicesFor, clockFace, countdown, familyOf, limitsLine, parseModels, readLimits } from '../hooks/rules'

const RULE = { resetWithinMinutes: 30, weeklyMaxPercent: 75 }

describe('allows', () => {
  test('5h resets in under 30m and weekly under 75%: Fable is fine', () => {
    expect(allows({ resetInMinutes: 20, weeklyPct: 40 }, RULE)).toBe(true)
  })

  test('5h reset too far away: ask', () => {
    expect(allows({ resetInMinutes: 45, weeklyPct: 40 }, RULE)).toBe(false)
  })

  test('weekly too high: ask, even right before the reset', () => {
    expect(allows({ resetInMinutes: 5, weeklyPct: 80 }, RULE)).toBe(false)
  })

  test('the limits themselves do not pass', () => {
    expect(allows({ resetInMinutes: 30, weeklyPct: 40 }, RULE)).toBe(false)
    expect(allows({ resetInMinutes: 20, weeklyPct: 75 }, RULE)).toBe(false)
  })

  test('no reading yet: ask', () => {
    expect(allows({}, RULE)).toBe(false)
  })

  test('config changes the thresholds', () => {
    expect(allows({ resetInMinutes: 50, weeklyPct: 85 }, { resetWithinMinutes: 60, weeklyMaxPercent: 90 })).toBe(true)
  })
})

test('reads the 5h reset and weekly % from the rate-limit windows', () => {
  const now = Date.parse('2026-10-06T12:00:00Z')
  const limits = readLimits(
    [
      { kind: 'five_hour', percentUsed: 52, resetsAt: '2026-10-06T12:20:00Z' },
      { kind: 'seven_day', percentUsed: 61, resetsAt: '2026-10-09T00:00:00Z' },
    ],
    now,
  )
  expect(limits).toEqual({ fiveHourPct: 52, resetInMinutes: 20, weeklyPct: 61 })
})

test('model names map to families, Mythos counts as Fable', () => {
  expect(familyOf('claude-fable-5-1')).toBe('fable')
  expect(familyOf('claude-mythos-5-1')).toBe('fable')
  expect(familyOf('claude-opus-5-5')).toBe('opus')
  expect(familyOf('claude-haiku-4-5-20251001')).toBe('haiku')
  expect(familyOf('mystery')).toBeUndefined()
})

test('the models setting reads like you type it', () => {
  expect([...parseModels('fable')]).toEqual(['fable'])
  expect([...parseModels('Fable, opus')]).toEqual(['fable', 'opus'])
  expect([...parseModels('fable opus nonsense')]).toEqual(['fable', 'opus'])
  expect([...parseModels('fable, sonnet, haiku')]).toEqual(['fable'])
  expect([...parseModels('')]).toEqual([])
})

test('the dialog never offers the model you are already on', () => {
  expect(choicesFor('fable')).toEqual(['Sonnet', 'Opus', 'Keep Fable', 'Cancel'])
  expect(choicesFor('opus')).toEqual(['Sonnet', 'Keep Opus', 'Cancel'])
  expect(choicesFor('sonnet')).toEqual(['Opus', 'Keep Sonnet', 'Cancel'])
})

test('countdown matches the status line', () => {
  expect(countdown(12)).toBe('12m')
  expect(countdown(192)).toBe('3h 12m')
  expect(countdown(3000)).toBe('2d 2h')
})

describe('status line', () => {
  const local = (m: number, d: number, h: number, min: number) => new Date(2026, m, d, h, min).toISOString()

  test('both windows with their reset times', () => {
    const line = limitsLine([
      { kind: 'five_hour', percentUsed: 1.4, resetsAt: local(9, 6, 21, 20) },
      { kind: 'seven_day', percentUsed: 50, resetsAt: local(9, 9, 9, 5) },
    ])
    expect(line).toBe('🕤 5h 1% 21:20 | 🗓️ 7d 50% Oct 9 09:05')
  })

  test('the clock face shows the reset time', () => {
    const at = (h: number, m: number) => new Date(2026, 9, 6, h, m)
    expect(clockFace(at(1, 0))).toBe('🕐')
    expect(clockFace(at(9, 5))).toBe('🕘')
    expect(clockFace(at(21, 20))).toBe('🕤')
    expect(clockFace(at(12, 0))).toBe('🕛')
    expect(clockFace(at(0, 10))).toBe('🕛')
    expect(clockFace(at(23, 50))).toBe('🕛')
    expect(clockFace(at(12, 30))).toBe('🕧')
  })

  test('only what Claude Code reported', () => {
    expect(limitsLine([{ kind: 'seven_day', percentUsed: 73 }])).toBe('🗓️ 7d 73%')
    expect(limitsLine([])).toBeUndefined()
  })
})
