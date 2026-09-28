import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { EDGE_MAP, MERIDIAN_MAP, READING_MAP, ROLES, useSourceMap } from '../../fixtures/setup'
import { States } from '../../storybook/States'
import { SourceMap, type SourceMapProps } from './SourceMap'

const meta = {
  title: 'Setup/SourceMap',
  component: SourceMap,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 620 }}>{Story()}</div>],
  args: {
    sources: MERIDIAN_MAP,
    roles: ROLES,
    onRoleChange: fn(),
    onOriginChange: fn(),
    onFindingChange: fn(),
    onRemove: fn(),
    onChooseFolders: fn(),
    onAddUrl: fn(),
  },
} satisfies Meta<typeof SourceMap>
export default meta
type Story = StoryObj<typeof meta>

/* The map, holding its own changes. */
function Live(args: SourceMapProps) {
  const map = useSourceMap(args.sources)
  return (
    <SourceMap
      {...args}
      sources={map.sources}
      onRoleChange={(id, v) => (args.onRoleChange(id, v), map.onRoleChange(id, v))}
      onOriginChange={(id, v) => (args.onOriginChange(id, v), map.onOriginChange(id, v))}
      onFindingChange={(id, f, v) => (args.onFindingChange(id, f, v), map.onFindingChange(id, f, v))}
      onRemove={(id) => (args.onRemove(id), map.onRemove(id))}
      onAddUrl={args.onAddUrl && ((url) => (args.onAddUrl?.(url), map.onAddUrl(url)))}
    />
  )
}

/**
 * Three folders and a URL, as read: uncommitted changes left alone, a nested
 * repository, a fork, a workspace of packages. Each decision is already
 * made; change any of them.
 */
export const Meridian: Story = { render: (args) => <Live {...args} /> }

/** Being read; its role is suggested once reading finishes. */
export const Reading: Story = { args: { sources: READING_MAP } }

/** A repository with no remote, and one kept for later on this Mac. */
export const Edges: Story = { render: (args) => <Live {...args} sources={EDGE_MAP} /> }

/** No repositories: a project for planning, research or writing. */
export const Empty: Story = { args: { sources: [] } }

/** A URL typed in place: Add (or Enter) adds it, Escape puts the field away. */
export const AddingAUrl: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Clone from a URL' }))
    await userEvent.click(c.getByRole('button', { name: 'Add' }))
    await expect(args.onAddUrl).not.toHaveBeenCalled()
    await expect(c.getByRole('textbox', { name: 'Repository URL' })).toHaveAttribute('aria-invalid', 'true')
    await userEvent.type(c.getByRole('textbox', { name: 'Repository URL' }), 'github.com/meridian/ledger.git')
    await userEvent.click(c.getByRole('button', { name: 'Add' }))
    await expect(args.onAddUrl).toHaveBeenCalledWith('github.com/meridian/ledger.git')
    await expect(c.queryByRole('textbox')).not.toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Clone from a URL' }))
    await userEvent.keyboard('{Escape}')
    await expect(c.queryByRole('textbox')).not.toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Clone from a URL' })).toHaveFocus()
    await expect(args.onAddUrl).toHaveBeenCalledTimes(1)
  },
}

/** Removing one takes it off the map; nothing on disk is touched. */
export const Removing: Story = {
  render: (args) => <Live {...args} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Remove meridian-infra' }))
    await expect(args.onRemove).toHaveBeenCalledWith('infra')
    await expect(c.queryByText('meridian-infra')).not.toBeInTheDocument()
  },
}

/** Without ways to add, the map is only read. */
export const Fixed: Story = { args: { onChooseFolders: undefined, onAddUrl: undefined } }

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'as read', node: <SourceMap {...args} /> },
        { state: 'reading', node: <SourceMap {...args} sources={READING_MAP} /> },
        { state: 'no remote, later', node: <SourceMap {...args} sources={EDGE_MAP} /> },
        { state: 'empty', node: <SourceMap {...args} sources={[]} /> },
        {
          state: 'narrow',
          node: (
            <div style={{ width: 360 }}>
              <SourceMap {...args} />
            </div>
          ),
        },
      ]}
    />
  ),
}
