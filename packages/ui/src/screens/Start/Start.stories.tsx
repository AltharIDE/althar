import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fireEvent, fn, userEvent, within } from 'storybook/test'

import { FIRST_RUN, NONE_READY } from '../../fixtures/setup'
import { RuntimeState } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
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

/** No agent ready: a project can still be made, and says so. */
export const NoneReady: Story = { args: { runtimes: NONE_READY } }

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
