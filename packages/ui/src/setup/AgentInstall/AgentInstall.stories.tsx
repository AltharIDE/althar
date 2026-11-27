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

/** Installed by hand, with its own installer: Check again looks for it at once, rather than wait for the window to come back. */
export const ChecksAgain: Story = {
  args: { name: 'Grok Build', brand: Brand.XAI, size: undefined, onHelp: fn(), onCheck: fn() },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Install Grok Build with its own installer, then come back here.')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Check again' }))
    await expect(args.onCheck).toHaveBeenCalledOnce()
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
    await expect(c.getByText(/Google Antigravity 1\.3\.0, from Google, about 115 MB/)).toBeInTheDocument()
    await expect(c.queryByText(/GitHub/)).toBeNull()
  },
}

/** Where its maker has no build for this device and nothing else installs it, as Antigravity's server on some systems: it says so, and offers nothing. */
export const NoBuild: Story = {
  args: { name: 'Google Antigravity', brand: Brand.Antigravity, size: undefined, noBuild: true, onCheck: fn() },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/There’s no build of Google Antigravity for this/)).toBeInTheDocument()
    await expect(c.queryByText(/installer/)).toBeNull()
    await expect(c.queryByRole('button')).toBeNull()
  },
}

/** Downloaded only by Althar, where this window can't start it: never sent to an installer it doesn't have. */
export const OnlyAltharsDownload: Story = {
  args: {
    name: 'Google Antigravity',
    brand: Brand.Antigravity,
    size: '125 MB',
    pinned: { from: 'Google', version: '1.3.0' },
    onCheck: fn(),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Althar can’t download Google Antigravity from this window.')).toBeInTheDocument()
    await expect(c.queryByText(/installer/)).toBeNull()
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
        {
          state: 'can download, or check',
          node: <AgentInstall name="OpenCode" brand={Brand.OpenCode} size="45 MB" onInstall={fn()} onHelp={fn()} onCheck={fn()} />,
        },
        { state: 'no build here', node: <AgentInstall name="Google Antigravity" brand={Brand.Antigravity} noBuild /> },
        { state: 'installed by hand', node: <AgentInstall name="Grok Build" brand={Brand.XAI} onHelp={fn()} onCheck={fn()} /> },
        {
          state: 'checking again',
          node: <AgentInstall name="Grok Build" brand={Brand.XAI} onHelp={fn()} onCheck={fn()} checking />,
        },
      ]}
    />
  ),
}
