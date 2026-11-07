import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { type FolderSetup, RepositorySetups, type RepositorySetupsProps, type SetupRepository } from './RepositorySetups'

const ALTHAR: SetupRepository = {
  id: 'r1',
  name: 'althar',
  checkout: '~/Projects/charrette-project/althar',
  setup: {
    by: 'agent',
    copy: ['.env', 'apps/desktop/.env.local'],
    commands: ['bun install --frozen-lockfile', 'bunx electron --version', 'bunx playwright install chromium'],
  },
}

const MERIDIAN: ReadonlyArray<SetupRepository> = [
  {
    id: 'm1',
    name: 'meridian-api',
    checkout: '~/code/meridian-api',
    setup: {
      by: 'agent',
      copy: ['.env', '.env.local', 'config/local.yml'],
      commands: ['pnpm install --frozen-lockfile', 'pnpm prisma generate'],
    },
  },
  { id: 'm2', name: 'meridian-web', checkout: '~/code/meridian-web', setup: null },
  { id: 'm3', name: 'meridian-infra', checkout: null, setup: { by: 'person', copy: [], commands: [] } },
]

/** Keeps what the person changes, as the settings do once the runtime says so. */
function Kept(props: RepositorySetupsProps) {
  const [repositories, setRepositories] = useState(props.repositories)
  const onChange = (id: string, setup: FolderSetup) => {
    props.onChange(id, setup)
    setRepositories((all) => all.map((one) => (one.id === id ? { ...one, setup: { ...setup, by: 'person' } } : one)))
  }
  const onClear = (id: string) => {
    props.onClear(id)
    setRepositories((all) => all.map((one) => (one.id === id ? { ...one, setup: null } : one)))
  }
  return <RepositorySetups {...props} repositories={repositories} onChange={onChange} onClear={onClear} />
}

const meta = {
  title: 'Setup/RepositorySetups',
  component: RepositorySetups,
  args: { repositories: [ALTHAR], onChange: fn(), onClear: fn() },
  render: (args) => (
    <div style={{ maxWidth: 820 }}>
      <Kept {...args} />
    </div>
  ),
} satisfies Meta<typeof RepositorySetups>

export default meta
type Story = StoryObj<typeof meta>

/** One repository: its commands, then the files copied from the checkout, each numbered and coloured. */
export const One: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('tab', { name: 'althar' })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('textbox', { name: 'althar: commands' })).toHaveValue(ALTHAR.setup?.commands.join('\n'))
    await expect(canvas.getByRole('textbox', { name: 'althar: files copied from your checkout' })).toHaveValue(
      '.env\napps/desktop/.env.local',
    )
  },
}

/** A tab each, the checkout of the one open at the end of the tabs; one not recorded yet, one that needs nothing, one with no checkout here. */
export const Several: Story = {
  args: { repositories: MERIDIAN },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('~/code/meridian-api')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('tab', { name: 'meridian-web' }))
    await expect(canvas.getByRole('textbox', { name: 'meridian-web: commands' })).toHaveAttribute(
      'placeholder',
      'None yet: the first task’s agent sets it.',
    )
    // The arrows move along the tabs.
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'meridian-infra' })).toHaveFocus()
    await expect(canvas.getByRole('textbox', { name: 'meridian-infra: commands' })).toHaveAttribute('placeholder', 'Needs nothing.')
    await expect(canvas.getByText('No checkout on this computer')).toBeInTheDocument()
  },
}

/** Typed in place and kept as the person leaves the lines, blank lines dropped; the files stay as they were. */
export const Changed: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const commands = canvas.getByRole('textbox', { name: 'althar: commands' })
    await userEvent.click(commands)
    await userEvent.type(commands, '{End}\n\nmake deps')
    await expect(args.onChange).not.toHaveBeenCalled()
    await userEvent.tab()
    await expect(args.onChange).toHaveBeenCalledOnce()
    await expect(args.onChange).toHaveBeenCalledWith('r1', {
      copy: ALTHAR.setup?.copy,
      commands: [...(ALTHAR.setup?.commands ?? []), 'make deps'],
    })
    // Left as it was, nothing is kept.
    await userEvent.click(commands)
    await userEvent.tab()
    await expect(args.onChange).toHaveBeenCalledOnce()
  },
}

/** Escape puts the lines back as they were, and keeps nothing. */
export const PutBack: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const files = canvas.getByRole('textbox', { name: 'althar: files copied from your checkout' })
    await userEvent.click(files)
    await userEvent.clear(files)
    await userEvent.keyboard('{Escape}')
    await expect(files).toHaveValue('.env\napps/desktop/.env.local')
    await expect(args.onChange).not.toHaveBeenCalled()
  },
}

/** A change that didn't hold says why under the card. */
export const Refused: Story = {
  args: { error: 'Name each file from the repository’s root, inside it and not in .git, and give at most 20 commands.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('inside it and not in .git')
  },
}

const NONE: SetupRepository = { id: 'r0', name: 'althar', checkout: '~/Projects/althar', setup: null }
const SAID = 'New tasks use this; worktrees already made keep what they have.'

/** Nothing kept yet: the first task's agent sets it. There is nothing to clear. */
export const None: Story = {
  args: { repositories: [NONE] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: 'althar: commands' })).toHaveAttribute(
      'placeholder',
      'None yet: the first task’s agent sets it.',
    )
    await expect(canvas.getByText(SAID)).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /Clear/ })).toBeNull()
  },
}

/** What an agent recorded: said so, and it can be cleared. */
export const AgentSet: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Set by an agent\./)).toBeInTheDocument()
    await expect(canvas.getByText(new RegExp(SAID))).toBeInTheDocument()
  },
}

/** What the person edited: theirs, so an agent asks before replacing it. */
export const PersonEdited: Story = {
  args: { repositories: [{ ...ALTHAR, setup: { by: 'person', copy: ['.env'], commands: ['make deps'] } }] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Edited by you\. An agent asks before replacing it\./)).toBeInTheDocument()
  },
}

/** Editing: a line typed in place becomes the person's once they leave it. */
export const Editing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const commands = canvas.getByRole('textbox', { name: 'althar: commands' })
    await userEvent.click(commands)
    await userEvent.type(commands, '{End}\nmake deps')
    await userEvent.tab()
    await expect(canvas.getByText(/Edited by you\./)).toBeInTheDocument()
  },
}

/** Clearing hands it back: nothing is kept, so an agent sets it again. */
export const Cleared: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Clear, so an agent sets it again' }))
    await expect(args.onClear).toHaveBeenCalledWith('r1')
    await expect(canvas.getByRole('textbox', { name: 'althar: commands' })).toHaveAttribute(
      'placeholder',
      'None yet: the first task’s agent sets it.',
    )
  },
}
