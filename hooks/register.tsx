import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptSubmitInput, Register, SessionRateLimit } from 'claude-code'

import { NAMES, WATCHABLE, allows, choicesFor, explain, familyOf, limitsLine, parseModels, readLimits } from './rules'
import type { Family, Limits, Rule } from './rules'

type $ = EngineInterface

const ALIAS: Record<string, string> = { Sonnet: 'sonnet', Opus: 'opus' }
const FAMILIES = WATCHABLE
const PANE = 'limits-settings'
const MINUTE_STEPS = [10, 15, 20, 30, 45, 60, 90, 120]
const PERCENT_STEPS = [50, 60, 70, 75, 80, 85, 90, 95]

/** The last thing the settings pane saved, or why it couldn't. */
const notice = atom({ plugin: 'limits', key: 'notice' } as const, null)

// Set from the user's config each time the module loads.
let rule: Rule = { resetWithinMinutes: 30, weeklyMaxPercent: 75 }
let watched: Set<Family> = new Set(['fable'])
let openOnStart = true
// The config values this load started from; pane edits saved on top of them stay valid while they match.
let base = ''

type Saved = { models: string; resetWithinMinutes: number; weeklyMaxPercent: number; openOnStart: boolean; base: string }

const snapshot = () => ({
  models: FAMILIES.filter(f => watched.has(f)).join(', '),
  resetWithinMinutes: rule.resetWithinMinutes,
  weeklyMaxPercent: rule.weeklyMaxPercent,
  openOnStart,
})

const currentLimits = async ($: $): Promise<Limits> =>
  readLimits((await $.session.usage()).rateLimits, await $.clock.now())

const isDeepResearch = async ($: $, text: string): Promise<boolean> => {
  const trimmed = text.trim()
  if (trimmed.length < 15 || trimmed.startsWith('/')) return false
  const label = await $.model.classify(
    'Is this request to a coding assistant a deep research task? Deep research means open-ended ' +
      'investigation that reads many sources (web pages, docs, papers or a large part of a codebase) ' +
      'and writes up findings. Small questions, edits, fixes and builds are "other".\n\nRequest:\n' +
      trimmed.slice(0, 4000),
    ['deep-research', 'other'],
  )

  return label === 'deep-research'
}

/** Commands that run a research harness, like the built-in /deep-research. */
const isResearchCommand = (name: string) => /research/i.test(name) && !name.startsWith('autoresearch')

/** The watched model you're on, or undefined when the check doesn't apply. */
const watchedModel = async ($: $): Promise<Family | undefined> => {
  const current = familyOf(await $.session.model())
  return current && watched.has(current) ? current : undefined
}

/** Applies the rule, asking when it fails: 'run', 'cancel', or the model alias to switch to. */
const decide = async ($: $, current: Family, what: string): Promise<string> => {
  const limits = await currentLimits($)
  if (allows(limits, rule)) return 'run'
  const answer = await $.ui.ask(`${what} on ${NAMES[current]}.\n${explain(limits, rule).join('\n')}\nWhich model should run it?`, {
    options: choicesFor(current),
    header: 'Limits',
  })
  if (answer === `Keep ${NAMES[current]}`) return 'run'

  return ALIAS[answer] ?? 'cancel'
}

/** Switches the model, then runs the same slash command again. */
const rerun = async ($: $, model: string, command: string, args: string) => {
  await $.command.run({ command: 'model', args: model })
  await $.command.run({ command, args })
}

/** Switches the model, then sends the same prompt again. Runs after the original was dropped. */
const resend = async ($: $, model: string, e: PromptSubmitInput) => {
  await $.command.run({ command: 'model', args: model })
  await $.prompt.submit({ text: e.text, attachments: e.attachments, asUser: true })
}

/** A dropdown's options, with the current value kept even when it's not a preset. */
const steps = (presets: number[], current: number, unit: string) =>
  [...new Set([...presets, current])].sort((a, b) => a - b).map(n => ({ value: String(n), label: `${n}${unit}` }))

/** Applies pane edits saved in the store, unless the config changed since they were made. */
const loadSaved = async ($: $) => {
  const saved = (await $.store.get('settings')) as Saved | undefined
  if (!saved) return
  if (saved.base !== base) return $.store.delete('settings')
  watched = parseModels(saved.models)
  rule = { resetWithinMinutes: saved.resetWithinMinutes, weeklyMaxPercent: saved.weeklyMaxPercent }
  openOnStart = saved.openOnStart ?? openOnStart
}

/**
 * Writes one setting the way /config does, and keeps it in the store too in case this
 * install has no config row for it. A refusal (an org lock) undoes the change.
 */
const save = async ($: $, field: string, value: string | number | boolean, done: string, undo: () => void) => {
  let deny: string | undefined
  try {
    deny = (await $.config.set({ key: `limits.${field}`, value })).deny
  } catch {
    // No config row for this field here: the store copy below carries it.
  }
  if (deny) {
    undo()
    return update($, notice, () => `Couldn't save: ${deny}`)
  }
  await $.store.set('settings', { ...snapshot(), base } satisfies Saved)
  await update($, notice, () => done)
}

const toggleModel = async ($: $, family: Family) => {
  const before = watched
  const next = new Set(watched)
  if (next.has(family)) next.delete(family)
  else next.add(family)
  watched = next
  const list = FAMILIES.filter(f => next.has(f))
  const names = list.map(f => NAMES[f]).join(', ') || 'no models'
  await save($, 'models', list.join(', '), `Saved. Watching ${names}.`, () => (watched = before))
}

const setMinutes = async ($: $, value: string) => {
  const before = rule
  rule = { ...rule, resetWithinMinutes: Number(value) }
  await save($, 'resetWithinMinutes', Number(value), `Saved. Allowed within ${value} min of the 5h reset.`, () => (rule = before))
}

const setPercent = async ($: $, value: string) => {
  const before = rule
  rule = { ...rule, weeklyMaxPercent: Number(value) }
  await save($, 'weeklyMaxPercent', Number(value), `Saved. Allowed while weekly usage is under ${value}%.`, () => (rule = before))
}

const toggleOpenOnStart = async ($: $) => {
  const before = openOnStart
  openOnStart = !openOnStart
  await save(
    $,
    'openOnStart',
    openOnStart,
    openOnStart ? 'Saved. This panel opens when a session starts.' : 'Saved. This panel stays closed until you run /limits.',
    () => (openOnStart = before),
  )
}

const openSettings = ($: $) => $.ui.open({ id: PANE, title: 'Limits settings', focus: true })

const showLimits = ($: $, rateLimits: readonly SessionRateLimit[]) => $.ui.status(limitsLine(rateLimits))

const report = async ($: $): Promise<string> => {
  const current = familyOf(await $.session.model())
  const usage = await $.session.usage()
  const limits = readLimits(usage.rateLimits, await $.clock.now())
  const list = FAMILIES.filter(f => watched.has(f))
  const names = list.map(f => NAMES[f]).join(' and ')
  const verdict =
    list.length === 0
      ? 'No models are watched, so deep research always runs.'
      : allows(limits, rule)
        ? `Deep research on ${names} is allowed right now.`
        : `Deep research on ${names} asks first right now.`
  const on = current ? ` You're on ${NAMES[current]}.` : ''

  return [limitsLine(usage.rateLimits) ?? 'No usage reading yet.', verdict + on, ...explain(limits, rule)].join('\n')
}

export const register: Register = (on, options) => {
  rule = {
    resetWithinMinutes: Number(options.resetWithinMinutes ?? 30),
    weeklyMaxPercent: Number(options.weeklyMaxPercent ?? 75),
  }
  watched = parseModels(String(options.models ?? 'fable'))
  openOnStart = options.openOnStart !== false
  base = JSON.stringify(snapshot())

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'limits',
      description: 'Show your 5h and 7d limits and whether deep research is allowed right now',
    })
    await loadSaved($)
    const ran = await next(e)
    showLimits($, (await $.session.usage()).rateLimits)
    if (openOnStart) void openSettings($)

    return ran
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) showLimits($, e.rateLimits)

    return next(e)
  })

  on('command.run', { command: 'limits' }, async ($, e) => {
    if ((e.args ?? '').trim() === 'settings') {
      await update($, notice, () => null)
      await openSettings($)
      return {}
    }

    await update($, notice, () => null)
    await openSettings($)
    return { text: await report($) }
  })

  // commands/settings.md lists it as /limits:settings; this answers it, so nothing reaches the model.
  on('command.run', { command: 'limits:settings' }, async $ => {
    await update($, notice, () => null)
    await openSettings($)
    return {}
  })

  // Draw /limits' answer as its own block, without the plugin-name prefix.
  on('ui.render', { component: 'CommandOutput', props: { command: 'limits' } }, ($, e, next) => {
    if (e.props.isErrored || !e.props.text) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // The row's text arrives as `limits: <what we answered>`; drop that prefix.
    const [head, verdict, ...rest] = e.props.text.replace(/^limits:\s*/, '').split('\n')

    return (
      <Box flexDirection="column">
        <Text bold>{head}</Text>
        <Text>{verdict}</Text>
        {rest.map((line, i) => (
          <Text key={`line-${i}`}>{`  ${line}`}</Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const Select = 'Select' in table ? table.Select : undefined
    const message = await read($, notice)
    const limits = await currentLimits($)
    const line = limitsLine((await $.session.usage()).rateLimits)
    const verdict = allows(limits, rule) ? 'Deep research is allowed right now.' : 'Deep research will ask first right now.'

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Models to watch</Text>
          <Text dimColor>Deep research on these asks first, unless both rules below pass.</Text>
          <Box flexDirection="row" gap={1}>
            {FAMILIES.map(f => (
              <Button
                key={`model-${f}`}
                variant={watched.has(f) ? 'primary' : 'secondary'}
                onPress={() => toggleModel($, f)}
              >
                {`${watched.has(f) ? '✓' : '○'} ${NAMES[f]}`}
              </Button>
            ))}
          </Box>
        </Box>
        <Box flexDirection="column">
          <Text bold>5h window resets within</Text>
          {Select ? (
            <Select
              key="minutes"
              value={String(rule.resetWithinMinutes)}
              options={steps(MINUTE_STEPS, rule.resetWithinMinutes, ' min')}
              onSelect={value => setMinutes($, value)}
            />
          ) : (
            <Text>{rule.resetWithinMinutes} min</Text>
          )}
        </Box>
        <Box flexDirection="column">
          <Text bold>Weekly usage under</Text>
          {Select ? (
            <Select
              key="percent"
              value={String(rule.weeklyMaxPercent)}
              options={steps(PERCENT_STEPS, rule.weeklyMaxPercent, '%')}
              onSelect={value => setPercent($, value)}
            />
          ) : (
            <Text>{rule.weeklyMaxPercent}%</Text>
          )}
        </Box>
        <Box flexDirection="column">
          <Text dimColor>{line ?? 'No usage reading yet.'}</Text>
          <Text dimColor>{verdict}</Text>
        </Box>
        <Button key="open-on-start" dimColor onPress={() => toggleOpenOnStart($)}>
          {`${openOnStart ? '✓' : '○'} Open this panel when a session starts`}
        </Button>
        {message && <Text color={message.startsWith("Couldn't") ? 'red' : 'green'}>{message}</Text>}
      </Box>
    )
  })

  on('prompt.submit', async ($, e, next) => {
    // Our own re-send, or anything a plugin sent, goes straight through.
    if (e.origin?.kind === 'plugin') return next(e)
    const current = await watchedModel($)
    if (!current || !(await isDeepResearch($, e.text))) return next(e)

    const choice = await decide($, current, 'This looks like deep research')
    if (choice === 'run') return next(e)
    if (choice === 'cancel') return { drop: 'Deep research cancelled.' }
    $.clock.after(0, () => void resend($, choice, e))

    return { drop: `Switching to ${NAMES[familyOf(choice)!]} and sending your prompt again.` }
  }).catch(($, e, next) => next(e))

  // Slash commands like /deep-research never reach prompt.submit, so they get the same check here.
  on('command.run', async ($, e, next) => {
    if (e.origin?.kind === 'plugin' || !isResearchCommand(e.command)) return next(e)
    const current = await watchedModel($)
    if (!current) return next(e)

    const choice = await decide($, current, `/${e.command} is about to run`)
    if (choice === 'run') return next(e)
    if (choice === 'cancel') return { text: 'Deep research cancelled.' }
    $.clock.after(0, () => void rerun($, choice, e.command, e.args ?? ''))

    return { text: `Switching to ${NAMES[familyOf(choice)!]} and running /${e.command} again.` }
  }).catch(($, e, next) => next(e))
}
