import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { HomeWelcome, type WelcomeNeed, type HomeWelcomeProps } from './HomeWelcome'

/* runner-1, a Linux server with no projects yet: Claude Code signed in there, Codex signed out, GitHub connected. */

const NEEDS: readonly WelcomeNeed[] = [
  { id: 'claude-code', name: 'Claude Code', brand: Brand.Anthropic, state: 'ready', note: '2.1.3' },
  { id: 'codex', name: 'Codex', brand: Brand.OpenAI, state: 'signedOut', command: 'codex login --device-auth' },
  { id: 'git', name: 'git', icon: 'branch', state: 'ready', note: '2.43.0' },
  { id: 'github', name: 'GitHub', brand: Brand.GitHub, state: 'ready', note: 'as balazs' },
]

const ARGS: HomeWelcomeProps = {
  name: 'runner-1',
  at: 'althar@runner-1',
  machine: { system: 'Ubuntu 24.04.1 LTS', cores: 8, memory: 32 * 1024 ** 3, disk: { free: 212e9, size: 512e9 } },
  git: '2.43.0',
  needs: NEEDS,
  repositories: [
    { id: 'repo_althar', ink: ProjectInk.Teal },
    { id: 'repo_site', ink: ProjectInk.Clay },
    { id: 'repo_mobile', ink: ProjectInk.Ochre },
    { id: 'repo_docs', ink: ProjectInk.Moss },
    { id: 'repo_infra', ink: ProjectInk.Sand },
  ],
  found: ['~/code/legacy-billing', '~/code/dotfiles', '~/projects/scratch'],
  onDoor: fn(),
  onPaste: fn((text: string) => text.startsWith('https://github.com/')),
  toured: false,
  onToured: fn(),
  onCopy: fn(),
  onGuide: fn(),
}

const meta = {
  title: 'Screens/HomeWelcome',
  component: HomeWelcome,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 600 }}>{Story()}</div>],
  args: ARGS,
} satisfies Meta<typeof HomeWelcome>

export default meta
type Story = StoryObj<typeof meta>

/** The tour's first page: what runner-1 is. */
export const Tour: Story = {}

/** Still asking the home what it is: the figures hold their places. */
export const Asking: Story = { args: { machine: null, git: undefined, needs: null } }

/** The second page: what work there has, with the one press each that isn't ready takes. */
export const WhatItHas: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await userEvent.click(await page.findByRole('button', { name: 'Next' }))
    await expect(await page.findByRole('heading', { name: 'What runner-1 has' })).toBeVisible()
    await expect(page.getByRole('status')).toHaveTextContent('Page 2 of 3: What runner-1 has')
  },
}

/** The card opened into the window: the arrival, with the ways in; focus is on its title. */
export const Opened: Story = {
  play: async ({ canvasElement, args }) => {
    const page = within(canvasElement)
    await userEvent.click(await page.findByRole('button', { name: 'Skip the tour' }))
    const title = await page.findByRole('heading', { name: 'Welcome to runner-1' })
    await waitFor(() => expect(title).toHaveFocus())
    await expect(args.onToured).toHaveBeenCalledOnce()
    await userEvent.click(page.getByRole('button', { name: /Clone a repository/ }))
    await expect(args.onDoor).toHaveBeenCalledWith('clone', expect.anything())
  },
}

/** Every visit after the first: the arrival alone. */
export const Arrival: Story = { args: { toured: true } }

/** A home with no code host connected, nothing found on its disk, and no agent signed in: two ways in, and what to do. */
export const Bare: Story = {
  args: {
    toured: true,
    repositories: [],
    found: [],
    needs: [
      { id: 'claude-code', name: 'Claude Code', brand: Brand.Anthropic, state: 'signedOut', command: 'claude /login' },
      { id: 'codex', name: 'Codex', brand: Brand.OpenAI, state: 'missing', guide: 'https://developers.openai.com/codex/cli' },
      { id: 'git', name: 'git', icon: 'branch', state: 'ready', note: '2.43.0' },
    ],
  },
}

/** A long name, in the app's narrowest window. */
export const Narrow: Story = {
  args: { name: 'build-server-eu-west-2', at: 'althar@build-server-eu-west-2.internal', toured: true },
  decorators: [(Story) => <div style={{ display: 'flex', flexDirection: 'column', width: 600, height: 640 }}>{Story()}</div>],
}
