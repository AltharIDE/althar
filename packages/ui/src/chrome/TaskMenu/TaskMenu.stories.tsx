import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { TaskStatus } from '../../foundations/vocabulary'
import { States, statesParameters } from '../../storybook/States'
import { TaskMenu } from './TaskMenu'

const meta = {
  title: 'Chrome/TaskMenu',
  component: TaskMenu,
  args: { status: TaskStatus.Running, onOpen: fn(), editor: 'Cursor', onStop: fn(), onResume: fn(), onAbandon: fn(), onReopen: fn() },
  decorators: [
    (Story, { parameters }) =>
      parameters.pseudo ? (
        Story()
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: 360, minHeight: 220 }}>{Story()}</div>
      ),
  ],
} satisfies Meta<typeof TaskMenu>
export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {}
/** While it works, waits on you, or waits out a limit: stop it, or abandon it. */
export const Working: Story = { args: { defaultOpen: true } }
/** Stopped by you: resume it, or abandon it. */
export const Stopped: Story = { args: { status: TaskStatus.Stopped, defaultOpen: true } }
/** Settled: reopen it. */
export const Settled: Story = { args: { status: TaskStatus.Done, defaultOpen: true } }
/** With nothing it can do, there is no menu at all. */
export const NothingToDo: Story = { args: { status: TaskStatus.Done, onReopen: undefined, onOpen: undefined } }

/** Its folder opens in the editor its files open in, wherever the task stands. */
export const OpeningTheFolder: Story = {
  args: { status: TaskStatus.Done, onReopen: undefined, editor: 'Zed' },
  play: async ({ args, canvasElement }) => {
    const page = within(document.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'More for this task' }))
    await userEvent.click(await page.findByRole('menuitem', { name: /Open in Zed/ }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
  },
}

export const Stopping: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(document.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'More for this task' }))
    await expect(page.queryByRole('menuitem', { name: /Resume/ })).toBeNull()
    await userEvent.click(await page.findByRole('menuitem', { name: /Stop the task/ }))
    await expect(args.onStop).toHaveBeenCalledOnce()
  },
}

export const Resuming: Story = {
  args: { status: TaskStatus.Stopped },
  play: async ({ args, canvasElement }) => {
    const page = within(document.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'More for this task' }))
    await expect(page.queryByRole('menuitem', { name: /Stop the task/ })).toBeNull()
    await userEvent.click(await page.findByRole('menuitem', { name: /Resume/ }))
    await expect(args.onResume).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => <States cells={['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <TaskMenu {...args} /> }))} />,
}
