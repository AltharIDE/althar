import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { FIRST_RUN, NONE_READY } from '../../fixtures/setup'
import { Brand } from '../../foundations/brands/brands'
import { RuntimeState } from '../../foundations/vocabulary'
import { Connections, type ServiceConnection, type ServiceOption } from '../../setup/Connections/Connections'
import { CrashReportsLine } from '../../setup/Preferences/Preferences'
import type { RepositoryChoice } from '../../setup/RepositoryPick/RepositoryPick'
import type { RuntimeEntry } from '../../setup/Runtimes/Runtimes'
import { Welcome, type WelcomeProps, type WelcomeStep } from './Welcome'

/* The repositories a first run finds where people keep code, most recently worked on first. */
const FOUND: RepositoryChoice[] = [
  { id: 'meridian', name: 'meridian', where: '~/Projects/meridian', facts: 'main · 2 h ago' },
  { id: 'meridian-web', name: 'meridian-web', where: '~/Projects/meridian-web', facts: 'checkout-v2 · yesterday' },
  { id: 'dotfiles', name: 'dotfiles', where: '~/code/dotfiles', facts: 'main · in August' },
]

const HOSTS: ServiceOption[] = [
  { id: 'github', name: 'GitHub', brand: Brand.GitHub, what: 'meridian’s code is here' },
  { id: 'gitlab', name: 'GitLab', brand: Brand.GitLab, what: 'Pull requests', selfHosted: true },
  { id: 'bitbucket', name: 'Bitbucket', brand: Brand.Bitbucket, what: 'Pull requests' },
]
const TRACKERS: ServiceOption[] = [
  { id: 'linear', name: 'Linear', brand: Brand.Linear, what: 'Issues', workspaces: true },
  { id: 'jira', name: 'Jira', brand: Brand.Jira, what: 'Issues', selfHosted: true },
  { id: 'trello', name: 'Trello', brand: Brand.Trello, what: 'Issues' },
]
const GITHUB_YOU: ServiceConnection = { id: 'conn1', service: 'github', account: 'you' }

/* Every agent Althar runs on a first run: two on this computer, two it can fetch, and two only their own installers put there. */
const EVERY_AGENT = [
  ...FIRST_RUN.slice(0, 2),
  { id: 'opencode', name: 'OpenCode', brand: Brand.OpenCode, state: RuntimeState.Missing, download: '45 MB' },
  { id: 'copilot', name: 'GitHub Copilot', brand: Brand.GitHubCopilot, state: RuntimeState.Installing, download: '110 MB' },
  { id: 'junie', name: 'Junie', brand: Brand.Junie, state: RuntimeState.Missing },
  { id: 'kimi', name: 'Kimi Code', brand: Brand.Moonshot, state: RuntimeState.Missing },
] satisfies RuntimeEntry[]

/* The agents a person who codes with agents already pays for: each signed in on its own plan, and one more Althar can fetch. */
const SIGNED_IN = [
  { ...FIRST_RUN[0]! },
  { ...FIRST_RUN[1]!, state: RuntimeState.Ready, account: 'you@meridian.dev · Pro', version: '0.52.0' },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    brand: Brand.GitHubCopilot,
    state: RuntimeState.Ready,
    account: 'meridian-dev · Pro+',
    version: '1.4.2',
  },
  { id: 'opencode', name: 'OpenCode', brand: Brand.OpenCode, state: RuntimeState.Ready, account: 'Go', version: '1.0.84' },
  { id: 'junie', name: 'Junie', brand: Brand.Junie, state: RuntimeState.Missing },
  { id: 'kimi', name: 'Kimi Code', brand: Brand.Moonshot, state: RuntimeState.Missing, download: '38 MB' },
] satisfies RuntimeEntry[]

const onCreate = fn()
const onOpen = fn()
const onToured = fn()
const onConnect = fn()

/* The code hosts or the trackers, as the app lists them: the kit's list of services, each to connect. */
const list = (label: string, services: readonly ServiceOption[], connections: readonly ServiceConnection[] = []) => (
  <Connections label={label} services={services} connections={connections} onConnect={onConnect} onSignInAgain={fn()} onDisconnect={fn()} />
)

/* As a consumer keeps it: the step, what is ticked, the name from the first one until it is given, and the project once made. */
function FirstRun(props: Partial<WelcomeProps>) {
  const [step, setStep] = useState<WelcomeStep>(props.defaultStep ?? (props.toured === true ? 'agents' : 'projects'))
  const [picked, setPicked] = useState<readonly string[]>(props.picked ?? [])
  const [name, setName] = useState<string | null>(null)
  const [made, setMade] = useState(props.made ?? false)
  const [crashReports, setCrashReports] = useState(true)
  return (
    <Welcome
      runtimes={FIRST_RUN}
      repositories={FOUND}
      hosts={list('Code hosts', HOSTS)}
      trackers={list('Trackers', TRACKERS)}
      onSignIn={fn()}
      onInstall={fn()}
      onAdd={fn()}
      onDrop={fn()}
      onToured={onToured}
      onOpen={onOpen}
      foot={<CrashReportsLine on={crashReports} onChange={setCrashReports} />}
      {...props}
      step={step}
      onStepChange={setStep}
      picked={picked}
      onPick={(id) => setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))}
      name={name ?? FOUND.find((r) => r.id === picked[0])?.name ?? ''}
      onNameChange={setName}
      made={made}
      onCreate={() => {
        onCreate()
        setMade(true)
      }}
    />
  )
}

const meta = {
  title: 'Screens/Welcome',
  component: Welcome,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ height: '100vh', minHeight: 680 }}>{Story()}</div>],
  render: (args) => <FirstRun {...args} />,
  args: {
    runtimes: FIRST_RUN,
    repositories: FOUND,
    picked: [],
    onPick: fn(),
    onAdd: fn(),
    name: '',
    onNameChange: fn(),
    onCreate,
    hosts: null,
    trackers: null,
    onOpen,
  },
} satisfies Meta<typeof Welcome>
export default meta
type Story = StoryObj<typeof meta>

/** The tour's first page: a project, its repositories wired into it, and its tasks out of it, each on a branch of its own. */
export const Projects: Story = {}

/** The coordinator plans what was asked into a task, and its lead works through the steps. */
export const Coordinator: Story = { args: { defaultStep: 'coordinator' } }

/** Every agent Althar runs, a mark each under the line, and one task's steps across two makers: one leads, another's reviews. */
export const Makers: Story = {
  args: { defaultStep: 'makers', runtimes: EVERY_AGENT },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(within(c.getByRole('list', { name: 'The agents Althar runs' })).getAllByRole('img')).toHaveLength(EVERY_AGENT.length)
  },
}

/** Another maker's agent reviews the change; the lead fixes one finding and sets one aside; the pull request carries the review. */
export const Review: Story = { args: { defaultStep: 'review' } }

/** A page as it ends, with no motion: what reduced motion shows. */
export const Still: Story = { args: { defaultStep: 'review', still: true } }

/** Next walks the tour; Skip leaves it for the agents, and says the tour is over. */
export const Walking: Story = {
  args: { still: true },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Next' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(c.getByRole('heading', { name: 'Meet the coordinator' })).toBeVisible()
    await userEvent.keyboard('{ArrowRight}')
    await expect(c.getByRole('heading', { name: 'Agents from different makers' })).toBeVisible()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(c.getByRole('heading', { name: 'Meet the coordinator' })).toBeVisible()
    await userEvent.click(c.getByRole('button', { name: 'Skip' }))
    await expect(c.getByRole('heading', { name: 'Your agents' })).toBeVisible()
    await expect(onToured).toHaveBeenCalled()
    await expect(c.queryByRole('button', { name: 'Skip' })).toBeNull()
  },
}

/** The agents on this computer: one signed in, one signed out, one to download. One is enough to go on. */
export const Agents: Story = { args: { toured: true } }

/** The agents you already pay for, each signed in on its own plan: the README's picture of a first run. */
export const SignedIn: Story = { args: { toured: true, runtimes: SIGNED_IN } }

/** Every agent Althar runs: those on this computer a row each, the others under them, quieter, a tile each. */
export const EveryAgent: Story = {
  args: { toured: true, runtimes: EVERY_AGENT },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(within(c.getByRole('list', { name: /Agents on/ })).getAllByRole('listitem')).toHaveLength(2)
    await expect(within(c.getByRole('list', { name: /Agents not on/ })).getAllByRole('listitem')).toHaveLength(4)
  },
}

/** None on this computer yet: said where the rows would be, every agent offered under it, and going on is the lesser choice. */
export const NoneHere: Story = {
  args: { toured: true, runtimes: EVERY_AGENT.slice(2) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/None yet/)).toBeVisible()
    await expect(c.queryByRole('list', { name: /Agents on/ })).toBeNull()
    await expect(c.getByRole('button', { name: 'Continue without one' })).toBeVisible()
  },
}

/** None signed in yet: going on is the lesser choice, and the project can still be made. */
export const NoneReady: Story = { args: { toured: true, runtimes: NONE_READY } }

/** Still asking the agents. */
export const Asking: Story = { args: { toured: true, runtimes: null } }

/** One couldn't be checked: it says why on its own row. */
export const OneUnchecked: Story = {
  args: {
    toured: true,
    runtimes: [
      ...FIRST_RUN.slice(0, 2),
      {
        id: 'gemini-cli',
        name: 'Gemini CLI',
        brand: Brand.GeminiCli,
        state: RuntimeState.Unchecked,
        why: 'Gemini CLI didn’t answer in time.',
      },
    ],
    onCheck: fn(),
  },
}

/** The runtime didn't answer: not that none were found, so the agents' step says so where they would be, with the way to ask again. */
export const AgentsFailed: Story = {
  args: { toured: true, runtimes: [], error: { step: 'agents', said: 'Althar’s runtime didn’t answer.' }, onRecheck: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByText('None found.')).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Check again' }))
    await expect(args.onRecheck).toHaveBeenCalledOnce()
  },
}

/** The first project: Make the project with nothing ticked says what is missing; ticking one names the project after it, and makes it. */
export const Project: Story = {
  args: { toured: true, defaultStep: 'project' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('searchbox')).toHaveFocus()
    await userEvent.click(c.getByRole('button', { name: /Make the project/ }))
    await expect(c.getByRole('alert')).toHaveTextContent('Tick a repository, or choose a folder.')
    await expect(onCreate).not.toHaveBeenCalled()
    await userEvent.click(c.getByRole('checkbox', { name: /meridian-web/ }))
    await expect(c.queryByRole('alert')).toBeNull()
    await expect(c.getByRole('textbox', { name: 'Project name' })).toHaveValue('meridian-web')
    await userEvent.click(c.getByRole('button', { name: /Make the project/ }))
    await expect(onCreate).toHaveBeenCalled()
    await waitFor(() => expect(c.getByRole('heading', { name: 'Pull requests' })).toBeVisible())
    await expect(c.queryByRole('button', { name: 'Back' })).toBeNull()
  },
}

/** Making it. */
export const Creating: Story = { args: { toured: true, defaultStep: 'project', picked: ['meridian'], creating: true } }

/** It couldn't be made: the project's step says why. */
export const ProjectFailed: Story = {
  args: {
    toured: true,
    defaultStep: 'project',
    picked: ['meridian'],
    error: { step: 'project', said: '~/Projects/meridian is no longer there.' },
  },
}

/** Where its code is: the host its remote names says so; going on without one is the lesser choice. */
export const Code: Story = { args: { toured: true, defaultStep: 'code', picked: ['meridian'], made: true } }

/** GitHub connected: the step goes on with Continue. */
export const CodeConnected: Story = {
  args: {
    toured: true,
    defaultStep: 'code',
    picked: ['meridian'],
    made: true,
    hosts: list('Code hosts', HOSTS, [GITHUB_YOU]),
    hostConnected: true,
  },
}

/** A tracker, if they use one; the last step opens the project. */
export const Issues: Story = {
  args: { toured: true, defaultStep: 'issues', picked: ['meridian'], made: true },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Open meridian' }))
    await expect(onOpen).toHaveBeenCalled()
  },
}
