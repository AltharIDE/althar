import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import { PUBLISH } from '../../fixtures/home'
import { SCRIPT } from '../../fixtures/longCommand'
import { TaskKind, TaskStatus } from '../../foundations/vocabulary'
import { NeedLine } from '../../home/NeedLine/NeedLine'
import { laneDecorator } from '../../storybook/lane'
import { BoardCard } from './BoardCard'
import { CommandChip } from './Chips'

/* A permission that asks to run a long script: its command said once, short, with the rest one click away. */

const meta = { title: 'Board/LongCommand', component: BoardCard, decorators: [laneDecorator] } satisfies Meta<typeof BoardCard>
export default meta
type Story = StoryObj<typeof meta>

/** On the board: the command's first two commands, and what is left out. The task shows it whole. */
export const OnTheBoard: Story = {
  args: {
    status: TaskStatus.Yours,
    kind: TaskKind.Change,
    word: 'Permission',
    at: '2m',
    title: 'Prototype: tasks waiting for a free agent',
    object: <CommandChip>{SCRIPT}</CommandChip>,
    onOpen: fn(),
  },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByText(/and 2 more/)).toBeInTheDocument()
  },
}

/** On the home's list. */
export const OnTheHome: Story = {
  args: { status: TaskStatus.Yours, word: 'Permission', title: 'Prototype: tasks waiting for a free agent' },
  decorators: [(Story) => <div style={{ width: 640 }}>{Story()}</div>],
  render: () => (
    <NeedLine
      kind="Permission"
      project={PUBLISH.project}
      title="Prototype: tasks waiting for a free agent"
      command={SCRIPT}
      onOpen={fn()}
      actions={<span />}
    />
  ),
}
