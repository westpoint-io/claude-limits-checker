import type { SessionRateLimit } from 'claude-code'

const MINUTE = 60_000

/** When a watched model is fine for deep research: both must hold. */
export type Rule = { resetWithinMinutes: number; weeklyMaxPercent: number }

/** What we know about the two windows right now; undefined when Claude Code has no reading. */
export type Limits = { fiveHourPct?: number; resetInMinutes?: number; weeklyPct?: number }

export type Family = 'fable' | 'opus' | 'sonnet' | 'haiku'

export const NAMES: Record<Family, string> = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' }

export const familyOf = (model: string): Family | undefined => {
  const name = model.toLowerCase()
  if (name.includes('fable') || name.includes('mythos')) return 'fable'
  if (name.includes('opus')) return 'opus'
  if (name.includes('sonnet')) return 'sonnet'
  if (name.includes('haiku')) return 'haiku'

  return undefined
}

/** The models the check can watch: the expensive ones. */
export const WATCHABLE: Family[] = ['fable', 'opus']

/** The `models` setting, `fable, opus`, as the families it names. Anything else is ignored. */
export const parseModels = (setting: string): Set<Family> =>
  new Set(
    setting
      .split(/[\s,]+/)
      .map(word => familyOf(word))
      .filter((f): f is Family => f !== undefined && WATCHABLE.includes(f)),
  )

/** What the dialog offers on `current`: the other of Sonnet and Opus, keep, cancel. */
export const choicesFor = (current: Family): string[] => [
  ...(['sonnet', 'opus'] as const).filter(f => f !== current).map(f => NAMES[f]),
  `Keep ${NAMES[current]}`,
  'Cancel',
]

export const readLimits = (rateLimits: readonly SessionRateLimit[], now: number): Limits => {
  const five = rateLimits.find(w => w.kind === 'five_hour')
  const week = rateLimits.find(w => w.kind === 'seven_day')
  const resetsAt = five?.resetsAt ? Date.parse(five.resetsAt) : undefined

  return {
    fiveHourPct: five?.percentUsed,
    resetInMinutes: resetsAt === undefined ? undefined : Math.max(0, (resetsAt - now) / MINUTE),
    weeklyPct: week?.percentUsed,
  }
}

/** Fable is allowed only when the 5h window resets soon AND the week isn't too used. */
export const allows = (limits: Limits, rule: Rule): boolean =>
  limits.resetInMinutes !== undefined &&
  limits.resetInMinutes < rule.resetWithinMinutes &&
  limits.weeklyPct !== undefined &&
  limits.weeklyPct < rule.weeklyMaxPercent

/** Same format as the status line's reset countdown: 2d 4h, 3h 12m, 12m. */
export const countdown = (minutes: number): string => {
  const m = Math.max(0, Math.floor(minutes))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m % 60}m`

  return `${m}m`
}

/** The two conditions, each with whether it passes. */
export const explain = (limits: Limits, rule: Rule): string[] => {
  const mark = (ok: boolean) => (ok ? '✓' : '✗')
  const reset =
    limits.resetInMinutes === undefined
      ? `? 5h reset not known yet (needs under ${rule.resetWithinMinutes} min)`
      : `${mark(limits.resetInMinutes < rule.resetWithinMinutes)} 5h resets in ${countdown(limits.resetInMinutes)} (needs under ${rule.resetWithinMinutes} min)`
  const week =
    limits.weeklyPct === undefined
      ? `? Weekly usage not known yet (needs under ${rule.weeklyMaxPercent}%)`
      : `${mark(limits.weeklyPct < rule.weeklyMaxPercent)} Weekly ${Math.round(limits.weeklyPct)}% used (needs under ${rule.weeklyMaxPercent}%)`

  return [reset, week]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** The clock face showing `d` to the nearest half hour: 21:20 is 🕤, 09:05 is 🕘. */
export const clockFace = (d: Date): string => {
  const halfHours = Math.round((d.getHours() * 60 + d.getMinutes()) / 30)
  const hour = (Math.floor(halfHours / 2) + 11) % 12
  const base = halfHours % 2 === 0 ? 0x1f550 : 0x1f55c

  return String.fromCodePoint(base + hour)
}

/** `🕤 5h 1% 21:20 | 🗓️ 7d 50% Oct 6 21:20`, or undefined when there's no reading. */
export const limitsLine = (rateLimits: readonly SessionRateLimit[]): string | undefined => {
  const parts: string[] = []
  const five = rateLimits.find(w => w.kind === 'five_hour')
  const week = rateLimits.find(w => w.kind === 'seven_day')
  if (five) {
    const d = five.resetsAt ? new Date(five.resetsAt) : undefined
    const at = d ? ` ${hhmm(d)}` : ''
    parts.push(`${d ? clockFace(d) : '🕐'} 5h ${Math.round(five.percentUsed)}%${at}`)
  }
  if (week) {
    const d = week.resetsAt ? new Date(week.resetsAt) : undefined
    const at = d ? ` ${MONTHS[d.getMonth()]} ${d.getDate()} ${hhmm(d)}` : ''
    parts.push(`🗓️ 7d ${Math.round(week.percentUsed)}%${at}`)
  }

  return parts.length > 0 ? parts.join(' | ') : undefined
}
