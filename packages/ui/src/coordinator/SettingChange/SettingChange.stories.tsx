import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { SettingChange, type SettingChangeProps } from './SettingChange'

const meta = {
  title: 'Coordinator/SettingChange',
  component: SettingChange,
  decorators: [threadDecorator],
  args: {
    section: 'Rules',
    project: 'Althar',
    moves: [{ label: 'Never', before: 'force-push', after: 'force-push, delete-branch', changes: ['Added delete-branch to Never'] }],
    state: 'done',
    onUndo: fn(),
  },
} satisfies Meta<typeof SettingChange>
export default meta
type Story = StoryObj<typeof meta>

/** A change made: one line of what changed, with Undo. */
export const Made: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Althar › Rules')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Undo' }))
    await expect(args.onUndo).toHaveBeenCalled()
  },
}

/** Made on the person's own words, which the line quotes. */
export const OnTheirWord: Story = {
  args: {
    section: 'Reviews and pull requests',
    project: null,
    moves: [
      {
        label: 'Post reviews of the team’s pull requests without asking',
        before: 'off',
        after: 'on',
        changes: ['Post reviews of the team’s pull requests without asking: off → on'],
      },
    ],
    words: 'Post the team’s reviews without asking from now on',
  },
}

/** Answered here: Change makes it, and it folds to its line. */
function Asking(props: Omit<SettingChangeProps, 'state' | 'onAnswer'>) {
  const [state, setState] = useState<SettingChangeProps['state']>('asked')
  return <SettingChange {...props} state={state} onAnswer={(yes) => setState(yes ? 'done' : 'declined')} />
}

/** A change that loosens what asks, which no message of the person's asked for: a card they press. */
export const AsksFirst: Story = {
  render: (args) => (
    <Asking
      section={args.section}
      project={args.project}
      moves={[{ label: 'Allow everything', before: 'off', after: 'on', changes: ['Allow everything: off → on'] }]}
      why="Builds keep stopping to ask about the cache folder."
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Change' }))
    await expect(c.getByText('Allow everything: off → on')).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument()
  },
}

/** Undone, or overtaken: one line saying so. */
export const Undone: Story = { args: { state: 'undone' } }
export const Overtaken: Story = { args: { state: 'moot', said: 'It changed since it was asked, so nothing was done.' } }

/** A list: one model turned on among hundreds, said by its name and its agent, never the lists. */
export const AList: Story = {
  args: {
    section: 'Agents',
    project: null,
    moves: [
      {
        label: 'Models turned off',
        before: 'claude-fable-5, claude-fable-5-1, …',
        after: 'claude-fable-5, claude-fable-5-1, …',
        changes: ['Turned on Kimi K3.1 Pro in OpenCode'],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Turned on Kimi K3.1 Pro in OpenCode')).toBeInTheDocument()
    await expect(c.getByText('Settings › Agents')).toBeInTheDocument()
  },
}

/** A map: one model's default effort, by the model's name. */
export const AMap: Story = {
  args: {
    section: 'Agents',
    project: null,
    moves: [
      {
        label: 'Default efforts',
        before: 'claude-code/opus-5-5 high',
        after: 'claude-code/opus-5-5 xhigh',
        changes: ['Default effort for Claude Opus 5.5: high → xhigh'],
      },
    ],
  },
}

/** A plain value: its name, before and after. */
export const AScalar: Story = {
  args: {
    section: 'Tasks',
    project: null,
    moves: [{ label: 'Review rounds', before: '3', after: '5', changes: ['Review rounds: 3 → 5'] }],
  },
}

const MANY = [
  'Turned off GPT-6 Luna in Codex',
  'Turned off GPT-6 Terra in Codex',
  'Turned off GPT-6 Astra in Codex',
  'Turned on Kimi K3.1 Pro in OpenCode',
  'Turned on Kimi K3 in OpenCode',
  'Turned off Grok 4.7 in OpenCode',
  'Default effort for Claude Opus 5.5: high → xhigh',
]

/** Many changes at once: a count, with each one a press away. */
export const ManyAtOnce: Story = {
  args: {
    section: 'Agents',
    project: null,
    moves: [
      { label: 'Models turned off', before: '3 models', after: '5 models', changes: MANY.slice(0, 6) },
      { label: 'Default efforts', before: 'high', after: 'xhigh', changes: MANY.slice(6) },
    ],
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('7 changes')).toBeInTheDocument()
    await expect(c.queryByText('Turned off GPT-6 Luna in Codex')).not.toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Show all 7' }))
    await expect(c.getByText('Turned off GPT-6 Luna in Codex')).toBeInTheDocument()
    await expect(c.getByText('Default effort for Claude Opus 5.5: high → xhigh')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Hide' }))
    await expect(c.queryByText('Turned off GPT-6 Luna in Codex')).not.toBeInTheDocument()
  },
}

/** A card of many changes shows the first few, the rest behind Show all. */
export const AsksManyFirst: Story = {
  render: () => (
    <Asking
      section="Agents"
      project={null}
      moves={[{ label: 'Models turned off', before: '3 models', after: '9 models', changes: MANY }]}
      why="Those models were failing on every call."
    />
  ),
}

/** A change kept before its lines were words: only that the setting changed, never its whole list. */
export const KeptEarlier: Story = {
  args: {
    section: 'Agents',
    project: null,
    moves: [{ label: 'Models turned off', before: '{"antigravity":[],"claude-code":["claude-fable-5"]}', after: '{"antigravity":[]}' }],
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Models turned off changed')).toBeInTheDocument()
  },
}

/** At a narrow width, the section and Undo stay clear of each other and of the line. */
export const Narrow: Story = {
  args: AList.args,
  decorators: [
    (Story) => (
      <div style={{ width: 250 }}>
        <Story />
      </div>
    ),
  ],
}
