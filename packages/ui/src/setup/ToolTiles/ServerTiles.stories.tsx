import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  CROWD,
  CROWDED_PROJECTS,
  filesOf,
  SERVER_SYNC,
  SERVER_SYNC_OFF,
  SERVERS,
  TOOL_AGENTS,
  TOOL_COUNTS,
  TOOL_PROJECTS,
} from '../../fixtures/tools'
import { AddServerDialog } from './AddServerDialog'
import { ServerSheet } from './ServerSheet'
import { ServerTiles, type ServerTilesProps } from './ServerTiles'
import type { ServerStarter, ServerTileModel } from './tools'

/*
 * Settings › MCP servers. The stories hold what a click changes, as the
 * desktop app's model would, so a tile switched, a sign-in or a removal
 * shows; each opened server is a ServerSheet, and Add a server opens the
 * AddServerDialog.
 */

const width = (px: number) => (Story: () => ReactNode) => <div style={{ maxWidth: px }}>{Story()}</div>

const meta = {
  title: 'Setup/ToolTiles/ServerTiles',
  component: ServerTiles,
  parameters: { layout: 'padded' },
  decorators: [width(880)],
  args: {
    servers: SERVERS,
    agents: TOOL_AGENTS,
    projects: TOOL_PROJECTS,
    sync: SERVER_SYNC,
    onRoles: fn(),
    onSync: fn(),
    onUndo: fn(),
    onAdd: fn(),
    onOpenChange: fn(),
  },
  render: (args) => <Kept {...args} />,
} satisfies Meta<typeof ServerTiles>
export default meta
type Story = StoryObj<typeof meta>

/** The section with a model behind it: switches, sign-ins and removals change what shows. */
function Kept(args: ServerTilesProps) {
  const [servers, setServers] = useState(args.servers)
  const [sync, setSync] = useState(args.sync)
  const [adding, setAdding] = useState<ServerStarter | null | false>(false)
  const change = (id: string, to: (one: ServerTileModel) => ServerTileModel) =>
    setServers((now) => now.map((one) => (one.id === id ? to(one) : one)))
  return (
    <>
      <ServerTiles
        {...args}
        servers={servers}
        sync={sync}
        onRoles={(server, roles) => {
          args.onRoles(server, roles)
          change(server.id, (one) => ({ ...one, roles }))
        }}
        onSync={(on, takeBack) => {
          args.onSync(on, takeBack)
          setSync((now) => ({ ...now, on }))
        }}
        onUndo={(id) => {
          args.onUndo?.(id)
          setSync((now) => ({ ...now, changes: (now.changes ?? []).map((one) => (one.id === id ? { ...one, undone: true } : one)) }))
        }}
        onAdd={(start) => {
          args.onAdd?.(start)
          setAdding(start)
        }}
        sheet={(server, back) => (
          <ServerSheet
            server={server}
            agents={args.agents}
            projects={args.projects}
            sync={sync.on}
            files={filesOf(server, args.agents)}
            tools={TOOL_COUNTS[server.id] ?? null}
            onBack={back}
            onRoles={(roles) => change(server.id, (one) => ({ ...one, roles }))}
            onProject={(project, on) =>
              change(server.id, (one) => ({ ...one, offIn: on ? one.offIn.filter((id) => id !== project) : [...one.offIn, project] }))
            }
            onKeepOut={(agent, out) => change(server.id, (one) => ({ ...one, here: { ...one.here, [agent]: out ? 'out' : 'added' } }))}
            onUseWay={(agent) =>
              change(server.id, (one) => ({
                ...one,
                here: Object.fromEntries(Object.keys(one.here).map((id) => [id, id === agent ? 'in' : 'added'])),
              }))
            }
            onSignIn={(agent) => change(server.id, (one) => ({ ...one, failed: null, signIn: { ...one.signIn, [agent]: 'yes' } }))}
            onRemove={() => setServers((now) => now.filter((one) => one.id !== server.id))}
          />
        )}
      />
      {adding !== false && (
        <AddServerDialog
          start={adding}
          sync={sync.on}
          agents={args.agents}
          taken={servers.map((one) => one.name)}
          onClose={() => setAdding(false)}
          onAdd={(server) => {
            setServers((now) => [
              ...now,
              {
                id: server.name,
                name: server.name,
                runs: server.url ?? [server.command, ...(server.args ?? [])].join(' '),
                roles: ['lead', 'reviewer', 'coordinator'],
                offIn: [],
                repository: null,
                here: { claude: 'in', codex: 'added', opencode: 'added' },
                signIn: { claude: 'none', codex: 'none', opencode: 'none' },
                failed: null,
              },
            ])
            setAdding(false)
          }}
        />
      )}
    </>
  )
}

/** Each server a tile, what waits first: the failed one, then those waiting on the person, then the rest, each by name; Add a server last. */
export const Usual: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const switches = canvas.getAllByRole('switch').map((one) => one.getAttribute('aria-label'))
    await expect(switches.slice(0, 4)).toEqual(['notion', 'akiflow', 'github', 'linear'])
    await expect(canvas.getByText('Failed to start')).toBeVisible()
    await expect(canvas.getByText('Codex runs it another way')).toBeVisible()
    await expect(canvas.getByText('Codex and OpenCode aren’t signed in')).toBeVisible()
    await expect(canvas.getByText('Not signed in yet')).toBeVisible()
    await expect(canvas.getByText('Leads only · not in fnt')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add a server' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'In althar’s repository' })).toBeVisible()
  },
}

/** The name opens it in place; Back, or Escape, returns to the tiles with focus on the tile it came from. */
export const OpensInPlace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^linear/ }))
    await expect(canvas.getByRole('heading', { name: 'linear' })).toHaveFocus()
    await expect(canvas.getByText('23 tools')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: /^linear/ })).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('heading', { name: 'linear' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(canvas.getByRole('button', { name: /^linear/ })).toHaveFocus())
  },
}

/** The round switch gives a server to every role, or none. */
export const SwitchedOff: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('switch', { name: 'figma' }))
    await expect(args.onRoles).toHaveBeenCalledWith(expect.objectContaining({ name: 'figma' }), [])
    await expect(canvas.getByRole('switch', { name: 'figma' })).not.toBeChecked()
    await expect(canvas.getAllByText('Off').length).toBeGreaterThan(0)
  },
}

/** Signing in where it waited moves its tile in among the rest, the list moving as a whole. */
export const SignedInMoves: Story = {
  args: { defaultOpen: 'akiflow' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const agent of ['Claude Code', 'Codex', 'OpenCode'])
      await userEvent.click(canvas.getByRole('button', { name: `Sign in to akiflow in ${agent}` }))
    await expect(canvas.getAllByText('Signed in')).toHaveLength(3)
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }))
    const switches = canvas.getAllByRole('switch').map((one) => one.getAttribute('aria-label'))
    await expect(switches.indexOf('akiflow')).toBeGreaterThan(switches.indexOf('linear'))
  },
}

/** None yet: where each agent keeps its own, the servers often added (each fills the form in), and Another server. */
export const Empty: Story = {
  args: { servers: [], sync: SERVER_SYNC_OFF },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'No MCP servers yet' })).toBeVisible()
    await expect(canvas.getByText('~/.codex/config.toml')).toBeVisible()
    await expect(canvas.queryByText('What it changed')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Add linear' }))
    await expect(args.onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'linear' }))
    const dialog = within(await within(document.body).findByRole('dialog'))
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('linear')
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
  },
}

/** Twenty-two servers and eight projects: where each is given, said short. */
export const Crowded: Story = {
  args: { servers: [...SERVERS, ...CROWD], projects: CROWDED_PROJECTS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText('Failed to start')).toHaveLength(2)
    await expect(canvas.getByText('Leads only · only in meridian and ledger')).toBeVisible()
  },
}

/** A crowded server opened: eight projects' marks wrap rather than overflow. */
export const CrowdedOpened: Story = {
  args: { servers: [...SERVERS, ...CROWD], projects: CROWDED_PROJECTS, defaultOpen: 'stripe' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const projects = canvas.getByRole('group', { name: 'Projects that get stripe' })
    await expect(within(projects).getAllByRole('button')).toHaveLength(8)
    await userEvent.click(within(projects).getByRole('button', { name: 'meridian' }))
    await expect(within(projects).getByRole('button', { name: 'meridian' })).toHaveAttribute('aria-pressed', 'false')
  },
}

/** A long name ends in … on its tile; its failure says why in full once opened. */
export const LongNames: Story = {
  args: { servers: CROWD.slice(4, 9), defaultOpen: 'slack' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Slack refused its token: the app was removed from the workspace.')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }))
    await expect(canvas.getByRole('switch', { name: 'cloudflare-bindings-and-workers-observability' })).toBeVisible()
  },
}

/** Failing: why its last start failed, and which agent said so. */
export const Failing: Story = {
  args: { defaultOpen: 'notion' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Last start')).toBeVisible()
    await expect(canvas.getByText(/^Claude Code: Notion refused its sign-in/)).toBeVisible()
  },
}

/** Waiting on a sign-in: each agent's own Sign in, named for the agent and the server. */
export const WaitingOnSignIn: Story = {
  args: { defaultOpen: 'linear' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Signed in')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in to linear in Codex' }))
    await expect(canvas.getAllByText('Signed in')).toHaveLength(2)
  },
}

/** Turning Same servers everywhere on says first what each agent gets and what it leaves alone. */
export const TurningSyncOn: Story = {
  args: { sync: SERVER_SYNC_OFF },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('switch', { name: 'Same servers everywhere' }))
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Give your agents the same servers?' }))
    await expect(dialog.getByText('Adds linear, figma, notion, playwright and akiflow')).toBeVisible()
    await expect(dialog.getByText('Nothing to add')).toBeVisible()
    await expect(dialog.getByText('It leaves alone')).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Turn on' }))
    await expect(args.onSync).toHaveBeenCalledWith(true, false)
    await expect(canvas.getByRole('switch', { name: 'Same servers everywhere' })).toBeChecked()
  },
}

/** Turning it off asks whether what it copied stays. */
export const TurningSyncOff: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('switch', { name: 'Same servers everywhere' }))
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Stop giving them the same servers?' }))
    await expect(dialog.getByText(/It added 12 servers/)).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Take them out' }))
    await expect(args.onSync).toHaveBeenCalledWith(false, true)
  },
}

/** What it changed opens to each change, with its Undo or Put it back; back, focus is on it again. */
export const WhatItChanged: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^What it changed/ }))
    await expect(canvas.getByRole('heading', { name: 'What it changed' })).toBeVisible()
    await userEvent.click(canvas.getAllByRole('button', { name: 'Undo' })[0]!)
    await expect(args.onUndo).toHaveBeenCalledWith('s1')
    await expect(canvas.getByRole('button', { name: 'Put it back' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: /^What it changed/ })).toHaveFocus())
  },
}

/** Removing one says which agents it comes out of, and back at the tiles it is gone. */
export const Removing: Story = {
  args: { defaultOpen: 'figma' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Remove…' }))
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Remove figma?' }))
    await expect(dialog.getByText('It comes out of Claude Code, Codex and OpenCode.')).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(canvas.queryByRole('switch', { name: 'figma' })).toBeNull())
  },
}

/** While they are read: the tiles' places, in their shape. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveAttribute('aria-busy', 'true')
  },
}

/** What couldn't be read, in words, with Try again. */
export const ReadFailed: Story = {
  args: { error: 'Codex’s settings can’t be read: ~/.codex/config.toml has a stray "]" on line 14.', onRetry: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent('stray')
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(args.onRetry).toHaveBeenCalled()
  },
}

/** An 800px window: the side goes over the section, which keeps three across. */
export const Narrow: Story = { decorators: [width(708)] }

/** The narrowest the section gets, beside the side just before it moves over: two across. */
export const Narrowest: Story = { decorators: [width(500)], args: { servers: [...SERVERS, ...CROWD], projects: CROWDED_PROJECTS } }

export const Dark: Story = { globals: { theme: 'dark' } }

export const DarkEmpty: Story = { args: { servers: [], sync: SERVER_SYNC_OFF }, globals: { theme: 'dark' } }

export const DarkOpened: Story = { args: { defaultOpen: 'github' }, globals: { theme: 'dark' } }
