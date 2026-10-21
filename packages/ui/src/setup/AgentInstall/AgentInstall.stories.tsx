import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { States } from '../../storybook/States'
import { AgentInstall, type AgentInstallState } from './AgentInstall'

const onInstall = fn()

/* As a consumer drives it: the download starts, then finishes or doesn't. */
function Downloading() {
  const [state, setState] = useState<AgentInstallState>({ kind: 'idle' })
  return (
    <AgentInstall
      name="OpenCode"
      brand={Brand.OpenCode}
      size="45 MB"
      state={state}
      onInstall={() => {
        onInstall()
        setState({ kind: 'installing' })
      }}
      onHelp={fn()}
    />
  )
}

const meta = {
  title: 'Setup/AgentInstall',
  component: AgentInstall,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 560 }}>{Story()}</div>],
  args: { name: 'OpenCode', brand: Brand.OpenCode, size: '45 MB' },
} satisfies Meta<typeof AgentInstall>
export default meta
type Story = StoryObj<typeof meta>

/** Where Althar can fetch it: from where, how big, checked; the download says so while it runs. */
export const Downloads: Story = {
  render: () => <Downloading />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/from GitHub, about 45 MB/)).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Download OpenCode' }))
    await expect(onInstall).toHaveBeenCalledOnce()
    await expect(c.getByRole('status')).toHaveTextContent('Downloading OpenCode, about 45 MB, and checking it')
    await expect(c.queryByRole('button', { name: 'Download OpenCode' })).toBeNull()
  },
}

/** One version from its maker's own address, as Antigravity's server is from Google: which, and from whom, not GitHub's latest. */
export const FromItsMaker: Story = {
  args: {
    name: 'Google Antigravity',
    brand: Brand.Antigravity,
    size: '115 MB',
    pinned: { from: 'Google', version: '1.3.0' },
    onInstall: fn(),
    onHelp: fn(),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/Althar can fetch Google Antigravity 1\.3\.0 from Google, about 115 MB/)).toBeInTheDocument()
    await expect(c.queryByText(/GitHub/)).toBeNull()
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        {
          state: 'can download',
          node: <AgentInstall name="OpenCode" brand={Brand.OpenCode} size="45 MB" onInstall={fn()} onHelp={fn()} />,
        },
        {
          state: 'downloading',
          node: <AgentInstall name="OpenCode" brand={Brand.OpenCode} size="45 MB" state={{ kind: 'installing' }} onInstall={fn()} />,
        },
        {
          state: 'didn’t finish',
          node: (
            <AgentInstall
              name="OpenCode"
              brand={Brand.OpenCode}
              size="45 MB"
              state={{ kind: 'failed', why: 'GitHub couldn’t be reached to find OpenCode.' }}
              onInstall={fn()}
              onHelp={fn()}
            />
          ),
        },
        { state: 'only its own installer', node: <AgentInstall name="Gemini CLI" onHelp={fn()} /> },
      ]}
    />
  ),
}
