import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { AttachPullRequest } from './AttachPullRequest'

const meta = {
  title: 'Chrome/AttachPullRequest',
  component: AttachPullRequest,
  parameters: { layout: 'fullscreen' },
  args: { onAttach: fn(), onBack: fn(), onClose: fn() },
  decorators: [(Story) => <div style={{ minHeight: 420 }}>{Story()}</div>],
} satisfies Meta<typeof AttachPullRequest>
export default meta
type Story = StoryObj<typeof meta>

/** Its link or number, to follow: nothing is attached until it is sent. */
export const Asking: Story = {}

/** A link pasted and sent: it attaches, and asks nothing yet of its branch. */
export const Attaching: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.type(
      await page.findByRole('textbox', { name: 'Its link or number' }),
      'https://github.com/AltharIDE/althar/pull/185{Enter}',
    )
    await expect(args.onAttach).toHaveBeenCalledWith('https://github.com/AltharIDE/althar/pull/185', false)
  },
}

/** Sent empty: it says what is missing, and attaches nothing. */
export const Missing: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Attach' }))
    await expect(await page.findByRole('alert')).toHaveTextContent('Give the pull request’s link, or its number.')
    await expect(args.onAttach).not.toHaveBeenCalled()
  },
}

/** The task's branch isn't based on its head: starting there keeps its own commits, once the person says. */
export const StartFromHead: Story = {
  args: { defaultValue: '#185', start: { name: 'PR #185', source: 'ninemate:permission-card-enter', own: 2 } },
  play: async ({ args }) => {
    const page = within(document.body)
    await expect(await page.findByRole('dialog', { name: 'Start from PR #185’s head?' })).toHaveTextContent(
      'Its 2 own commits go on top, one by one.',
    )
    await userEvent.click(page.getByRole('button', { name: 'Start from its head' }))
    await expect(args.onAttach).toHaveBeenCalledWith('#185', true)
  },
}

/** A task with nothing of its own: none is lost. */
export const NothingOwn: Story = {
  args: { defaultValue: '#185', start: { name: 'PR #185', source: 'permission-card-enter', own: 0 } },
}

/** Attaching it. */
export const Busy: Story = { args: { defaultValue: '#185', busy: true } }

/** The runtime said no, in its words. */
export const Refused: Story = {
  args: { defaultValue: '#3', error: 'PR #3 is closed: only an open one can be attached.' },
}

/** Escape closes it, and nothing is attached. */
export const Escaping: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await page.findByRole('dialog', { name: 'Attach a pull request' })
    await userEvent.keyboard('{Escape}')
    await expect(args.onClose).toHaveBeenCalled()
    await expect(args.onAttach).not.toHaveBeenCalled()
  },
}
