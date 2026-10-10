import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { TaskMenu } from './TaskMenu'

/** The menu as each kind of task has it: the consumer gives only what applies where the task stands. */
const working = { onOpen: fn(), editor: 'Cursor', onStop: fn(), onAbandon: fn() }

const meta = {
  title: 'Chrome/TaskMenu',
  component: TaskMenu,
  args: working,
  decorators: [
    (Story, { parameters }) =>
      parameters.pseudo ? (
        Story()
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: 360, minHeight: 300 }}>{Story()}</div>
      ),
  ],
} satisfies Meta<typeof TaskMenu>
export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {}
/** While it works, waits on you, or waits out a limit: stop it, or abandon it. */
export const Working: Story = { args: { defaultOpen: true } }
/** Stopped by you, its step cut short: resume it, or abandon it. */
export const Stopped: Story = { args: { onStop: undefined, onResume: fn(), defaultOpen: true } }
/** Its plan waits to start, counting down or held: start it now, or abandon it. */
export const Planned: Story = { args: { onOpen: undefined, onStop: undefined, onStartNow: fn(), defaultOpen: true } }
/** Ready, with a draft pull request: mark it ready for review, or abandon it. */
export const DraftReady: Story = { args: { onStop: undefined, onMarkReady: fn(), defaultOpen: true } }
/** Abandoned: reopen it. */
export const Abandoned: Story = { args: { onStop: undefined, onAbandon: undefined, onReopen: fn(), defaultOpen: true } }
/** Merged, it is done for good: only its folder opens. */
export const Merged: Story = { args: { onStop: undefined, onAbandon: undefined, defaultOpen: true } }
/** With no editor found, nothing but abandoning. */
export const OnlyAbandon: Story = { args: { onOpen: undefined, onStop: undefined, defaultOpen: true } }
/** Long words, as a translation might have them, wrap inside the menu. */
export const LongWords: Story = {
  args: {
    onResume: fn(),
    defaultOpen: true,
    editor: 'Visual Studio Code – Insiders',
    text: {
      stopAbout: 'Every agent working on this task stops at once. Its branch, its worktree and everything it found stay as they are.',
    },
  },
}
/** With nothing it can do, there is no menu at all. */
export const NothingToDo: Story = { args: { onOpen: undefined, onStop: undefined, onAbandon: undefined } }

const opened = async (canvasElement: HTMLElement) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'More for this task' }))
  return within(document.body)
}

/** Its folder opens in the editor its files open in, wherever the task stands. */
export const OpeningTheFolder: Story = {
  args: { onStop: undefined, onAbandon: undefined, editor: 'Zed' },
  play: async ({ args, canvasElement }) => {
    const page = await opened(canvasElement)
    await userEvent.click(await page.findByRole('menuitem', { name: /Open in Zed/ }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
  },
}

export const Stopping: Story = {
  play: async ({ args, canvasElement }) => {
    const page = await opened(canvasElement)
    await expect(page.queryByRole('menuitem', { name: /Resume/ })).toBeNull()
    await userEvent.click(await page.findByRole('menuitem', { name: /Stop the task/ }))
    await expect(args.onStop).toHaveBeenCalledOnce()
  },
}

export const Resuming: Story = {
  args: { onStop: undefined, onResume: fn() },
  play: async ({ args, canvasElement }) => {
    const page = await opened(canvasElement)
    await expect(page.queryByRole('menuitem', { name: /Stop the task/ })).toBeNull()
    await userEvent.click(await page.findByRole('menuitem', { name: /Resume/ }))
    await expect(args.onResume).toHaveBeenCalledOnce()
  },
}

export const StartingNow: Story = {
  args: { onStop: undefined, onStartNow: fn() },
  play: async ({ args, canvasElement }) => {
    const page = await opened(canvasElement)
    await userEvent.click(await page.findByRole('menuitem', { name: /Start now/ }))
    await expect(args.onStartNow).toHaveBeenCalledOnce()
  },
}

export const MarkingReady: Story = {
  args: { onStop: undefined, onMarkReady: fn() },
  play: async ({ args, canvasElement }) => {
    const page = await opened(canvasElement)
    await userEvent.click(await page.findByRole('menuitem', { name: /Mark ready for review/ }))
    await expect(args.onMarkReady).toHaveBeenCalledOnce()
  },
}

/** Abandoning is the menu's last item, set apart, and reached from the keyboard. */
export const Abandoning: Story = {
  play: async ({ args, canvasElement }) => {
    const page = await opened(canvasElement)
    const items = await page.findAllByRole('menuitem')
    await expect(items.at(-1)).toHaveAccessibleName(/Abandon/)
    await userEvent.keyboard('{End}{Enter}')
    await expect(args.onAbandon).toHaveBeenCalledOnce()
  },
}

export const Reopening: Story = {
  args: { onStop: undefined, onAbandon: undefined, onReopen: fn() },
  play: async ({ args, canvasElement }) => {
    const page = await opened(canvasElement)
    await expect(page.queryByRole('menuitem', { name: /Abandon/ })).toBeNull()
    await userEvent.click(await page.findByRole('menuitem', { name: /Reopen/ }))
    await expect(args.onReopen).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => <States cells={['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <TaskMenu {...args} /> }))} />,
}
