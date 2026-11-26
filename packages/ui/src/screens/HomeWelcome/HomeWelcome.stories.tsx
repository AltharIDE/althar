import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'

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
  onSignIn: fn(),
  onUpdate: fn(),
  onCheckAgain: fn(),
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

/** Where it couldn't look on the home's disk: the folder door stays, saying so. */
export const LookFailed: Story = { args: { toured: true, found: 'failed' } }

const UPDATE = 'sh "${XDG_DATA_HOME:-$HOME/.local/share}/althar-host-program/launcher" update --apply --wait'
const OLDER: Partial<HomeWelcomeProps> = { toured: false, machine: null, git: undefined, repositories: [], found: null }

/** A home from before windows made projects there, over SSH: one press updates it, in place of the ways in, and no tour. */
export const Older: Story = {
  args: { ...OLDER, update: { command: UPDATE, installed: 'known', run: { state: 'idle' } } },
}

/** Tasks running on the home: pressed, it asks first, since the restart stops them. */
export const OlderBusy: Story = {
  args: { ...OLDER, update: { command: UPDATE, installed: 'known', run: { state: 'idle', busy: 2 } } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await fireEvent.click(await page.findByRole('button', { name: 'Update runner-1' }))
    await expect(await page.findByText('Stop 2 running tasks?')).toBeVisible()
  },
}

/** It couldn't, after the home dropped the window's connection: Reconnect beside Try again. */
export const OlderFailedOffline: Story = {
  args: {
    ...OLDER,
    update: { command: UPDATE, installed: 'known', run: { state: 'failed', problem: 'The new host did not become ready.', offline: true } },
  },
}

/** Under way: the release coming down, where the press was. */
export const OlderUpdating: Story = {
  args: { ...OLDER, update: { command: UPDATE, installed: 'known', run: { state: 'running', step: 'getting' } } },
}

/** The home restarting into it: the window's connection drops meanwhile, and the panel says so. */
export const OlderRestarting: Story = {
  args: { ...OLDER, update: { command: UPDATE, installed: 'known', run: { state: 'running', step: 'restarting' } } },
}

/** It couldn't: why, Try again, and the command to run there by hand, folded away. */
export const OlderFailed: Story = {
  args: {
    ...OLDER,
    update: {
      command: UPDATE,
      installed: 'known',
      run: { state: 'failed', problem: 'No verified host release is staged. Check the home’s network and try again.' },
    },
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    // Opened as a pointer would, not a key: no focus ring left on it.
    await fireEvent.click(await page.findByRole('button', { name: 'Update it on runner-1 yourself' }))
    await expect(await page.findByRole('button', { name: 'Copy the update command' })).toBeVisible()
  },
}

/** The newest release moves the home's data to a new format: asked once, in place, before anything runs. */
export const OlderMovesData: Story = {
  args: { ...OLDER, update: { command: UPDATE, installed: 'known', run: { state: 'confirm', from: '0.1.0', to: '0.2.0' } } },
  play: async ({ canvasElement, args }) => {
    const page = within(canvasElement)
    await expect(await page.findByText('Update runner-1 to 0.2.0?')).toBeVisible()
    await fireEvent.click(page.getByRole('button', { name: 'Update' }))
    await expect(args.onUpdate).toHaveBeenCalledOnce()
  },
}

/** The same, with tasks running there: one question says both. */
export const OlderMovesDataBusy: Story = {
  args: { ...OLDER, update: { command: UPDATE, installed: 'known', run: { state: 'confirm', from: '0.1.0', to: '0.2.0', busy: 2 } } },
}

/** The newest release speaks an API this app doesn't: not run, and what to do instead. */
export const OlderNewerApi: Story = {
  args: {
    ...OLDER,
    update: {
      command: UPDATE,
      installed: 'known',
      run: { state: 'failed', problem: 'Althar 0.3.0 for runner-1 needs a newer Althar app. Update this app first, then runner-1.' },
    },
  },
}

/** No published release makes projects from a window yet: said in place of the update, with Check again. */
export const OlderNoRelease: Story = {
  args: { ...OLDER, update: { command: UPDATE, installed: 'known', release: 'unreleased' } },
  play: async ({ canvasElement, args }) => {
    const page = within(canvasElement)
    await expect(await page.findByText('No newer release yet')).toBeVisible()
    await expect(page.queryByRole('button', { name: 'Update runner-1' })).toBeNull()
    await expect(page.queryByRole('button', { name: 'How to update it' })).toBeNull()
    await fireEvent.click(page.getByRole('button', { name: 'Check again' }))
    await expect(args.onCheckAgain).toHaveBeenCalledOnce()
  },
}

/** While the newest release is looked for, before anything is offered. */
export const OlderChecking: Story = {
  args: { ...OLDER, update: { command: UPDATE, installed: 'known', release: 'checking' } },
}

/** A download that failed, said in a line: what failed, where the home's updater says. */
export const OlderDownloadFailed: Story = {
  args: {
    ...OLDER,
    update: { command: UPDATE, installed: 'known', run: { state: 'failed', problem: 'runner-1’s DNS didn’t answer for api.github.com.' } },
  },
}

/** An older home paired over HTTPS: the window can't run it, so Check again once it's updated there, and the command folded away. */
export const OlderPaired: Story = {
  args: { ...OLDER, update: { command: UPDATE, installed: 'unknown' } },
}

/** A long name, in the app's narrowest window. */
export const Narrow: Story = {
  args: { name: 'build-server-eu-west-2', at: 'althar@build-server-eu-west-2.internal', toured: true },
  decorators: [(Story) => <div style={{ display: 'flex', flexDirection: 'column', width: 600, height: 640 }}>{Story()}</div>],
}
