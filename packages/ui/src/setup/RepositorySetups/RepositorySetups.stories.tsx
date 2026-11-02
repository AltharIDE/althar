import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { type FolderSetup, RepositorySetups, type RepositorySetupsProps, type SetupRepository } from './RepositorySetups'

const ALTHAR: SetupRepository = {
  id: 'r1',
  name: 'althar',
  checkout: '~/Projects/charrette-project/althar',
  setup: {
    copy: ['.env', 'apps/desktop/.env.local'],
    commands: ['bun install --frozen-lockfile', 'bunx electron --version', 'bunx playwright install chromium'],
  },
}

const MERIDIAN: ReadonlyArray<SetupRepository> = [
  {
    id: 'm1',
    name: 'meridian-api',
    checkout: '~/code/meridian-api',
    setup: { copy: ['.env', '.env.local', 'config/local.yml'], commands: ['pnpm install --frozen-lockfile', 'pnpm prisma generate'] },
  },
  { id: 'm2', name: 'meridian-web', checkout: '~/code/meridian-web', setup: null },
  { id: 'm3', name: 'meridian-infra', checkout: null, setup: { copy: [], commands: [] } },
]

/** Keeps what the person changes, as the settings do once the runtime says so. */
function Kept(props: RepositorySetupsProps) {
  const [repositories, setRepositories] = useState(props.repositories)
  const onChange = (id: string, setup: FolderSetup) => {
    props.onChange(id, setup)
    setRepositories((all) => all.map((one) => (one.id === id ? { ...one, setup } : one)))
  }
  return <RepositorySetups {...props} repositories={repositories} onChange={onChange} />
}

const meta = {
  title: 'Setup/RepositorySetups',
  component: RepositorySetups,
  args: { repositories: [ALTHAR], onChange: fn() },
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
      'The first task’s lead fills this in.',
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
