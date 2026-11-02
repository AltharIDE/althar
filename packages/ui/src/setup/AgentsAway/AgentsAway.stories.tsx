import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { RuntimeState } from '../../foundations/vocabulary'
import type { RuntimeEntry } from '../Runtimes/Runtimes'
import { AgentsAway } from './AgentsAway'

/* The agents not on this computer on a first run: three Althar can fetch, five only their own installers put there. */
const AWAY: RuntimeEntry[] = [
  { id: 'junie', name: 'Junie', brand: Brand.Junie, state: RuntimeState.Missing },
  { id: 'opencode', name: 'OpenCode', brand: Brand.OpenCode, state: RuntimeState.Missing, download: '45 MB' },
  { id: 'copilot', name: 'GitHub Copilot', brand: Brand.GitHubCopilot, state: RuntimeState.Missing, download: '110 MB' },
  { id: 'grok', name: 'Grok Build', brand: Brand.XAI, state: RuntimeState.Missing },
  { id: 'kimi', name: 'Kimi Code', brand: Brand.Moonshot, state: RuntimeState.Missing },
  { id: 'mistral-vibe', name: 'Mistral Vibe', brand: Brand.Mistral, state: RuntimeState.Missing, guide: false },
  { id: 'qwen-code', name: 'Qwen Code', brand: Brand.Alibaba, state: RuntimeState.Missing },
  {
    id: 'antigravity',
    name: 'Google Antigravity',
    brand: Brand.Antigravity,
    state: RuntimeState.Missing,
    download: '115 MB',
    pinned: { from: 'Google', version: '1.3.0' },
  },
]

const meta = {
  title: 'Setup/AgentsAway',
  component: AgentsAway,
  decorators: [(Story) => <div style={{ width: 560 }}>{Story()}</div>],
  args: { agents: AWAY, onInstall: fn(), onHelp: fn() },
} satisfies Meta<typeof AgentsAway>
export default meta
type Story = StoryObj<typeof meta>

/** Every agent not on this computer, a tile each: those Althar can fetch first, with their size; the rest with their maker's instructions, or nothing where there are none. */
export const Every: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const tiles = within(c.getByRole('list', { name: /Agents not on/ })).getAllByRole('listitem')
    await expect(tiles.map((item) => item.textContent?.replace(/(\d+ MB|How to install).*$/, ''))).toEqual([
      'OpenCode',
      'GitHub Copilot',
      'Google Antigravity',
      'Junie',
      'Grok Build',
      'Kimi Code',
      'Mistral Vibe',
      'Qwen Code',
    ])
    await userEvent.click(c.getByRole('button', { name: 'Download Google Antigravity, 115 MB' }))
    await expect(args.onInstall).toHaveBeenCalledWith('antigravity')
    await userEvent.click(c.getByRole('button', { name: 'How to install Junie' }))
    await expect(args.onHelp).toHaveBeenCalledWith('junie')
    await expect(c.queryByRole('button', { name: 'How to install Mistral Vibe' })).toBeNull()
    ;(document.activeElement as HTMLElement | null)?.blur()
  },
}

/** Downloading one, and one whose download didn't finish: said in its tile, with a way to try again. */
export const Downloading: Story = {
  args: {
    agents: [
      { id: 'opencode', name: 'OpenCode', brand: Brand.OpenCode, state: RuntimeState.Installing, download: '45 MB' },
      {
        id: 'copilot',
        name: 'GitHub Copilot',
        brand: Brand.GitHubCopilot,
        state: RuntimeState.Missing,
        download: '110 MB',
        failed: 'GitHub couldn’t be reached to find GitHub Copilot.',
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('status')).toHaveTextContent('Downloading, 45 MB…')
    await expect(c.getByRole('alert')).toHaveTextContent('GitHub couldn’t be reached to find GitHub Copilot.')
    await expect(c.getByRole('button', { name: 'Try again to download GitHub Copilot, 110 MB' })).toBeVisible()
  },
}

/** In a narrow column, a tile to a line. */
export const Narrow: Story = { decorators: [(Story) => <div style={{ width: 360 }}>{Story()}</div>] }

/** None away: nothing to show. */
export const NoneAway: Story = { args: { agents: [] } }
