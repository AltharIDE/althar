import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fireEvent, fn, userEvent, within } from 'storybook/test'

import { FIRST_RUN, NONE_READY } from '../../fixtures/setup'
import { Brand } from '../../foundations/brands/brands'
import { RuntimeState } from '../../foundations/vocabulary'
import { CrashReportsLine, SkillsLine } from '../../setup/Preferences/Preferences'
import { States } from '../../storybook/States'
import type { RuntimeEntry } from '../../setup/Runtimes/Runtimes'
import { Start, type StartProps, type StartRepository } from './Start'

/* The repositories a first run finds where people keep code, most recently worked on first. */
const FOUND: StartRepository[] = [
  { id: 'meridian', name: 'meridian', where: '~/Projects/meridian', facts: 'main · 2 h ago' },
  { id: 'meridian-web', name: 'meridian-web', where: '~/Projects/meridian-web', facts: 'checkout-v2 · yesterday' },
  { id: 'halyard', name: 'halyard', where: '~/Developer/halyard', facts: 'main · 3 days ago' },
  { id: 'infra', name: 'infra', where: '~/Projects/infra', facts: 'main · last week' },
  { id: 'dotfiles', name: 'dotfiles', where: '~/code/dotfiles', facts: 'main · in August' },
]
const LOOKED_IN = '~/Projects, ~/Developer, ~/code'

const onCreate = fn()
const onPick = fn()

/* As a consumer keeps it: what is ticked, and the name, from the first one until it is given. */
function Picking(props: Partial<StartProps>) {
  const [picked, setPicked] = useState<readonly string[]>(props.picked ?? [])
  const [name, setName] = useState<string | null>(null)
  return (
    <Start
      runtimes={FIRST_RUN}
      repositories={FOUND}
      lookedIn={LOOKED_IN}
      onAdd={fn()}
      onDrop={fn()}
      onSignIn={fn()}
      onInstall={fn()}
      onCreate={onCreate}
      {...props}
      picked={picked}
      onPick={(id) => {
        onPick(id)
        setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))
      }}
      name={name ?? FOUND.find((r) => r.id === picked[0])?.name ?? ''}
      onNameChange={setName}
    />
  )
}

/* As the app gives it: crash reports' line at the sheet's foot, on until turned off, and agent skills', off until turned on. */
function Asking(props: StartProps) {
  const [on, setOn] = useState(true)
  const [skills, setSkills] = useState(false)
  return (
    <Start
      {...props}
      foot={
        <>
          <SkillsLine on={skills} onChange={setSkills} />
          <CrashReportsLine on={on} onChange={setOn} />
        </>
      }
    />
  )
}

const meta = {
  title: 'Screens/Start',
  component: Start,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ height: '100vh', minHeight: 640 }}>{Story()}</div>],
  args: {
    runtimes: FIRST_RUN,
    repositories: FOUND,
    lookedIn: LOOKED_IN,
    picked: [],
    onPick: fn(),
    onAdd: fn(),
    onDrop: fn(),
    name: '',
    onNameChange: fn(),
    onCreate: fn(),
    onSignIn: fn(),
    onInstall: fn(),
    onHelp: fn(),
  },
} satisfies Meta<typeof Start>
export default meta
type Story = StoryObj<typeof meta>

/** As the window opens: the agents being asked and the usual places looked in. */
export const Looking: Story = { args: { runtimes: null, repositories: null } }

/** Every agent answered and the repositories found: round the mark, the ones on this Mac; on the sheet, every one. */
export const Found: Story = {}

/** Ticking repositories makes the project under the mark, named after the first, and makes it. */
export const Forming: Story = {
  render: () => <Picking />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('checkbox', { name: /meridian-web/ }))
    await userEvent.click(c.getByRole('checkbox', { name: /halyard/ }))
    const name = c.getByRole('textbox', { name: 'Project name' })
    await expect(name).toHaveValue('meridian-web')
    await userEvent.click(c.getByRole('button', { name: 'Leave meridian-web out' }))
    await expect(name).toHaveValue('halyard')
    await userEvent.clear(name)
    await userEvent.type(name, 'Halyard')
    await userEvent.click(c.getByRole('button', { name: /Make the project/ }))
    await expect(onCreate).toHaveBeenCalled()
  },
}

/** A folder held over the window: the mark rises to meet it and the sheet steps back. Letting go hands the folders on. */
export const Dropping: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    // Anywhere on the screen: over its heading, here.
    const page = c.getByRole('heading', { level: 1 })
    const file = new File([''], 'harbor')
    const dataTransfer = { types: ['Files'], files: [file] }
    await fireEvent.dragEnter(page, { dataTransfer })
    await expect(c.getByRole('heading', { level: 1 })).toHaveTextContent('Let go to add it')
    await fireEvent.drop(page, { dataTransfer })
    await expect(args.onDrop).toHaveBeenCalledWith([file])
    await expect(c.getByRole('heading', { level: 1 })).toHaveTextContent('Where should they work?')
  },
}

/** Nothing found in the usual places: Add a folder is the way. */
export const NoneFound: Story = {
  args: { repositories: [] },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { level: 1 })).toHaveTextContent('Where is your code?')
    await userEvent.click(c.getByRole('button', { name: /Add a folder/ }))
    await expect(args.onAdd).toHaveBeenCalled()
  },
}

/** Crash reports asked once, at the sheet's foot: one quiet line with its switch, never a step to finish. */
export const CrashReportsAsked: Story = {
  render: (args) => <Asking {...args} />,
  play: async ({ canvasElement }) => {
    const crashes = within(canvasElement).getByRole('switch', { name: 'Crash reports' })
    await expect(crashes).toBeChecked()
    await userEvent.click(crashes)
    await expect(crashes).not.toBeChecked()
    // Making the project never waits on it.
    await expect(within(canvasElement).getByRole('heading', { level: 1 })).toHaveTextContent('Where should they work?')
  },
}

/** Agent skills asked once, at the sheet's foot beside crash reports: off until turned on, and Settings named as where to choose them. */
export const SkillsAsked: Story = {
  render: (args) => <Asking {...args} />,
  play: async ({ canvasElement }) => {
    const skills = within(canvasElement).getByRole('switch', { name: 'Agent skills' })
    await expect(skills).not.toBeChecked()
    await expect(skills).toHaveAccessibleDescription(/in Settings, under Skills/)
    await userEvent.click(skills)
    await expect(skills).toBeChecked()
  },
}

/** No agent ready: a project can still be made, and says so. */
export const NoneReady: Story = { args: { runtimes: NONE_READY } }

/* Every agent Althar runs on a first run: two on this Mac, three it can fetch, and five only their own installers put there. */
const EVERY_AGENT: RuntimeEntry[] = [
  ...FIRST_RUN.slice(0, 2),
  { id: 'opencode', name: 'OpenCode', brand: Brand.OpenCode, state: RuntimeState.Missing, download: '45 MB' },
  { id: 'copilot', name: 'GitHub Copilot', brand: Brand.GitHubCopilot, state: RuntimeState.Missing, download: '110 MB' },
  { id: 'junie', name: 'Junie', brand: Brand.Junie, state: RuntimeState.Missing },
  { id: 'grok', name: 'Grok Build', brand: Brand.XAI, state: RuntimeState.Missing },
  { id: 'kimi', name: 'Kimi Code', brand: Brand.Moonshot, state: RuntimeState.Missing },
  { id: 'mistral-vibe', name: 'Mistral Vibe', brand: Brand.Mistral, state: RuntimeState.Missing },
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

/** Every agent Althar runs: those on this Mac first, a row each; the rest under them, quieter, a tile each, those it can fetch first. */
export const ManyAgents: Story = {
  args: { runtimes: EVERY_AGENT },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(within(canvas.getByRole('list', { name: 'Agents on this Mac' })).getAllByRole('listitem')).toHaveLength(2)
    await expect(canvas.getByText('1 of 2 ready')).toBeVisible()
    const away = canvas.getByRole('list', { name: 'Agents not on this Mac' })
    await expect(
      within(away)
        .getAllByRole('listitem')
        .map((item) => item.textContent?.replace(/(\d+ MB|How to install).*$/, '')),
    ).toEqual(['OpenCode', 'GitHub Copilot', 'Google Antigravity', 'Junie', 'Grok Build', 'Kimi Code', 'Mistral Vibe', 'Qwen Code'])
    // No long notes: where a download comes from is its button's tooltip.
    await expect(canvas.queryByText(/latest release from GitHub/)).toBeNull()
    await userEvent.click(within(away).getByRole('button', { name: 'Download Google Antigravity, 115 MB' }))
    await expect(args.onInstall).toHaveBeenCalledWith('antigravity')
    await userEvent.click(within(away).getByRole('button', { name: 'How to install Junie' }))
    await expect(args.onHelp).toHaveBeenCalledWith('junie')
    // Back at rest, as the screen opens.
    ;(document.activeElement as HTMLElement | null)?.blur()
  },
}

/** More agents to come: the tiles take them two to a line, and the rows on this Mac and the repositories stay where they are. */
export const ManyMoreToCome: Story = {
  args: {
    runtimes: [
      ...EVERY_AGENT,
      ...['Cursor', 'Devin', 'Factory Droid', 'Auggie', 'Gemini CLI', 'Amp', 'Goose', 'Cline', 'Kiro', 'Aider'].map(
        (name): RuntimeEntry => ({
          id: name.toLowerCase().replace(/\s+/g, '-'),
          name,
          ...(name === 'Cursor' ? { brand: Brand.Cursor } : name === 'Gemini CLI' ? { brand: Brand.GeminiCli } : {}),
          state: RuntimeState.Missing,
        }),
      ),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(within(canvas.getByRole('list', { name: 'Agents not on this Mac' })).getAllByRole('listitem')).toHaveLength(18)
    await expect(canvas.getByRole('heading', { name: /Repositories/ })).toBeVisible()
  },
}

/** Downloading one, and one whose download didn't finish: said in its tile, with a way to try again. */
export const Downloading: Story = {
  args: {
    runtimes: [
      ...FIRST_RUN.slice(0, 2),
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
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('Downloading, 45 MB…')
    await expect(canvas.getByRole('alert')).toHaveTextContent('GitHub couldn’t be reached to find GitHub Copilot.')
    await expect(canvas.getByRole('button', { name: 'Try again to download GitHub Copilot, 110 MB' })).toBeVisible()
  },
}

/** None on this Mac yet: said where the rows would be, and every agent offered under it. */
export const NoneHere: Story = {
  args: { runtimes: EVERY_AGENT.slice(2) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('None is on this Mac yet. Download one below, or install one yourself.')).toBeVisible()
    await expect(canvas.queryByRole('list', { name: 'Agents on this Mac' })).toBeNull()
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'looking', node: <Start {...args} runtimes={null} repositories={null} /> },
        { state: 'found', node: <Start {...args} /> },
        {
          state: 'forming',
          node: <Start {...args} picked={['meridian', 'infra']} name="meridian" />,
        },
        {
          state: 'making it',
          node: <Start {...args} picked={['meridian']} name="meridian" creating />,
        },
        {
          state: 'couldn’t make it',
          node: <Start {...args} picked={['meridian']} name="meridian" error="Althar couldn’t open meridian." />,
        },
        { state: 'none found', node: <Start {...args} repositories={[]} /> },
        { state: 'none ready', node: <Start {...args} runtimes={NONE_READY} /> },
        {
          state: 'one downloading',
          node: (
            <Start
              {...args}
              runtimes={[
                ...NONE_READY.slice(0, 1),
                { id: 'opencode', name: 'OpenCode', state: RuntimeState.Installing, download: '45 MB' },
              ]}
            />
          ),
        },
        {
          state: 'narrow',
          node: (
            <div style={{ width: 420, height: 900 }}>
              <Start {...args} picked={['meridian']} name="meridian" />
            </div>
          ),
        },
      ].map((cell) => ({ ...cell, node: <div style={{ height: 720 }}>{cell.node}</div> }))}
    />
  ),
}
