import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { States } from '../../storybook/States'
import { NewProject, type NewProjectFinding, type NewProjectFolder, type NewProjectFound, type NewProjectProps } from './NewProject'

/* Northwind, being added beside four projects: its folders as read, what this Mac has named like it, and what reading them found. */

const SEED = 'proj_0199c4d2a1b07c3e9f1a2b3c4d5e6f70'
const GITHUB = { name: 'GitHub', brand: Brand.GitHub }
const GITLAB = { name: 'GitLab', brand: Brand.GitLab }
const TAKEN = { [ProjectInk.Teal]: 'Meridian', [ProjectInk.Clay]: 'Halyard', [ProjectInk.Moss]: 'Tessera', [ProjectInk.Ochre]: 'Ferrous' }

const APP: NewProjectFolder = {
  id: 'app',
  name: 'northwind-app',
  where: '~/code/northwind/app',
  host: GITHUB,
  remote: 'northwind-co/app',
}
const API: NewProjectFolder = {
  id: 'api',
  name: 'northwind-api',
  where: '~/code/northwind/api',
  host: GITHUB,
  remote: 'northwind-co/api',
}
const OPS: NewProjectFolder = {
  id: 'ops',
  name: 'northwind-ops',
  where: '~/code/northwind/ops',
  host: GITLAB,
  remote: 'northwind/ops',
}
const LOCAL: NewProjectFolder = { id: 'notes', name: 'notes', where: '~/notes', host: null, remote: null }
const FRESH: NewProjectFolder = { id: 'fresh', fresh: true, name: 'northwind', where: '~/code/northwind' }

const FOUND: NewProjectFound = {
  like: 'Northwind',
  first: [
    { id: 'app', name: 'northwind-app', where: '~/code/northwind/app' },
    { id: 'api', name: 'northwind-api', where: '~/code/northwind/api' },
    { id: 'ops', name: 'northwind-ops', where: '~/code/northwind/ops' },
    { id: 'design', name: 'northwind-design-tokens', where: '~/code/northwind/design-tokens' },
  ],
  more: [
    { id: 'gateway', name: 'halyard-gateway', where: '~/code/halyard/gateway', in: 'Halyard' },
    { id: 'dotfiles', name: 'dotfiles', where: '~/dotfiles' },
  ],
}

const FINDINGS: readonly NewProjectFinding[] = [
  { id: 'github', kind: 'connected', host: GITHUB, owners: ['northwind-co'], account: 'balazs' },
  { id: 'gitlab', kind: 'unconnected', host: GITLAB, remote: 'northwind/ops', changes: 'merge requests' },
]

const ARGS = {
  seed: SEED,
  name: 'Northwind',
  ink: ProjectInk.Rose,
  taken: TAKEN,
  folders: [],
  found: FOUND,
  onNameChange: fn(),
  onInkChange: fn(),
  onRemove: fn(),
  onChoose: fn(),
  onStartFresh: fn(),
  onDrop: fn(),
  onAdd: fn(),
  onConnect: fn(),
  onCreate: fn(),
  onCancel: fn(),
} satisfies NewProjectProps

/* As a consumer keeps it: the name and the colour, and the folders added from what was found. */
function Forming(props: Partial<NewProjectProps>) {
  const [name, setName] = useState(props.name ?? '')
  const [ink, setInk] = useState(props.ink ?? ProjectInk.Rose)
  const [folders, setFolders] = useState<readonly NewProjectFolder[]>(props.folders ?? [])
  const byId: Record<string, NewProjectFolder> = { app: APP, api: API, ops: OPS }
  const left = (list: NewProjectFound['first']) => list.filter((one) => !folders.some((folder) => folder.id === one.id))
  return (
    <NewProject
      {...ARGS}
      {...props}
      name={name}
      onNameChange={setName}
      ink={ink}
      onInkChange={setInk}
      folders={folders}
      found={{ like: name.trim() === '' ? null : name.trim(), first: left(FOUND.first), more: left(FOUND.more) }}
      onAdd={(id) => {
        const folder = byId[id]
        if (folder !== undefined) setFolders((now) => [...now, folder])
      }}
      onRemove={(id) => setFolders((now) => now.filter((folder) => folder.id !== id))}
    />
  )
}

const meta = {
  title: 'Screens/NewProject',
  component: NewProject,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ height: '100vh', minHeight: 640 }}>{Story()}</div>],
  args: ARGS,
} satisfies Meta<typeof NewProject>
export default meta
type Story = StoryObj<typeof meta>

/** Named, with nothing added yet: its mark drawn, and what this Mac has named like it, each one press away. */
export const Named: Story = {}

/** Just opened: no name, so no mark yet, and what is found is offered as it is. */
export const Unnamed: Story = { args: { name: '', found: { like: null, first: FOUND.more, more: [] } } }

/** Still looking on this Mac: nothing offered yet. */
export const Looking: Story = { args: { found: null } }

/** One read, one being read: Create waits for it. */
export const Reading: Story = {
  args: { folders: [APP, { id: 'api', reading: true, name: 'northwind-api' }], found: { ...FOUND, first: FOUND.first.slice(2) } },
}

/** Three read, and what reading them found: the code host connected, and one that isn't. */
export const Read: Story = {
  args: { folders: [APP, API, OPS], findings: FINDINGS, found: { like: 'Northwind', first: FOUND.first.slice(3), more: FOUND.more } },
}

/** A folder without a remote, and one in another project already. */
export const LocalAndShared: Story = {
  args: {
    folders: [LOCAL, { id: 'gateway', name: 'halyard-gateway', where: '~/code/halyard/gateway', host: GITHUB, remote: 'halyard/gateway' }],
    findings: [
      { id: 'github', kind: 'connected', host: GITHUB, owners: ['halyard'], account: 'balazs' },
      { id: 'shared', kind: 'shared', name: 'halyard-gateway', project: 'Halyard' },
    ],
  },
}

/** Making it. */
export const Creating: Story = { args: { folders: [APP, API], creating: true } }

/** The runtime said no. */
export const Failed: Story = { args: { folders: [APP], error: 'Althar couldn’t read northwind-app any more.' } }

/** Named first, then a folder added from what was found, then made with ⌘↵; Create names it as it is typed. */
export const NamingThenAdding: Story = {
  args: { onCreate: fn() },
  render: (args) => <Forming onCreate={args.onCreate} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const name = c.getByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(name).toHaveFocus())
    await expect(c.getByRole('button', { name: /Create project/ })).toBeTruthy()
    await userEvent.type(name, 'Northwind')
    await expect(c.getByRole('heading', { level: 3 })).toHaveTextContent('On this Mac, named like Northwind')
    await userEvent.click(c.getByRole('button', { name: 'Add northwind-app' }))
    await expect(c.getByRole('list', { name: 'Its folders' })).toHaveTextContent('northwind-app')
    await userEvent.click(c.getByRole('radio', { name: 'Teal, Meridian’s' }))
    await expect(c.getByRole('radio', { name: 'Teal, Meridian’s' })).toBeChecked()
    await userEvent.click(c.getByRole('button', { name: 'Leave out northwind-app' }))
    await expect(c.queryByRole('list', { name: 'Its folders' })).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Add northwind-api' }))
    await userEvent.type(name, '{Meta>}{Enter}{/Meta}')
    await expect(args.onCreate).toHaveBeenCalledOnce()
  },
}

/** Added by keyboard, a repository's row goes, and focus goes to the next Add; left out, to the next row's, and then to Choose a folder. Escape still leaves. */
export const AddingByKeyboard: Story = {
  render: (args) => <Forming name="Northwind" onCancel={args.onCancel} />,
  args: { onCancel: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    c.getByRole('button', { name: 'Add northwind-app' }).focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(c.getByRole('button', { name: 'Add northwind-api' })).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(c.getByRole('button', { name: 'Add northwind-ops' })).toHaveFocus())
    c.getByRole('button', { name: 'Leave out northwind-app' }).focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(c.getByRole('button', { name: 'Leave out northwind-api' })).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(c.getByRole('button', { name: 'Choose a folder…' })).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await expect(args.onCancel).toHaveBeenCalledOnce()
  },
}

/** Starting from nothing: a new repository, named after the project, made as the project is. */
export const Fresh: Story = { args: { folders: [FRESH], found: { like: null, first: FOUND.more, more: [] } } }

/** A new repository beside a repository read. */
export const FreshBeside: Story = { args: { folders: [APP, FRESH], found: { ...FOUND, first: FOUND.first.slice(1) } } }

/** New repository, pressed before the project has a name: the name comes first, as the repository is named after it. */
export const FreshUnnamed: Story = {
  render: (args) => <Forming onStartFresh={args.onStartFresh} />,
  args: { onStartFresh: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'New repository…' }))
    await expect(c.getByRole('alert')).toHaveTextContent('Name the project first.')
    await expect(c.getByRole('textbox', { name: 'Name' })).toHaveFocus()
    await expect(args.onStartFresh).not.toHaveBeenCalled()
    await userEvent.type(c.getByRole('textbox', { name: 'Name' }), 'Northwind')
    await userEvent.click(c.getByRole('button', { name: 'New repository…' }))
    await expect(args.onStartFresh).toHaveBeenCalledOnce()
  },
}

/** Create, pressed with something missing, says what, and goes to it: the name, then a folder. */
export const Missing: Story = {
  render: (args) => <Forming onCreate={args.onCreate} />,
  args: { onCreate: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Create project/ }))
    await expect(c.getByRole('alert')).toHaveTextContent('Name the project first.')
    await expect(c.getByRole('textbox', { name: 'Name' })).toHaveFocus()
    await userEvent.type(c.getByRole('textbox', { name: 'Name' }), 'Northwind')
    await expect(c.queryByRole('alert')).toBeNull()
    await userEvent.click(c.getByRole('button', { name: /Create Northwind/ }))
    await expect(c.getByRole('alert')).toHaveTextContent('Add a folder, or start a new repository.')
    await expect(c.getByRole('button', { name: 'Choose a folder…' })).toHaveFocus()
    await expect(args.onCreate).not.toHaveBeenCalled()
  },
}

/** The rest of what this Mac has, behind a link; one in another project says so in place of Add. */
export const More: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: '2 more on this Mac' }))
    await expect(c.getByText('in Halyard')).toBeTruthy()
    await expect(c.queryByRole('button', { name: 'Add halyard-gateway' })).toBeNull()
    await expect(c.getByRole('button', { name: 'Add dotfiles' })).toBeTruthy()
  },
}

/** Connect GitLab, from what was read. */
export const Connecting: Story = {
  args: Read.args,
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Connect GitLab' }))
    await expect(args.onConnect).toHaveBeenCalledWith('gitlab')
  },
}

/** Folders held over the page: the page takes them, and letting go hands them on. */
export const Dropping: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const title = c.getByRole('heading', { name: 'Its folders' })
    const file = new File([''], 'northwind')
    const dataTransfer = { types: ['Files'], files: [file] }
    await fireEvent.dragEnter(title, { dataTransfer })
    await fireEvent.drop(title, { dataTransfer })
    await expect(args.onDrop).toHaveBeenCalledWith([file])
    await expect(c.queryByRole('list', { name: 'Its folders' })).toBeNull()
  },
}

/** Being made, there is nothing to leave: Escape does nothing. */
export const EscapeWhileCreating: Story = {
  args: { folders: [APP], creating: true, onCancel: fn() },
  play: async ({ args, canvasElement }) => {
    await waitFor(() => expect(within(canvasElement).getByRole('textbox', { name: 'Name' })).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await expect(args.onCancel).not.toHaveBeenCalled()
  },
}

/** Escape makes nothing; what is open over the page hears it first. */
export const Cancelling: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await waitFor(() => expect(c.getByRole('textbox', { name: 'Name' })).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await expect(args.onCancel).toHaveBeenCalledOnce()
  },
}

/** A long name, and long folders, at a narrow width. */
export const Long: Story = {
  args: {
    name: 'Northwind invoicing and the partner export, end to end',
    folders: [
      APP,
      {
        id: 'long',
        name: 'northwind-invoicing-partner-export-service-with-a-long-name',
        where: '~/code/clients/northwind/services/invoicing-partner-export',
        host: GITHUB,
        remote: 'northwind-co/invoicing-partner-export-service',
      },
    ],
  },
  decorators: [(Story) => <div style={{ width: 680, height: 900 }}>{Story()}</div>],
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'unnamed', node: <NewProject {...args} name="" found={{ like: null, first: FOUND.more, more: [] }} /> },
        { state: 'named', node: <NewProject {...args} /> },
        { state: 'looking', node: <NewProject {...args} found={null} /> },
        { state: 'reading', node: <NewProject {...args} {...Reading.args} /> },
        { state: 'read', node: <NewProject {...args} {...Read.args} /> },
        { state: 'local and shared', node: <NewProject {...args} {...LocalAndShared.args} /> },
        { state: 'a new repository', node: <NewProject {...args} {...Fresh.args} /> },
        { state: 'making it', node: <NewProject {...args} {...Creating.args} /> },
        { state: 'couldn’t make it', node: <NewProject {...args} {...Failed.args} /> },
        { state: 'in another ink', node: <NewProject {...args} {...Read.args} ink={ProjectInk.Slate} /> },
      ].map((cell) => ({ ...cell, node: <div style={{ height: 720 }}>{cell.node}</div> }))}
    />
  ),
}
