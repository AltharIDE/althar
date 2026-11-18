import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CLONE_HOSTS, CLONE_REPOSITORIES } from '../../fixtures/setup'
import { RepositoryClone, type RepositoryCloneProps } from './RepositoryClone'

/* As a consumer keeps it: what is typed, and the one chosen. */
function Choosing(props: RepositoryCloneProps) {
  const [query, setQuery] = useState(props.query)
  const [chosen, setChosen] = useState(props.chosen)
  return (
    <div style={{ maxWidth: 936 }}>
      <RepositoryClone
        {...props}
        query={query}
        onQuery={(next) => {
          props.onQuery(next)
          setQuery(next)
        }}
        chosen={chosen}
        onChoose={(id) => {
          props.onChoose(id)
          setChosen(id)
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Setup/RepositoryClone',
  component: RepositoryClone,
  render: (args) => <Choosing {...args} />,
  decorators: [(Story) => <div style={{ background: 'var(--n-1)', padding: 24 }}>{Story()}</div>],
  args: {
    hosts: CLONE_HOSTS,
    repositories: CLONE_REPOSITORIES,
    query: '',
    onQuery: fn(),
    chosen: null,
    onChoose: fn(),
    onConnect: fn(),
    where: '~/code',
    onWhere: fn(),
    onClone: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof RepositoryClone>
export default meta
type Story = StoryObj<typeof meta>

/** Your repositories on GitHub, none chosen yet: Clone waits for one. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('button', { name: 'Clone' })).toBeDisabled()
    // Nothing says where until one is chosen.
    await expect(page.queryByText(/^~\/code\//)).toBeNull()
  },
}

/** One chosen, found by typing, and cloned into the usual place. */
export const Chosen: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement)
    await userEvent.type(page.getByRole('searchbox'), 'mobile')
    await userEvent.click(page.getByRole('button', { name: 'Clone meridian/meridian-mobile' }))
    // Where it lands, on its row, in place of when it was pushed.
    await expect(page.getByText('~/code/meridian-mobile')).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Clone' }))
    await expect(args.onClone).toHaveBeenCalledOnce()
  },
}

/** Where it goes, changed from beside Clone: the person is asked. */
export const ChangingWhere: Story = {
  args: { chosen: 'gh:meridian/web' },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Choose where it goes' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Another folder…' }))
    await expect(args.onWhere).toHaveBeenCalledOnce()
  },
}

/** Nowhere usual yet: the person chooses where it goes. */
export const NowhereUsual: Story = {
  args: { where: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Choose where it goes' })).toBeVisible()
  },
}

/** One on this computer already: added from where it is, not cloned again. */
export const OnThisComputer: Story = {
  args: { chosen: 'gh:meridian/design-tokens' },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('button', { name: 'Add' })).toBeEnabled()
    await expect(page.queryByRole('button', { name: 'Choose where it goes' })).toBeNull()
  },
}

/** A URL pasted names one: shown alone. */
export const Pasted: Story = {
  args: {
    query: 'https://gitlab.com/someone/elsewhere.git',
    pasted: {
      id: 'url:https://gitlab.com/someone/elsewhere.git',
      host: '',
      owner: 'someone',
      name: 'elsewhere',
      description: null,
      private: false,
      pushed: null,
      like: false,
      here: null,
    },
    chosen: 'url:https://gitlab.com/someone/elsewhere.git',
  },
}

/** No host connected yet: a URL pasted, or a host connected first. */
export const NoHostConnected: Story = {
  args: { hosts: CLONE_HOSTS.map((host) => ({ ...host, connected: false })), repositories: [] },
}

/** Still reading them. */
export const Reading: Story = { args: { repositories: null } }

/** The same at night, one chosen. */
export const Dark: Story = { args: { chosen: 'gh:meridian/web' }, globals: { theme: 'dark' } }
