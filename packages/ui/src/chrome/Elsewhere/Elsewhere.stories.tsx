import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PROJECTS } from '../../fixtures/chrome'
import { States, statesParameters } from '../../storybook/States'
import { Elsewhere } from './Elsewhere'

const OTHERS = PROJECTS.slice(1)
const TWO = OTHERS.map((p) => (p.id === 'halyard' ? { ...p, yours: 2 } : p))

const meta = {
  title: 'Chrome/Elsewhere',
  component: Elsewhere,
  args: { projects: OTHERS, onPick: fn(), onMore: fn() },
} satisfies Meta<typeof Elsewhere>
export default meta
type Story = StoryObj<typeof meta>

/** One other project waits on you: by name, with its count. */
export const OneProject: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Go to Tessera/ }))
    await expect(args.onPick).toHaveBeenCalledWith('tessera')
  },
}
/** More than one: by count, and it opens the switcher. */
export const SeveralProjects: Story = {
  args: { projects: TWO },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '2 other projects' }))
    await expect(args.onMore).toHaveBeenCalledOnce()
  },
}
/** Nothing waits elsewhere: nothing shows. */
export const Nothing: Story = { args: { projects: OTHERS.map((p) => ({ ...p, yours: 0 })) } }

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <Elsewhere {...args} /> })),
        { state: 'several', node: <Elsewhere {...args} projects={TWO} /> },
      ]}
    />
  ),
}
