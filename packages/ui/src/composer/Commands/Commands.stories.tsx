import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { MODEL_LIST, model } from '../../fixtures/models'
import { Composer } from '../Composer/Composer'
import { ModelPick } from '../ModelPick/ModelPick'
import type { CommandDetail, CommandOption, ComposerCommand } from './commands'

/*
 * The composer's commands, as a task's and the coordinator's composers offer
 * them: a slash opens them on the composer's top edge, each with where it
 * stands; /goal opens into the goal itself.
 */

const OBJECTIVE = 'Get e2e/onboarding.spec.ts passing on CI’s Linux run'

type GoalState = 'none' | 'active' | 'paused'

const goalDetail = (goal: GoalState): CommandDetail =>
  goal === 'none'
    ? { title: 'Goal', now: 'Not set', note: 'The lead keeps working toward it on its own, up to 12 turns, until it’s done or stuck.' }
    : {
        title: 'Goal',
        now: `${goal === 'active' ? 'Active' : 'Paused'} · 3 of 12 turns`,
        body: OBJECTIVE,
        note: 'Waits for the fonts before the first shot; Linux still times out on the GitHub step.',
      }

const goalOptions = (goal: GoalState): CommandOption[] =>
  goal === 'none'
    ? []
    : [
        goal === 'active'
          ? { name: 'pause', does: 'Stop working toward it for now', icon: 'pause', run: fn() }
          : { name: 'resume', does: 'Go on working toward it', icon: 'play', run: fn() },
        { name: 'edit', does: 'Change the objective', icon: 'pencil', fill: `edit ${OBJECTIVE}` },
        { name: 'clear', does: 'Remove the goal', icon: 'close', run: fn() },
      ]

const goalCommand = (goal: GoalState): ComposerCommand => ({
  name: 'goal',
  does: 'Keep the lead working toward an objective',
  icon: 'goal',
  ...(goal === 'none' ? {} : { now: goal === 'active' ? 'Active' : 'Paused' }),
  takes: goal === 'none' ? 'what the lead should keep working toward' : 'a new objective',
  options: goalOptions(goal),
  detail: goalDetail(goal),
  action: (words) => (words === '' ? null : goal === 'none' ? 'Set the goal' : 'Replace the goal'),
  run: fn(),
})

const MODELS: CommandOption[] = MODEL_LIST.slice(0, 5).map((info, index) => ({
  name: info.short.toLowerCase().replaceAll(' ', '-'),
  label: info.name,
  does: info.via ?? '',
  ...(index === 0 ? { now: 'Current' } : {}),
  run: fn(),
}))

/** A task's composer: what it can do now. */
const taskCommands = (goal: GoalState, all = true): ComposerCommand[] => [
  goalCommand(goal),
  ...(all
    ? ([
        {
          name: 'model',
          does: 'Change the lead’s model',
          icon: 'agents',
          now: 'Opus 5 · High',
          takes: 'a model',
          options: MODELS,
          run: fn(),
        },
        { name: 'compact', does: 'Compact the conversation', icon: 'compress', now: '48% full', run: fn() },
        {
          name: 'rename',
          does: 'Rename the task',
          icon: 'pencil',
          takes: 'a new title',
          action: (words) => (words === '' ? null : 'Rename the task'),
          run: fn(),
        },
        { name: 'run', does: 'Run the project', icon: 'play', now: 'bun run dev', run: fn() },
        { name: 'ship', does: 'Review it and send it up', icon: 'up', now: '3 commits', run: fn() },
      ] satisfies ComposerCommand[])
    : []),
]

/** The coordinator's: no goals there. */
const coordinatorCommands: ComposerCommand[] = [
  {
    name: 'aside',
    does: 'Ask on the side',
    icon: 'comment',
    takes: 'what to ask',
    action: (words) => (words === '' ? null : 'Start the aside'),
    run: fn(),
  },
  {
    name: 'model',
    does: 'Change the coordinator’s model',
    icon: 'agents',
    now: 'Opus 5 · Medium',
    takes: 'a model',
    options: MODELS,
    run: fn(),
  },
  { name: 'compact', does: 'Compact the conversation', icon: 'compress', now: '12% full', run: fn() },
  { name: 'clear', does: 'Clear the conversation', icon: 'remove', run: fn() },
  { name: 'goal', does: 'Keep the lead working toward an objective', icon: 'goal', unavailable: 'In a task’s conversation', run: fn() },
]

function Picker() {
  return (
    <ModelPick
      model={model('claude-opus-5')}
      pinned={[]}
      effort="High"
      defaultEffort="High"
      owner="Lead"
      count={MODEL_LIST.length}
      onChange={() => {}}
      onEffort={() => {}}
    />
  )
}

function Example({ initial, commands }: { initial: string; commands: ComposerCommand[] }) {
  const [value, setValue] = useState(initial)
  return (
    <div style={{ width: 620, paddingTop: 16 }}>
      <Composer
        value={value}
        onChange={setValue}
        onSubmit={fn()}
        placeholder="Tell Claude Code something"
        picker={<Picker />}
        commands={commands}
      />
    </div>
  )
}

const meta = {
  title: 'Composer/Commands',
  component: Example,
  args: { initial: '/', commands: taskCommands('none', false) },
} satisfies Meta<typeof Example>
export default meta
type Story = StoryObj<typeof meta>

const focus = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  const field = within(canvasElement).getByRole('textbox') as HTMLTextAreaElement
  field.focus()
  field.setSelectionRange(field.value.length, field.value.length)
}

/** A slash, in a task with only /goal: the one command, what it does. */
export const Finding: Story = { play: focus }

/** A slash in a task: every command it can do now, each with where it stands. */
export const FindingAll: Story = { args: { commands: taskCommands('active') }, play: focus }

/** Narrowed as the name is typed. */
export const Narrowed: Story = { args: { initial: '/co', commands: taskCommands('active') }, play: focus }

/** /goal picked with none set: what a goal is, and what it takes written ahead in the field. */
export const GoalNotSet: Story = { args: { initial: '/goal ' }, play: focus }

/** An objective written: the last row is what Enter does. */
export const GoalWritten: Story = { args: { initial: `/goal ${OBJECTIVE}` }, play: focus }

/** /goal with one at work: the goal itself, then what can be done to it. */
export const GoalSet: Story = {
  args: { initial: '/goal ', commands: taskCommands('active') },
  play: async (context) => {
    await focus(context)
    const list = within(context.canvasElement).getByRole('listbox', { name: 'Commands' })
    await expect(
      within(list)
        .getAllByRole('option')
        .map((row) => row.textContent),
    ).toEqual(['pauseStop working toward it for now', 'editChange the objective', 'clearRemove the goal'])
  },
}

/** A paused goal: resume in pause's place. */
export const GoalPaused: Story = { args: { initial: '/goal ', commands: taskCommands('paused') }, play: focus }

/** A new objective over one at work: Enter replaces it. */
export const GoalReplacing: Story = {
  args: { initial: '/goal Make the onboarding spec pass on Windows too', commands: taskCommands('active') },
  play: focus,
}

/** /model: the models, found by name. */
export const Model: Story = { args: { initial: '/model ', commands: taskCommands('active') }, play: focus }

/** The coordinator's composer: its own commands, and /goal listed where it can't be done. */
export const Coordinator: Story = { args: { commands: coordinatorCommands }, play: focus }

/** Typed by keys: the arrows move, Enter picks /goal into the field. */
export const ByKeys: Story = {
  args: { initial: '', commands: taskCommands('active') },
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox') as HTMLTextAreaElement
    await userEvent.click(field)
    await userEvent.keyboard('/')
    await userEvent.keyboard('{ArrowDown}{ArrowUp}{Enter}')
    await expect(field.value).toBe('/goal ')
    await userEvent.keyboard('pa{Tab}')
    await expect(field.value).toBe('/goal pause')
  },
}
