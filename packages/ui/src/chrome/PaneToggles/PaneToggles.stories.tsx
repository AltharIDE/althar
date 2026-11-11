import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { type Pane, PaneToggles } from './PaneToggles'

const meta = {
  title: 'Chrome/PaneToggles',
  component: PaneToggles,
  args: { shown: { talk: true, board: true }, onToggle: fn(), swapped: false, onSwap: fn(), keys: { talk: 'c', board: 'b' } },
} satisfies Meta<typeof PaneToggles>
export default meta
type Story = StoryObj<typeof meta>

/** Both panes show: either toggle hides its own, and the sides can change. */
export const Both: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Board' }))
    await expect(args.onToggle).toHaveBeenCalledWith('board')
    await userEvent.click(c.getByRole('button', { name: 'Swap sides' }))
    await expect(args.onSwap).toHaveBeenCalledOnce()
  },
}

/** The conversation alone: its toggle stays lit and can't hide it; the board's brings the board back; the sides wait for both. */
export const ConversationAlone: Story = {
  args: { shown: { talk: true, board: false } },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const talk = c.getByRole('button', { name: 'Conversation' })
    await expect(talk).toHaveAttribute('aria-pressed', 'true')
    await expect(talk).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(talk)
    await expect(args.onToggle).not.toHaveBeenCalled()
    await expect(c.getByRole('button', { name: 'Swap sides' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(c.getByRole('button', { name: 'Board' }))
    await expect(args.onToggle).toHaveBeenCalledWith('board')
  },
}

/** The board alone. */
export const BoardAlone: Story = { args: { shown: { talk: false, board: true } } }

/** The conversation on the right: Swap sides is lit; the toggles stay in their places. */
export const Swapped: Story = {
  args: { swapped: true },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Conversation',
      'Board',
      'Swap sides',
    ])
    await expect(c.getByRole('button', { name: 'Swap sides' })).toHaveAttribute('aria-pressed', 'true')
  },
}

/** Away from the home, in its settings say: neither shows, and either goes back home with its pane. */
export const Away: Story = { args: { shown: { talk: false, board: false } } }

/** Played with: whatever is pressed, the group keeps its width. */
export const KeepsItsWidth: Story = {
  render: function Render(args) {
    const [shown, setShown] = useState<Record<Pane, boolean>>({ talk: true, board: true })
    const [swapped, setSwapped] = useState(false)
    return (
      <PaneToggles
        {...args}
        shown={shown}
        swapped={swapped}
        onSwap={() => setSwapped((was) => !was)}
        onToggle={(pane) => setShown((was) => ({ ...was, [pane]: !was[pane] }))}
      />
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const group = c.getByRole('group', { name: 'Panes' })
    const width = group.getBoundingClientRect().width
    await userEvent.click(c.getByRole('button', { name: 'Swap sides' }))
    await userEvent.click(c.getByRole('button', { name: 'Board' }))
    await expect(group.getBoundingClientRect().width).toBe(width)
    await userEvent.click(c.getByRole('button', { name: 'Board' }))
    await expect(group.getBoundingClientRect().width).toBe(width)
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-child', focus: 'button:first-child', pressed: 'button:first-child' }),
  render: () => (
    <States
      cells={[
        { state: 'both', node: <PaneToggles shown={{ talk: true, board: true }} onToggle={() => {}} swapped={false} onSwap={() => {}} /> },
        { state: 'swapped', node: <PaneToggles shown={{ talk: true, board: true }} onToggle={() => {}} swapped onSwap={() => {}} /> },
        {
          state: 'conversation alone',
          node: <PaneToggles shown={{ talk: true, board: false }} onToggle={() => {}} swapped={false} onSwap={() => {}} />,
        },
        {
          state: 'board alone',
          node: <PaneToggles shown={{ talk: false, board: true }} onToggle={() => {}} swapped={false} onSwap={() => {}} />,
        },
        {
          state: 'away',
          node: <PaneToggles shown={{ talk: false, board: false }} onToggle={() => {}} swapped={false} onSwap={() => {}} />,
        },
        { state: 'hover', node: <PaneToggles shown={{ talk: true, board: true }} onToggle={() => {}} swapped={false} onSwap={() => {}} /> },
        { state: 'focus', node: <PaneToggles shown={{ talk: true, board: true }} onToggle={() => {}} swapped={false} onSwap={() => {}} /> },
        {
          state: 'pressed',
          node: <PaneToggles shown={{ talk: true, board: true }} onToggle={() => {}} swapped={false} onSwap={() => {}} />,
        },
      ]}
    />
  ),
}
