import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { OtherTools, type OtherToolsProps, type OtherToolTile } from './OtherTools'

/* What a person moving from other tools has for a project: Conductor's and Orca's worktrees, T3 Code's, Paradev's, one made by hand, and Claude Code's and Codex's conversations. */
const where = (branch: string, path: string) => (
  <>
    <code>{branch}</code>
    <code>{path}</code>
  </>
)
const TILES: OtherToolTile[] = [
  {
    id: 'conductor',
    name: 'Conductor',
    brand: Brand.Conductor,
    size: '2 worktrees',
    fact: '3 files not committed',
    groups: [
      {
        title: 'Worktrees',
        items: [
          {
            key: 'w-lima',
            title: 'Lima',
            at: '2h ago',
            where: where('feature/lima', '~/conductor/workspaces/meridian/lima'),
            facts: [
              <>
                <Icon name="pr" size={12} />
                #812
              </>,
              '3 files not committed',
              <>
                <Icon name="up" size={12} />2 not pushed
              </>,
            ],
          },
          { key: 'w-oslo', title: 'Oslo', at: 'Tue', where: where('fix/flaky-login', '~/conductor/workspaces/meridian/oslo') },
        ],
      },
      { title: 'Setup', items: [{ key: 's-conductor', title: 'Its setup script', where: <code>conductor.json</code> }] },
    ],
  },
  {
    id: 'orca',
    name: 'Orca',
    brand: Brand.Orca,
    size: '1 worktree',
    fact: '1 file not committed',
    groups: [
      {
        title: 'Worktrees',
        items: [
          { key: 'w-orca', title: 'Flaky login test', at: '5h ago', where: where('fix/login', '~/orca/workspaces/meridian/fix-login') },
        ],
      },
    ],
  },
  {
    id: 't3',
    name: 'T3 Code',
    brand: Brand.T3Code,
    size: '1 worktree',
    fact: 'PR #93',
    groups: [
      {
        title: 'Worktrees',
        items: [
          { key: 'w-t3', title: 'Dark mode toggle', at: 'yesterday', where: where('t3/1a2b3c4d', '~/.t3/worktrees/meridian/t3-1a2b') },
        ],
      },
    ],
  },
  {
    id: 'paradev',
    name: 'Paradev',
    brand: Brand.Paradev,
    size: '1 worktree',
    fact: 'Last worked on 3d ago',
    groups: [
      {
        title: 'Worktrees',
        items: [{ key: 'w-paradev', title: 'Search box', at: '3d ago', where: where('search', '~/.paradev/worktrees/meridian/search') }],
      },
    ],
  },
  {
    id: 'hand',
    name: 'By hand',
    icon: 'branch',
    size: '1 worktree',
    fact: 'Last worked on Mon',
    groups: [
      {
        title: 'Worktrees',
        items: [{ key: 'w-hand', title: 'Review pr 812', at: 'Mon', where: where('review/pr-812', '~/Projects/meridian-review') }],
      },
    ],
  },
  {
    id: 'claude_code',
    name: 'Claude Code',
    brand: Brand.ClaudeCode,
    size: '23 conversations',
    fact: 'Last 40m ago',
    groups: [
      {
        title: 'Conversations',
        items: [
          { key: 'c-1', title: 'Gyroscope fixture failing on CI', at: '40m ago', where: '12 messages' },
          { key: 'c-2', title: 'Lima export', at: '2h ago', where: '6 messages · lima' },
          { key: 'c-3', title: 'Why is the build slow on Linux?', at: 'Oct 28', where: '31 messages' },
        ],
      },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    brand: Brand.Codex,
    size: '10 conversations',
    fact: 'Last yesterday',
    groups: [{ title: 'Conversations', items: [{ key: 'c-4', title: 'Rename to compass', at: 'yesterday', where: '4 messages' }] }],
  },
]

const onPick = fn()

/* As a consumer keeps it: what is picked. */
function Picking(props: Partial<OtherToolsProps>) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(props.picked ?? new Set())
  return (
    <div style={{ width: 720 }}>
      <OtherTools
        tiles={TILES}
        {...props}
        picked={picked}
        onPick={(keys, on) => {
          onPick(keys, on)
          setPicked((now) => {
            const next = new Set(now)
            for (const key of keys)
              if (on) next.add(key)
              else next.delete(key)
            return next
          })
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Setup/OtherTools',
  component: OtherTools,
  render: (args) => <Picking {...args} />,
  args: { tiles: TILES, picked: new Set(), onPick },
} satisfies Meta<typeof OtherTools>
export default meta
type Story = StoryObj<typeof meta>

/** Nothing taken: a tile a tool, its mark, how much it has and what's pressing. */
export const Found: Story = {}

/** A press takes a whole tool; part of one says how much. */
export const PartTaken: Story = {
  args: { picked: new Set(['w-lima', 's-conductor', 'c-1', 'c-2', 'c-3', 'c-4']) },
}

/** A tile open: what's in it, under its row, to pick inside. */
export const Open: Story = {
  args: { picked: new Set(['w-lima']), defaultOpen: 'conductor' },
}

/** A press on a tile takes all of it, its chevron opens it, and Escape closes it. */
export const TakeAndOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const take = canvas.getByRole('button', { name: /^Orca/ })
    await userEvent.click(take)
    await expect(onPick).toHaveBeenLastCalledWith(['w-orca'], true)
    await expect(take).toHaveAttribute('aria-pressed', 'true')
    const inside = canvas.getByRole('button', { name: 'What’s in Conductor' })
    await userEvent.click(inside)
    await expect(inside).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(canvas.getByRole('checkbox', { name: /Oslo/ }))
    await expect(onPick).toHaveBeenLastCalledWith(['w-oslo'], true)
    await userEvent.keyboard('{Escape}')
    await expect(inside).toHaveAttribute('aria-expanded', 'false')
  },
}
