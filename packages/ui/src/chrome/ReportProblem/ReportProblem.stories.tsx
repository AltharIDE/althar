import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { REPORT_ITEMS, WINDOW_SHOT } from '../../fixtures/report'
import { ReportProblem } from './ReportProblem'

const meta = {
  title: 'Chrome/ReportProblem',
  component: ReportProblem,
  parameters: { layout: 'fullscreen' },
  args: { screenshot: WINDOW_SHOT, items: REPORT_ITEMS, onSend: fn(), onClose: fn() },
  decorators: [(Story) => <div style={{ minHeight: 760 }}>{Story()}</div>],
} satisfies Meta<typeof ReportProblem>
export default meta
type Story = StoryObj<typeof meta>

/** As it opens: the box to write in first, the screenshot and logs on. */
export const Open: Story = {}

/** From Help, with the email the person gave last time. */
export const Remembered: Story = { args: { defaultEmail: 'dana@example.com' } }

/** From "Report this" on something that went wrong: what it is about, under the title. */
export const About: Story = { args: { description: 'About: Stuck, Implement, in Retry the checkout call' } }

/** With no reports service set up, it is saved for the person's mail app, and says so first. */
export const ByMail: Story = {
  args: { description: 'Althar saves the report in Downloads and opens a message in your mail app to send it with.' },
}

/** Every item that goes, listed. */
export const Showing: Story = { args: { defaultShowing: true } }

/** What goes with it is still being read. */
export const Reading: Story = { args: { items: null, defaultShowing: true } }

/** No picture of the window could be taken: no screenshot to include. */
export const NoScreenshot: Story = { args: { screenshot: undefined, defaultShowing: true } }

/** Sending it. */
export const Sending: Story = { args: { sending: true } }

/** It didn't go: why, and Send stays to try again. */
export const Failed: Story = { args: { error: 'Althar couldn’t reach its reports service.' } }

/** Sent. */
export const Sent: Story = { args: { done: { title: 'Report sent', line: 'It reached the people who make Althar.' } } }

/** Saved for the mail app. */
export const Saved: Story = {
  args: {
    done: {
      title: 'Report saved',
      line: 'It’s in Downloads as althar-report-2026-10-11-1405.zip. Attach it to the message in your mail app.',
    },
  },
}

/** Sent with what was written, the switches as they were, and the email. */
export const Writing: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.type(await page.findByRole('textbox', { name: 'What happened?' }), '  The task stopped after the review  ')
    await userEvent.type(page.getByRole('textbox', { name: 'Email, if you’d like a reply' }), 'dana@example.com')
    await userEvent.click(page.getByRole('button', { name: /^Send/ }))
    await expect(args.onSend).toHaveBeenCalledWith({
      text: 'The task stopped after the review',
      screenshot: true,
      logs: true,
      email: 'dana@example.com',
    })
  },
}

/** ⌘↵ sends from the box, where Enter is a new line. */
export const SendingByKeys: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    const box = await page.findByRole('textbox', { name: 'What happened?' })
    await userEvent.type(box, 'It stopped.{Enter}Nothing moved.')
    await expect(args.onSend).not.toHaveBeenCalled()
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await expect(args.onSend).toHaveBeenCalledWith(expect.objectContaining({ text: 'It stopped.\nNothing moved.' }))
  },
}

/** Nothing written: it says so beside the box, focus goes there, and nothing is sent. */
export const Empty: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: /^Send/ }))
    await expect(page.getByRole('alert')).toHaveTextContent('Say what happened first')
    await expect(page.getByRole('textbox', { name: 'What happened?' })).toHaveFocus()
    await expect(args.onSend).not.toHaveBeenCalled()
  },
}

/** Left out, the screenshot's preview and its item go, and it isn't sent; the same for the logs. */
export const LeavingOut: Story = {
  args: { defaultShowing: true },
  play: async ({ args }) => {
    const page = within(document.body)
    await page.findByRole('img', { name: 'Screenshot of this window' })
    await userEvent.click(page.getByRole('switch', { name: 'Include a screenshot of this window' }))
    await expect(page.queryByRole('img', { name: 'Screenshot of this window' })).toBeNull()
    await expect(page.queryByText('This window, as it was')).toBeNull()
    await userEvent.click(page.getByRole('switch', { name: 'Include logs' }))
    await expect(page.queryByText('runtime.log')).toBeNull()
    await expect(page.getByText('Install id')).toBeInTheDocument()
    await userEvent.type(page.getByRole('textbox', { name: 'What happened?' }), 'Nothing opened')
    await userEvent.click(page.getByRole('button', { name: /^Send/ }))
    await expect(args.onSend).toHaveBeenCalledWith({ text: 'Nothing opened', screenshot: false, logs: false, email: '' })
  },
}

/** Sent or saved, Close has the focus, and closes. */
export const Closing: Story = {
  args: { done: { title: 'Report sent', line: 'It reached the people who make Althar.' } },
  play: async ({ args }) => {
    const page = within(document.body)
    const close = await page.findByRole('button', { name: 'Close' })
    await expect(close).toHaveFocus()
    await userEvent.click(close)
    await expect(args.onClose).toHaveBeenCalled()
  },
}

export const Cancelling: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Cancel' }))
    await expect(args.onClose).toHaveBeenCalled()
  },
}
