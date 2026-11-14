import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import {
  CLAUDE_PLENTY,
  CLAUDE_RESETS,
  CLAUDE_TWO,
  CLAUDE_UNREAD,
  CODEX_NEARLY,
  CODEX_PLENTY,
  CODEX_SIGNED_OUT,
  OPENCODE_GO,
  OPENCODE_GO_CONNECTED,
  OPENCODE_GO_SIGN_IN,
} from '../../fixtures/plan'
import { LOAD_BUSY, LOAD_SLOTS } from '../../fixtures/load'
import { LoadMeter } from '../LoadMeter/LoadMeter'
import { PlanGauge } from './PlanGauge'

const meta = {
  title: 'Chrome/PlanGauge',
  component: PlanGauge,
  args: { agents: [CLAUDE_PLENTY, CODEX_PLENTY] },
  // At the end of a row, after the load meter, as in the bar, with room under it for the peek.
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', gap: 2, minHeight: 520 }}>
        <LoadMeter load={LOAD_BUSY} slots={LOAD_SLOTS} />
        {Story()}
      </div>
    ),
  ],
} satisfies Meta<typeof PlanGauge>
export default meta
type Story = StoryObj<typeof meta>

/** Every plan well over half: two steps lit. */
export const Plenty: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Plan usage: Claude Code has 62% left, until 17:00' }),
    ).toBeInTheDocument()
  },
}

/** Codex's five hours at 3%: the gauge in full ink, its label saying the figure that counts. */
export const NearlyOut: Story = {
  args: { agents: [CODEX_NEARLY, CLAUDE_PLENTY] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /^Plan usage: Codex has 3% left/ })).toBeInTheDocument()
  },
}

/** Opened: the level and a row per agent, least room first. */
export const Open: Story = {
  args: { agents: [CODEX_NEARLY, CLAUDE_TWO], defaultOpen: true },
  play: async () => {
    const page = within(document.body)
    await expect(page.getByText('Codex is nearly out')).toBeInTheDocument()
    await expect(page.getByText('Personal · Weekly limit · until Fri 09:00')).toBeInTheDocument()
    // An agent opens in place to every account and window, an old one saying so.
    await userEvent.click(page.getByRole('button', { name: /^Claude Code/ }))
    await expect(page.getByText('read 2 hours ago')).toBeInTheDocument()
    await expect(page.getByText('Work')).toBeInTheDocument()
  },
}

/* Signed out, as the app gives it: put right from its row. */
const CODEX_OUT = { ...CODEX_SIGNED_OUT, signIn: true }

/** Codex signed out, its last 80% saved: the figure is Claude Code's, which can run, and Codex's row signs it in again. */
export const SignedOut: Story = {
  args: { agents: [CLAUDE_PLENTY, CODEX_OUT], defaultOpen: true, onSignIn: fn() },
  play: async ({ args, canvasElement }) => {
    const page = within(document.body)
    await expect(
      within(canvasElement).getByRole('button', { name: 'Plan usage: Claude Code has 62% left, until 17:00' }),
    ).toBeInTheDocument()
    await expect(page.getByText('Plenty left')).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Sign in again' }))
    await expect(args.onSignIn).toHaveBeenCalledWith(CODEX_SIGNED_OUT.id)
    // Its saved numbers stay in its detail, with why it runs nothing.
    await userEvent.click(page.getByRole('button', { name: /^Codex/ }))
    await expect(page.getByText('Sign in to Codex to see its usage.')).toBeInTheDocument()
    await expect(page.getByText('80%')).toBeInTheDocument()
  },
}

/** Every agent read signed out: the gauge unlit, and the peek says no work can start, with the way to sign in again. */
export const AllSignedOut: Story = {
  args: { agents: [CODEX_OUT], defaultOpen: true, onSignIn: fn() },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Plan usage: Codex can’t start work' })).toBeInTheDocument()
    await expect(within(document.body).getByText('Codex can’t start work')).toBeInTheDocument()
    await expect(within(document.body).queryByText('Plenty left')).toBeNull()
  },
}

/** Each window ends its row with the time left, and the exact time on hover; one that reset since it was read says so, and one with no time says that. */
export const Resets: Story = {
  args: { agents: [CLAUDE_RESETS, CODEX_PLENTY], defaultOpen: true },
  play: async () => {
    const page = within(document.body)
    await userEvent.click(page.getByRole('button', { name: /^Claude Code/ }))
    await expect(page.getByTitle('Resets Fri 09:00 · in 1d 18h')).toBeInTheDocument()
    await expect(page.getByTitle('Reset at 14:00 · not read since')).toBeInTheDocument()
    await expect(page.getByText('no reset time')).toBeInTheDocument()
  },
}

/** Two accounts, each window with its reset. */
export const ResetsTwoAccounts: Story = {
  args: { agents: [CLAUDE_TWO], defaultOpen: true },
  play: async () => {
    const page = within(document.body)
    await userEvent.click(page.getByRole('button', { name: /^Claude Code/ }))
    await expect(page.getByTitle('Resets 15:40 · in 50m')).toBeInTheDocument()
  },
}

/** Claude Code's windows all reset since it was read: no figure, never all of its plan left, and its detail says why it wasn't read again. */
export const Unread: Story = {
  args: { agents: [CODEX_PLENTY, CLAUDE_UNREAD], defaultOpen: true },
  play: async ({ canvasElement }) => {
    const page = within(document.body)
    await expect(within(canvasElement).getByRole('button', { name: /^Plan usage: Codex has / })).toBeInTheDocument()
    await expect(page.getByText('Not read since reset')).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: /^Claude Code/ }))
    await expect(page.getByText('read 2 days ago')).toBeInTheDocument()
    await expect(page.getByText(/Its sign-in has expired/)).toBeInTheDocument()
  },
}

/** Every agent read unread since its reset: the gauge unlit, and the peek says which. */
export const AllUnread: Story = {
  args: { agents: [CLAUDE_UNREAD], defaultOpen: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Plan usage: Claude Code not read since reset' })).toBeInTheDocument()
  },
}

/** Nothing read yet: the gauge unlit, and the peek says so. */
export const NothingRead: Story = {
  args: { agents: [], defaultOpen: true },
  play: async () => {
    await expect(within(document.body).getByText('Nothing read yet')).toBeInTheDocument()
  },
}

/** OpenCode Go beside the others, its tightest window its figure, as any plan's. */
export const OpenCodeGo: Story = {
  args: { agents: [OPENCODE_GO, CODEX_PLENTY], defaultOpen: true },
  play: async () => {
    const page = within(document.body)
    await expect(page.getByText('Weekly limit · until Mon 01:00')).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: /^OpenCode Go/ }))
    await expect(page.getByText('Month')).toBeInTheDocument()
  },
}

/** OpenCode Go signed in with its key alone: connected, with no bar, and why in its detail. */
export const OpenCodeGoConnected: Story = {
  args: { agents: [CLAUDE_PLENTY, OPENCODE_GO_CONNECTED], defaultOpen: true },
  play: async () => {
    const page = within(document.body)
    await expect(page.getByText('Plenty left')).toBeInTheDocument()
    await expect(page.getByText('Connected')).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: /^OpenCode Go/ }))
    await expect(page.getByText(/only through an OpenCode Console sign-in/)).toBeInTheDocument()
  },
}

/** OpenCode Go's key refused: its row's button signs it in again. */
export const OpenCodeGoSignIn: Story = {
  args: { agents: [CLAUDE_PLENTY, OPENCODE_GO_SIGN_IN], defaultOpen: true, onSignIn: fn() },
  play: async ({ args }) => {
    await userEvent.click(within(document.body).getByRole('button', { name: 'Sign in again' }))
    await expect(args.onSignIn).toHaveBeenCalledWith('opencode')
  },
}
