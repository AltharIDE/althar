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
    moves: [{ label: 'Never', before: 'force-push', after: 'force-push, delete-branch' }],
    state: 'done',
    onUndo: fn(),
  },
} satisfies Meta<typeof SettingChange>
export default meta
type Story = StoryObj<typeof meta>

/** A change made: one line, before and after, with Undo. */
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
    moves: [{ label: 'Post reviews of the team’s pull requests without asking', before: 'off', after: 'on' }],
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
      moves={[{ label: 'Allow everything', before: 'off', after: 'on' }]}
      why="Builds keep stopping to ask about the cache folder."
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Change' }))
    await expect(c.getByText(/^Allow everything/)).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument()
  },
}

/** Undone, or overtaken: one line saying so. */
export const Undone: Story = { args: { state: 'undone' } }
export const Overtaken: Story = { args: { state: 'moot', said: 'It changed since it was asked, so nothing was done.' } }
