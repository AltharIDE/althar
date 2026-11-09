import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { States } from '../../storybook/States'
import { EmptyState } from './EmptyState'

/* On a section's sheet, at a page's width, as it sits in Settings. */
function Sheet({ children, width = 800 }: { children: ReactNode; width?: number }) {
  return <div style={{ width, padding: '18px 22px', borderRadius: 12, background: 'var(--n-1)' }}>{children}</div>
}

const meta = {
  title: 'Setup/EmptyState',
  component: EmptyState,
  args: {
    icon: 'plug',
    title: 'No tracker yet',
    line: 'Connect Linear, Jira, GitHub or Trello in Settings › Code hosts and trackers, and its issues can become tasks here.',
  },
  render: (args) => (
    <Sheet>
      <EmptyState {...args} />
    </Sheet>
  ),
} satisfies Meta<typeof EmptyState>
export default meta
type Story = StoryObj<typeof meta>

/** What will be here, and how it gets here: a card with the section's mark, its title as a heading, one line. */
export const Usual: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const region = c.getByRole('region', { name: 'No tracker yet' })
    await expect(within(region).getByRole('heading', { level: 3, name: 'No tracker yet' })).toBeVisible()
    await expect(within(region).queryByRole('button')).toBeNull()
  },
}

/** With what to press, on a row of its own under the line. */
export const WithAction: Story = {
  args: {
    actions: (
      <>
        <Button size="small" icon="plug" onClick={fn()}>
          Connect a tracker
        </Button>
        <LinkButton onClick={fn()}>Manage connections</LinkButton>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const connect = c.getByRole('button', { name: 'Connect a tracker' })
    await userEvent.tab()
    await expect(connect).toHaveFocus()
    await userEvent.tab()
    await expect(c.getByRole('button', { name: 'Manage connections' })).toHaveFocus()
  },
}

/** Flush, in a sheet already drawn: a row's glyph and padding, no card of its own. */
export const Flush: Story = {
  args: {
    variant: 'flush',
    icon: 'play',
    title: 'Nothing to run yet',
    line: 'Add a command you start by hand, such as a dev server or the tests, and Run starts it without an agent.',
  },
}

/** A brand's mark in the glyph's place, at the page's own heading level. */
export const WithMark: Story = {
  args: {
    mark: <BrandMark brand={Brand.ClaudeCode} size={18} />,
    headingLevel: 2,
    title: 'No accounts yet',
    line: 'Sign in to Claude Code, and its work runs on that account.',
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { level: 2, name: 'No accounts yet' })).toBeVisible()
  },
}

/** Long words wrap inside the card rather than push past it. */
export const LongWords: Story = {
  args: {
    title: 'No tracker yet for payments-platform-refunds-and-partner-webhooks-2026-rewrite',
    line: 'Connect https://acme-corporation-engineering.atlassian.net/jira/software/projects/PAYMENTSPLATFORM in Settings › Code hosts and trackers.',
    actions: <Button size="small">Connect a tracker</Button>,
  },
  play: async ({ canvasElement }) => {
    const region = within(canvasElement).getByRole('region')
    await expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth + 1)
  },
}

/** In a narrow window: the words take what the glyph leaves. */
export const Narrow: Story = {
  args: { actions: <Button size="small">Connect a tracker</Button> },
  render: (args) => (
    <Sheet width={320}>
      <EmptyState {...args} />
    </Sheet>
  ),
}

/** At night, as calm. */
export const Dark: Story = { ...WithAction, globals: { theme: 'dark' } }

/** Each look, side by side. */
export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'card', node: <EmptyState {...args} /> },
        { state: 'with action', node: <EmptyState {...args} actions={<Button size="small">Connect a tracker</Button>} /> },
        { state: 'flush', node: <EmptyState {...args} variant="flush" icon="play" title="Nothing to run yet" /> },
        { state: 'no glyph', node: <EmptyState title={args.title} line={args.line} /> },
      ].map((cell) => ({ ...cell, node: <Sheet width={640}>{cell.node}</Sheet> }))}
    />
  ),
}
