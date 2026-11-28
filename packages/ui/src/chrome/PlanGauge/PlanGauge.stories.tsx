import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import {
  CLAUDE_AHEAD,
  CLAUDE_PLENTY,
  CLAUDE_RATE_LIMITED,
  CLAUDE_RESETS,
  CLAUDE_TWO,
  CLAUDE_UNREAD,
  CODEX_BEHIND,
  CODEX_EXPIRED,
  CODEX_MAIN_SIGNED_OUT,
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

/** Opened: a row per agent, least room first. */
export const Open: Story = {
  args: { agents: [CODEX_NEARLY, CLAUDE_TWO], defaultOpen: true },
  play: async () => {
    const page = within(document.body)
    await expect(page.getByText('Plan usage', { selector: 'h2' })).toBeInTheDocument()
    await expect(page.queryByText('Codex is nearly out')).toBeNull()
    await expect(page.getByText('Personal · Weekly limit · until Fri 09:00')).toBeInTheDocument()
    // An agent opens in place to a card for each account, which say what the figure is of, so the line under its bar goes.
    await userEvent.click(page.getByRole('button', { name: /^Claude Code/ }))
    await expect(page.queryByText('Personal · Weekly limit · until Fri 09:00')).toBeNull()
    await expect(page.getByRole('group', { name: 'Personal' })).toBeInTheDocument()
    await expect(page.getByRole('group', { name: 'Work' })).toBeInTheDocument()
    await expect(page.getByText('Last read 2 hours ago')).toBeInTheDocument()
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
    await userEvent.click(page.getByRole('button', { name: 'Sign in again' }))
    await expect(args.onSignIn).toHaveBeenCalledWith(CODEX_SIGNED_OUT.id)
    // Its saved numbers stay in its detail, faded, with how old: the row's button says why it runs nothing, once.
    await userEvent.click(page.getByRole('button', { name: /^Codex/ }))
    await expect(page.queryByText('Signed out. Sign in again to read usage.')).toBeNull()
    await expect(page.getByText('80%')).toBeInTheDocument()
    await expect(page.getByText('Last read 3 hours ago')).toBeInTheDocument()
  },
}

/**
 * Codex on two accounts, Main signed out: work goes to Plus, whose figure the row shows. Opened, Main's card is on the
 * danger wash, Signed out with its own Sign in, its last month faded with how old it is.
 */
export const AccountSignedOut: Story = {
  args: { agents: [CODEX_MAIN_SIGNED_OUT, CLAUDE_PLENTY], defaultOpen: true, onSignIn: fn() },
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(page.getByRole('button', { name: /^Codex/ }))
    const main = within(page.getByRole('group', { name: 'Main' }))
    await expect(main.getByRole('alert')).toHaveTextContent('Main Signed out')
    await expect(main.getByText('Last read 1h ago')).toBeInTheDocument()
    await expect(within(page.getByRole('group', { name: 'Plus' })).queryByRole('alert')).toBeNull()
    await userEvent.click(main.getByRole('button', { name: 'Sign in' }))
    await expect(args.onSignIn).toHaveBeenCalledWith(CODEX_MAIN_SIGNED_OUT.id, 'codex-main')
  },
}

/** Every agent read signed out: the gauge unlit, and the peek says no work can start, with the way to sign in again. */
export const AllSignedOut: Story = {
  args: { agents: [CODEX_OUT], defaultOpen: true, onSignIn: fn() },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Plan usage: Codex can’t start work' })).toBeInTheDocument()
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

/** Codex's sign-in expired, on both its accounts: the row's Sign in again says it, once, and each card has its last week faded with how old. */
export const ReadingFailed: Story = {
  args: { agents: [CLAUDE_PLENTY, CODEX_EXPIRED], defaultOpen: true, onSignIn: fn() },
  play: async () => {
    const page = within(document.body)
    await userEvent.click(page.getByRole('button', { name: /^Codex/ }))
    await expect(page.queryByText('Signed out. Sign in again to read usage.')).toBeNull()
    await expect(page.queryAllByRole('alert')).toHaveLength(0)
    await expect(page.getAllByText('Last read 20m ago')).toHaveLength(2)
    await expect(page.queryByTitle(/of the way through/)).toBeNull()
  },
}

/** Claude Code rate limited on both accounts: the line once, and the last numbers each account read, quieter. */
export const ReadingFailedOther: Story = {
  args: { agents: [CLAUDE_RATE_LIMITED, CODEX_PLENTY], defaultOpen: true },
  play: async () => {
    const page = within(document.body)
    await userEvent.click(page.getByRole('button', { name: /^Claude Code/ }))
    await expect(page.getAllByText('Rate limited. Tries again later.')).toHaveLength(1)
  },
}

/** One account's last read got no reply: its line under it, and its numbers quieter than the other's, which are fresh. */
export const StaleReading: Story = {
  args: { agents: [CLAUDE_TWO], defaultOpen: true },
  play: async () => {
    const page = within(document.body)
    await userEvent.click(page.getByRole('button', { name: /^Claude Code/ }))
    await expect(page.getByText('No reply. Tries again soon.')).toBeInTheDocument()
    await expect(page.getByText('Last read 2 hours ago')).toBeInTheDocument()
    // A read that tries again by itself isn't a fault to act on.
    await expect(page.queryAllByRole('alert')).toHaveLength(0)
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
    await expect(page.getByText('Last read 2 days ago')).toBeInTheDocument()
    await expect(page.getByText(/Sign-in expired/)).toBeInTheDocument()
  },
}

/** Every agent read unread since its reset: the gauge unlit, and the peek says which. */
export const AllUnread: Story = {
  args: { agents: [CLAUDE_UNREAD], defaultOpen: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Plan usage: Claude Code not read since reset' })).toBeInTheDocument()
  },
}

/** Nothing read yet: the gauge unlit and named so, and the peek is its heading alone. */
export const NothingRead: Story = {
  args: { agents: [], defaultOpen: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Plan usage: Nothing read yet' })).toBeInTheDocument()
    await expect(within(document.body).getByText('Plan usage', { selector: 'h2' })).toBeInTheDocument()
    await expect(within(document.body).queryByText('Nothing read yet')).toBeNull()
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
    await expect(page.getByText('Connected')).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: /^OpenCode Go/ }))
    await expect(page.getByText(/only through an OpenCode Console sign-in/)).toBeInTheDocument()
  },
}

/** OpenCode Go's key refused: its row's button signs it in again; opened, it says nothing was read. */
export const OpenCodeGoSignIn: Story = {
  args: { agents: [CLAUDE_PLENTY, OPENCODE_GO_SIGN_IN], defaultOpen: true, onSignIn: fn() },
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(page.getByRole('button', { name: /^OpenCode Go/ }))
    await expect(page.getByText('No usage read yet.')).toBeInTheDocument()
    await expect(page.queryByText('OpenCode Go needs signing in again.')).toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'Sign in again' }))
    await expect(args.onSignIn).toHaveBeenCalledWith('opencode')
  },
}

/** A tick on each bar at the share of the window still to come: the fill ends on it at an even pace, runs past it ahead of pace (Claude's week, 65% left of a week 40% gone) and stops short of it behind (Codex's week, 20% left of a week 70% gone; Claude's Opus week, 50% left at 40%). */
export const Pace: Story = {
  args: { agents: [CODEX_BEHIND, CLAUDE_AHEAD], defaultOpen: true },
  play: async () => {
    const page = within(document.body)
    await expect(page.getAllByTitle('40% of the way through').length).toBeGreaterThan(0)
    await expect(page.getAllByTitle('70% of the way through').length).toBeGreaterThan(0)
    await userEvent.click(page.getByRole('button', { name: /^Claude Code/ }))
    await expect(page.getAllByTitle('30% of the way through').length).toBe(1)
  },
}

/** No window known (no start or reset): no tick, and the bars are as they were. */
export const NoWindowKnown: Story = {
  args: { agents: [CLAUDE_RESETS, CODEX_PLENTY], defaultOpen: true },
  play: async () => {
    await expect(within(document.body).queryByTitle(/of the way through/)).toBeNull()
  },
}
