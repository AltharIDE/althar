import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { UpdateReady } from '../../chrome/UpdateReady/UpdateReady'
import { AboutHeader, HelpImprove } from './AboutAlthar'

const meta = {
  title: 'Setup/AboutAlthar',
  component: AboutHeader,
  args: {
    version: '0.9.0',
    website: 'https://althar.ai',
    notes: 'https://althar.ai/changelog',
    community: 'https://discord.gg/QA2g8MwKda',
    onReport: fn(),
  },
  render: (args) => (
    <div style={{ width: 720 }}>
      <AboutHeader {...args} />
    </div>
  ),
} satisfies Meta<typeof AboutHeader>
export default meta
type Story = StoryObj<typeof meta>

/** Althar's name and version under Early access, and the ways out: the website, what's new, Discord, and Report a problem. */
export const Header: Story = {
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement)
    await expect(view.getByText('Early access')).toBeInTheDocument()
    await expect(view.getByText('Althar 0.9.0')).toBeInTheDocument()
    await expect(view.getByRole('link', { name: /What’s new/ })).toHaveAttribute('href', 'https://althar.ai/changelog')
    await expect(view.getByRole('link', { name: /Website/ })).toHaveAttribute('href', 'https://althar.ai/')
    await expect(view.getByRole('link', { name: /Discord/ })).toHaveAttribute('href', 'https://discord.gg/QA2g8MwKda')
    await userEvent.click(view.getByRole('button', { name: 'Report a problem' }))
    await expect(args.onReport).toHaveBeenCalledOnce()
  },
}

/** Where the app shows what's new in the window, What's new opens there, a press like the others, with no arrow out. */
export const WhatsNewInTheWindow: Story = {
  args: { onNotes: fn() },
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement)
    await expect(view.queryByRole('link', { name: /What’s new/ })).toBeNull()
    await userEvent.click(view.getByRole('button', { name: 'What’s new' }))
    await expect(args.onNotes).toHaveBeenCalledOnce()
  },
}

/** No update ready: Check for updates under the name, and Checking… while it looks. */
export const CheckForUpdates: Story = {
  args: { onCheck: fn() },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Check for updates' }))
    await expect(args.onCheck).toHaveBeenCalledOnce()
  },
}

/** A check under way. */
export const Checking: Story = {
  args: { onCheck: fn(), checking: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Checking…' })).toBeDisabled()
  },
}

/** An update ready: its line under the name, in Check for updates' place. Where the app can't report, no Report a problem. */
export const UpdateWaiting: Story = {
  args: { update: <UpdateReady version="0.9.1" onRestart={fn()} />, onReport: undefined, onCheck: fn() },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement)
    await expect(view.queryByRole('button', { name: 'Check for updates' })).toBeNull()
    await expect(view.getByRole('status')).toBeInTheDocument()
    await expect(view.queryByRole('button', { name: 'Report a problem' })).toBeNull()
  },
}

/** Usage data and crash reports, a switch each, side by side under the one line on what they send. */
export const HelpImproveAlthar: Story = {
  render: () => (
    <div style={{ width: 720 }}>
      <HelpImprove usage onUsage={fn()} crashes={false} onCrashes={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const view = within(canvasElement)
    await expect(view.getByRole('switch', { name: 'Usage data' })).toHaveAttribute('aria-checked', 'true')
    await expect(view.getByRole('switch', { name: 'Crash reports' })).toHaveAccessibleDescription('Anonymous. Never your code or any name.')
  },
}

/** DO_NOT_TRACK set: both off, and not turned on here, and the line says why. */
export const DoNotTrack: Story = {
  render: () => (
    <div style={{ width: 720 }}>
      <HelpImprove usage onUsage={fn()} crashes onCrashes={fn()} doNotTrack />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const usage = within(canvasElement).getByRole('switch', { name: 'Usage data' })
    await expect(usage).toBeDisabled()
    await expect(usage).toHaveAccessibleDescription('Off while DO_NOT_TRACK is set.')
  },
}
