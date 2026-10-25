import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { CLAUDE_PLENTY, CLAUDE_TWO, CODEX_NEARLY, CODEX_PLENTY, SILENT } from '../../fixtures/plan'
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

/** What the bar says beside the gauge: the load meter beside it has its own. */
const said = (gauge: HTMLElement) => gauge.parentElement?.querySelector('output') ?? null

/** Every plan well over half: two steps lit, nothing said. */
export const Plenty: Story = {
  play: async ({ canvasElement }) => {
    const gauge = within(canvasElement).getByRole('button', { name: 'Plan usage: Claude Code has 62% left, until 17:00' })
    await expect(said(gauge)).toBeEmptyDOMElement()
  },
}

/** Codex's five hours at 3%: the gauge in full ink, and who and until when beside it. */
export const NearlyOut: Story = {
  args: { agents: [CODEX_NEARLY, CLAUDE_PLENTY] },
  play: async ({ canvasElement }) => {
    await expect(said(within(canvasElement).getByRole('button', { name: /^Plan usage/ }))).toHaveTextContent('Codex 3% · 14:00')
  },
}

/** Opened: the level, a row per agent least room first, and the agents with no reading at the foot. */
export const Open: Story = {
  args: { agents: [CODEX_NEARLY, CLAUDE_TWO], silent: SILENT, defaultOpen: true },
  play: async () => {
    const page = within(document.body)
    await expect(page.getByText('Codex is nearly out')).toBeInTheDocument()
    await expect(page.getByText('Personal · Weekly limit · until Fri 09:00')).toBeInTheDocument()
    // An agent opens in place to every account and window, an old one saying so.
    await userEvent.click(page.getByRole('button', { name: /Claude Code/ }))
    await expect(page.getByText('read 2 hours ago')).toBeInTheDocument()
    await expect(page.getByText('Work')).toBeInTheDocument()
    // The agents with no reading, in a line that opens to why.
    await userEvent.click(page.getByRole('button', { name: 'No reading for GitHub Copilot, Junie and Mistral Vibe' }))
    await expect(page.getByText('Copilot shares no plan usage with other apps.')).toBeVisible()
  },
}

/** Nothing read yet, only agents that share nothing: the gauge unlit, and the peek says so. */
export const NothingRead: Story = {
  args: { agents: [], silent: SILENT, defaultOpen: true },
  play: async () => {
    await expect(within(document.body).getByText('Nothing read yet')).toBeInTheDocument()
  },
}
