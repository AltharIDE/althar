import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { type ComposerCommand, commandState } from '../src/composer/Commands/commands'
import { Composer } from '../src/composer/Composer/Composer'

const field = () => screen.getByRole('textbox') as HTMLTextAreaElement
const list = () => screen.getByRole('listbox', { name: 'Commands' })
const rows = () =>
  within(list())
    .getAllByRole('option')
    .map((row) => row.textContent)
const type = (text: string) => fireEvent.change(field(), { target: { value: text } })
const key = (name: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(field(), { key: name, ...init })

const commandsOf = () => {
  const goal = vi.fn<(words: string) => void>()
  const pause = vi.fn<() => void>()
  const compact = vi.fn<(words: string) => void>()
  const commands: ComposerCommand[] = [
    {
      name: 'goal',
      does: 'Keep the lead working toward an objective',
      icon: 'goal',
      now: 'Active',
      takes: 'a new objective',
      options: [
        { name: 'pause', does: 'Stop working toward it for now', run: pause },
        { name: 'edit', does: 'Change the objective', fill: 'edit Ship it' },
      ],
      detail: { title: 'Goal', now: 'Active · 3 of 12 turns', body: 'Ship it', note: 'Waits for the fonts.' },
      action: (words) => (words === '' ? null : 'Replace the goal'),
      run: goal,
    },
    { name: 'compact', does: 'Compact the conversation', icon: 'compress', now: '48% full', run: compact },
    { name: 'aside', does: 'Ask on the side', icon: 'comment', unavailable: 'Not in a task', run: vi.fn() },
  ]
  return { commands, goal, pause, compact }
}

function Harness({
  commands,
  onSubmit,
  onCommand,
}: {
  commands: ComposerCommand[]
  onSubmit: (text: string) => void
  onCommand?: (name: string | null) => void
}) {
  const [value, setValue] = useState('')
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      placeholder="Tell the lead"
      commands={commands}
      {...(onCommand === undefined ? {} : { onCommand })}
    />
  )
}

const mount = () => {
  const made = commandsOf()
  const onSubmit = vi.fn<(text: string) => void>()
  const onCommand = vi.fn<(name: string | null) => void>()
  render(<Harness commands={made.commands} onSubmit={onSubmit} onCommand={onCommand} />)
  return { ...made, onSubmit, onCommand }
}

describe('the composer’s commands', () => {
  it('offers no Send now beside a command while the agent works', () => {
    const { commands } = commandsOf()
    render(
      <Composer
        value="/goal "
        onChange={() => {}}
        onSubmit={vi.fn()}
        onSendNow={vi.fn()}
        busy
        placeholder="Tell the lead"
        commands={commands}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Send now' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
  })

  it('opens on a slash with every command, what it does and where it stands', () => {
    mount()
    type('/')
    expect(rows()).toEqual([
      '/goalKeep the lead working toward an objectiveActive',
      '/compactCompact the conversation48% full',
      '/asideAsk on the sideNot in a task',
    ])
    expect(field().getAttribute('aria-activedescendant')).toBe(within(list()).getAllByRole('option')[0]!.id)
  })

  it('narrows as the name is typed, by its start first, then by what it does', () => {
    mount()
    type('/co')
    expect(rows()).toEqual(['/compactCompact the conversation48% full'])
    type('/side')
    expect(rows()).toEqual(['/asideAsk on the sideNot in a task'])
    type('/zz')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('picks a command that takes something into the field, and opens into what it acts on', () => {
    const { onCommand, goal } = mount()
    type('/')
    key('Enter')
    expect(field().value).toBe('/goal ')
    expect(goal).not.toHaveBeenCalled()
    expect(onCommand).toHaveBeenLastCalledWith('goal')
    expect(screen.getByText('Ship it')).toBeTruthy()
    expect(screen.getByText('Active · 3 of 12 turns')).toBeTruthy()
    expect(screen.getByText('Waits for the fonts.')).toBeTruthy()
    expect(rows()).toEqual(['pauseStop working toward it for now', 'editChange the objective'])
  })

  it('does one that takes nothing as it is picked, and sends nothing', () => {
    const { compact, onSubmit } = mount()
    type('/')
    key('ArrowDown')
    key('Enter')
    expect(compact).toHaveBeenCalledWith('')
    expect(field().value).toBe('')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('moves round the list with the arrows', () => {
    const { compact } = mount()
    type('/')
    key('ArrowUp')
    key('ArrowUp')
    key('Enter')
    expect(compact).toHaveBeenCalledTimes(1)
  })

  it('does nothing with one that can’t be done here', () => {
    const { onSubmit } = mount()
    type('/as')
    key('Enter')
    expect(field().value).toBe('/as')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does what it takes as it is picked, or puts it in the field to go on from', () => {
    const { pause, goal } = mount()
    type('/goal pa')
    expect(rows()).toEqual(['pauseStop working toward it for now'])
    key('Enter')
    expect(pause).toHaveBeenCalledTimes(1)
    expect(field().value).toBe('')
    type('/goal ed')
    key('Enter')
    expect(field().value).toBe('/goal edit Ship it')
    expect(goal).not.toHaveBeenCalled()
  })

  it('does it with the words after its name, the last row saying what Enter does', () => {
    const { goal, onSubmit } = mount()
    type('/goal Get the spec passing')
    expect(rows()).toEqual(['Replace the goal'])
    key('Enter')
    expect(goal).toHaveBeenCalledWith('Get the spec passing')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(field().value).toBe('')
  })

  it('does it from the send button too', () => {
    const { goal, onSubmit } = mount()
    type('/goal Ship')
    fireEvent.click(screen.getByRole('button', { name: 'Replace the goal' }))
    expect(goal).toHaveBeenCalledWith('Ship')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('sends nothing for a command with nothing to do yet', () => {
    const { goal, onSubmit } = mount()
    type('/goal ')
    key('Escape')
    key('Enter')
    expect(goal).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(field().value).toBe('/goal ')
  })

  it('shuts on Escape, and a slash then goes as words', () => {
    const { onSubmit, onCommand } = mount()
    type('/go')
    key('Escape')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onCommand).toHaveBeenLastCalledWith(null)
    key('Enter')
    expect(onSubmit).toHaveBeenCalledWith('/go')
  })

  it('sends a slash that names no command as words', () => {
    const { onSubmit } = mount()
    type('/etc/hosts has the entry')
    key('Enter')
    expect(onSubmit).toHaveBeenCalledWith('/etc/hosts has the entry')
  })

  it('takes a command, or one of what it takes, into the field with Tab', () => {
    const { compact } = mount()
    type('/c')
    key('Tab')
    expect(field().value).toBe('/compact ')
    expect(compact).not.toHaveBeenCalled()
    expect(rows()).toEqual(['Compact the conversation'])
    key('Enter')
    expect(compact).toHaveBeenCalledWith('')
    type('/goal p')
    key('Tab')
    expect(field().value).toBe('/goal pause')
  })

  it('writes what it takes ahead of the caret, and the command in Althar’s colour', () => {
    mount()
    type('/goal ')
    key('Escape')
    const drawn = document.querySelector('[aria-hidden="true"] > span')
    expect(drawn?.textContent).toBe('/goal ')
    expect(screen.getByText('a new objective')).toBeTruthy()
  })

  it('is a letter like any other without commands', () => {
    const onSubmit = vi.fn()
    render(<Composer value="/goal ship" onChange={() => {}} onSubmit={onSubmit} placeholder="Tell the lead" />)
    expect(screen.queryByRole('listbox')).toBeNull()
    key('Enter')
    expect(onSubmit).toHaveBeenCalledWith('/goal ship')
  })

  it('opens a picked command with nothing to show into its own head', () => {
    mount()
    type('/aside ')
    const panel = document.querySelector<HTMLElement>('[data-commands]')!
    expect(within(panel).getByText('/aside')).toBeTruthy()
    expect(within(panel).getByText('Not in a task')).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('what the words say of the commands', () => {
  const { commands } = commandsOf()
  it('reads nothing without a slash at the start, or with no commands', () => {
    expect(commandState('ship /goal', commands)).toEqual({ kind: 'none' })
    expect(commandState('/goal', [])).toEqual({ kind: 'none' })
  })
  it('reads one picked whole by its exact option, and by a label', () => {
    const picked = commandState('/goal  pause', commands)
    expect(picked.kind === 'picked' && picked.exact?.name).toBe('pause')
    const labelled = commandState('/model opus', [
      {
        name: 'model',
        does: 'Change the model',
        icon: 'agents',
        options: [{ name: 'opus-5.5', label: 'Opus 5.5', run: () => {} }],
        run: () => {},
      },
    ])
    expect(labelled.kind === 'picked' && labelled.options.map((one) => one.name)).toEqual(['opus-5.5'])
    const byLabel = commandState('/model 5.5', [
      {
        name: 'model',
        does: 'Change the model',
        icon: 'agents',
        options: [{ name: 'opus', label: 'Opus 5.5', run: () => {} }],
        run: () => {},
      },
    ])
    expect(byLabel.kind === 'picked' && byLabel.options.length).toBe(1)
  })
  it('says nothing Enter does for one that can’t be done here', () => {
    const state = commandState('/aside hi', commands)
    expect(state.kind === 'picked' && state.action).toBeNull()
  })
})
