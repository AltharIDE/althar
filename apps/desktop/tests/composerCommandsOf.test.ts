import type { Runnable, SessionSummary, ThreadGoal } from '@althar/contracts'
import { describe, expect, it, vi } from 'vitest'

import {
  asideCommandOf,
  commandsOf,
  commandText,
  compactCommandOf,
  coordinatorGoalOf,
  goalCommandOf,
  interruptCommandOf,
  pressOf,
  renameCommandOf,
  runCommandOf,
} from '../src/renderer/shared/composerCommands'

/*
 * Each command as a composer's slash offers it, by where things stand: a
 * goal's options by its status, what Enter does with the words typed, and a
 * command left out where it can't be done now.
 */

const goal = (over: Partial<ThreadGoal> = {}): ThreadGoal => ({
  revision: 1,
  objective: 'Staging runs on the new database',
  status: 'active',
  rounds: 2,
  roundLimit: 12,
  progress: null,
  detail: null,
  waiting: false,
  ...over,
})

const optionNames = (command: { options?: ReadonlyArray<{ name: string }> }) => (command.options ?? []).map((one) => one.name)

describe('/goal in a task', () => {
  it('offers by the goal’s status what can be done to it', () => {
    expect(optionNames(goalCommandOf(null, vi.fn()))).toEqual([])
    expect(optionNames(goalCommandOf(goal(), vi.fn()))).toEqual(['pause', 'edit', 'clear'])
    expect(optionNames(goalCommandOf(goal({ status: 'paused' }), vi.fn()))).toEqual(['resume', 'edit', 'clear'])
    expect(optionNames(goalCommandOf(goal({ status: 'complete' }), vi.fn()))).toEqual(['edit', 'clear'])
  })

  it('says the goal as it stands, waiting included, with its latest word', () => {
    const waiting = goalCommandOf(goal({ waiting: true, progress: 'Moved the schema' }), vi.fn())
    expect(waiting.now).toBe('Waiting')
    expect(waiting.detail).toMatchObject({ now: 'Waiting · 2 of 12 turns', note: 'Moved the schema' })
    expect(goalCommandOf(goal({ status: 'blocked', detail: 'No access', progress: 'Half done' }), vi.fn()).detail?.note).toBe('No access')
    expect(goalCommandOf(goal(), vi.fn()).detail).not.toHaveProperty('note')
    expect(goalCommandOf(null, vi.fn()).detail?.now).toBe('Not set')
  })

  it('says what Enter does with the words, and does each option as the words would', () => {
    const onGoal = vi.fn()
    const none = goalCommandOf(null, onGoal)
    const set = goalCommandOf(goal(), onGoal)
    expect(none.action?.('Ship it')).toBe('Set the goal')
    expect(set.action?.('Ship it')).toBe('Replace the goal')
    expect(set.action?.('edit Ship it today')).toBe('Save the goal')
    expect(set.action?.('pause')).toBeNull()
    expect(set.action?.('')).toBeNull()
    for (const option of set.options ?? []) option.run?.()
    expect(onGoal.mock.calls.map(([body]) => body)).toEqual(['/goal pause', '/goal clear'])
    expect(set.options?.find((one) => one.name === 'edit')?.fill).toBe('edit Staging runs on the new database')
    set.run('Ship it')
    expect(onGoal).toHaveBeenLastCalledWith('/goal Ship it')
  })
})

describe('/goal in the coordinator', () => {
  it('says an objective to it, and nothing without one', () => {
    const onGoal = vi.fn()
    const command = coordinatorGoalOf(onGoal)
    expect(command.action?.('  ')).toBeNull()
    expect(command.action?.('Ship it')).toBe('Start a task toward it')
    command.run('  ')
    expect(onGoal).not.toHaveBeenCalled()
    command.run(' Ship it ')
    expect(onGoal).toHaveBeenCalledWith('/goal Ship it')
  })
})

describe('commands that take words', () => {
  it('rename and aside do nothing without words', () => {
    const onRename = vi.fn()
    const rename = renameCommandOf(onRename)
    expect(rename.action?.('')).toBeNull()
    expect(rename.action?.('Faster board')).toBe('Rename the task')
    rename.run('')
    rename.run('Faster board')
    expect(onRename.mock.calls).toEqual([['Faster board']])

    const onAsk = vi.fn()
    const aside = asideCommandOf(onAsk)
    expect(aside.action?.('')).toBeNull()
    expect(aside.action?.('Why?')).toBe('Start the aside')
    aside.run('')
    aside.run('Why?')
    expect(onAsk.mock.calls).toEqual([['Why?']])
  })
})

describe('commands there when they can be done', () => {
  const session = (context: SessionSummary['context']) => ({ context }) as SessionSummary

  it('/compact where there is a context, said as full as it is', () => {
    expect(compactCommandOf(null, vi.fn())).toBeNull()
    expect(compactCommandOf(session(null), vi.fn())).toBeNull()
    expect(compactCommandOf(session({ used: 0, size: 0 } as never), vi.fn())).toBeNull()
    expect(compactCommandOf(session({ used: 50, size: 200 } as never), vi.fn())?.now).toBe('25% full')
  })

  it('/interrupt while at work, and the list leaves out what isn’t there', () => {
    const interrupt = interruptCommandOf(true, 'lead', vi.fn())
    expect(interrupt?.does).toBe('Interrupt the lead')
    expect(interruptCommandOf(false, 'lead', vi.fn())).toBeNull()
    const done = pressOf('done', 'Mark it done', 'check', vi.fn())
    expect(done).not.toHaveProperty('now')
    expect(pressOf('ship', 'Send it up', 'check', vi.fn(), '2 commits').now).toBe('2 commits')
    expect(commandsOf(interrupt, null, false, done).map((one) => one.name)).toEqual(['interrupt', 'done'])
  })

  it('/ship says whether a review runs first, and how many commits go', () => {
    expect([commandText.ship.does(true), commandText.ship.does(false)]).toEqual(['Review it and send it up', 'Send it up'])
    expect([commandText.ship.commits(1), commandText.ship.commits(3)]).toEqual(['1 commit', '3 commits'])
  })
})

describe('/run', () => {
  const runnable = (over: Partial<Runnable>): Runnable => ({
    id: 'r1',
    name: null,
    command: 'bun run dev',
    repository: 'althar',
    own: true,
    from: 'repository',
    ...over,
  })

  it('runs the project as it runs by default, with nothing to pick', () => {
    const onRun = vi.fn()
    const only = runCommandOf([runnable({})], onRun)
    expect(only.options).toBeUndefined()
    expect(only.now).toBe('bun run dev')
    only.run('')
    expect(onRun).toHaveBeenCalledWith(null)
    expect(runCommandOf([], vi.fn())).not.toHaveProperty('now')
  })

  it('offers each way to run it, named as it is named', () => {
    const onRun = vi.fn()
    const command = runCommandOf(
      [
        runnable({}),
        runnable({ id: 'r2', name: 'Story book', command: 'storybook dev', own: false, from: 'person' }),
        runnable({ id: 'r3', command: 'bun lab', own: false }),
      ],
      onRun,
    )
    expect(command.options?.map((one) => [one.name, one.label, one.does])).toEqual([
      ['althar', undefined, 'althar’s own way to run'],
      ['story-book', 'Story book', 'storybook dev'],
      ['bun-lab', undefined, 'bun lab'],
    ])
    command.options?.[1]?.run?.()
    expect(onRun).toHaveBeenCalledWith('r2')
    command.run('')
    expect(onRun).toHaveBeenCalledTimes(1)
  })
})
