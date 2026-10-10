import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { DiffLineKind } from '../../foundations/vocabulary'
import { ROUTER_DIFF } from '../../fixtures/meridian'
import { Button } from '../../primitives/Button/Button'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import type { DiffLine } from '../../thread/Diff/Diff'
import { ChangeView, type ChangeViewProps, type FileView, type ViewedFile } from './ChangeView'

const FILES: ViewedFile[] = [
  { path: 'src/charges/limit.ts', status: 'modified', add: 14, del: 3 },
  { path: 'src/refunds/router.ts', status: 'modified', add: 12, del: 1 },
  { path: 'src/refunds/limit.test.ts', status: 'added', add: 48, del: 0 },
  { path: 'docs/retry.md', from: 'docs/retries.md', status: 'renamed', add: 0, del: 0 },
  { path: 'src/legacy/backoff.ts', status: 'deleted', add: 0, del: 22 },
  { path: 'assets/limit.png', status: 'modified', add: 0, del: 0, binary: true },
  { path: 'notes/scratch.md', status: 'added', add: 6, del: 0, uncommitted: true },
]

const meta = {
  title: 'Outputs/ChangeView',
  component: ChangeView,
  parameters: { layout: 'fullscreen' },
  args: {
    branch: 'althar/mer-231-rate-limit-refunds',
    base: 'main',
    files: FILES,
    selected: 'src/refunds/router.ts',
    onSelect: fn(),
    view: { state: 'ready', lines: ROUTER_DIFF },
    onRetry: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof ChangeView>
export default meta
type Story = StoryObj<typeof meta>

/** Choosing a file shows it; the view keeps the choice, as the app does. */
const Choosing = (args: ChangeViewProps) => {
  const [selected, setSelected] = useState(args.selected)
  return (
    <ChangeView
      {...args}
      selected={selected}
      onSelect={(path) => {
        args.onSelect(path)
        setSelected(path)
      }}
    />
  )
}

/** A task's change: its files, and the one you're on as a diff. */
export const Changes: Story = {
  render: (args) => <Choosing {...args} />,
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('dialog', { name: 'Changes' })).toBeInTheDocument()
    await expect(body.getByText('althar/mer-231-rate-limit-refunds into main')).toBeInTheDocument()
    await expect(body.getByText('7 files')).toBeInTheDocument()
    // j and k go through the files.
    await userEvent.keyboard('j')
    await expect(args.onSelect).toHaveBeenLastCalledWith('src/refunds/limit.test.ts')
    await userEvent.keyboard('{ArrowUp}')
    await expect(args.onSelect).toHaveBeenLastCalledWith('src/refunds/router.ts')
    await userEvent.click(body.getByRole('button', { name: /backoff\.ts/ }))
    await expect(args.onSelect).toHaveBeenLastCalledWith('src/legacy/backoff.ts')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(args.onClose).toHaveBeenCalled())
  },
}

const at = (selected: string, view: FileView) => ({ selected, view })

/* A whole file's diff, as the runtime reads it: one change in the middle of sixty lines. */
const WHOLE: DiffLine[] = [
  { kind: DiffLineKind.Hunk, text: '@@ -1,60 +1,61 @@' },
  ...Array.from({ length: 30 }, (_, i): DiffLine => ({ kind: DiffLineKind.Context, old: i + 1, new: i + 1, text: `  // line ${i + 1}` })),
  { kind: DiffLineKind.Removed, old: 31, text: '  const response = await fetch(endpoint)', changed: ['fetch(endpoint)'] },
  {
    kind: DiffLineKind.Added,
    new: 31,
    text: '  const response = await withRetry(() => fetch(endpoint))',
    changed: ['withRetry(() => fetch(endpoint))'],
  },
  { kind: DiffLineKind.Added, new: 32, text: '  if (!response.ok) throw new CheckoutError(response.status)' },
  ...Array.from({ length: 29 }, (_, i): DiffLine => ({
    kind: DiffLineKind.Context,
    old: i + 32,
    new: i + 33,
    text: `  // line ${i + 32}`,
  })),
]

/** A whole file: what didn't change folds away, but for three lines beside the change, and opens in place. */
export const WholeFile: Story = {
  args: at('src/charges/limit.ts', { state: 'ready', lines: WHOLE }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('button', { name: 'Show 27 unchanged lines' })).toBeInTheDocument()
    await expect(body.getByRole('button', { name: 'Show 26 unchanged lines' })).toBeInTheDocument()
    await expect(body.queryByText('@@ -1,60 +1,61 @@')).toBeNull()
    await expect(body.queryByText('// line 1')).toBeNull()
    await userEvent.click(body.getByRole('button', { name: 'Show 27 unchanged lines' }))
    await expect(body.getByText('// line 1')).toBeInTheDocument()
    await expect(body.queryByRole('button', { name: 'Show 27 unchanged lines' })).toBeNull()
  },
}

/** A file too long to read whole comes in hunks: where it skips lines, a quiet line names the function, never the raw header. */
export const InHunks: Story = {
  args: at('src/charges/limit.ts', {
    state: 'ready',
    lines: [
      { kind: DiffLineKind.Hunk, text: '@@ -120,4 +120,4 @@ export function limit()' },
      { kind: DiffLineKind.Context, old: 120, new: 120, text: '  const max = 3' },
      { kind: DiffLineKind.Removed, old: 121, text: '  const wait = 100' },
      { kind: DiffLineKind.Added, new: 121, text: '  const wait = 250' },
      { kind: DiffLineKind.Hunk, text: '@@ -900,3 +900,3 @@ function backoff(at: number)' },
      { kind: DiffLineKind.Removed, old: 900, text: '  return wait * at' },
      { kind: DiffLineKind.Added, new: 900, text: '  return wait * 2 ** at' },
    ],
  }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByText('export function limit()')).toBeInTheDocument()
    await expect(body.getByText('function backoff(at: number)')).toBeInTheDocument()
    await expect(body.queryByText(/^@@/)).toBeNull()
  },
}

/** What a tool made goes last, under its own word, its diff folded until asked for. */
export const Generated: Story = {
  args: {
    files: [{ path: 'bun.lock', status: 'modified', add: 812, del: 640, generated: true }, ...FILES.slice(0, 2)],
    selected: 'bun.lock',
    view: { state: 'ready', lines: ROUTER_DIFF },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const list = within(body.getByRole('navigation', { name: 'Changed files' }))
    const names = list.getAllByRole('button').map((button) => button.textContent ?? '')
    await expect(names.at(-1)).toMatch(/bun\.lock/)
    await expect(list.getByText('Generated')).toBeInTheDocument()
    await expect(body.getByText(/Made by a tool, not written: 812 lines added, 640 removed/)).toBeInTheDocument()
    await userEvent.click(body.getByRole('button', { name: 'Show the diff' }))
    await expect(body.getByRole('group', { name: 'bun.lock' })).toBeInTheDocument()
  },
}

/** What else opens it, beside Close: an editor, at the file. Its menu's arrows are its own, not the list of files'. */
export const WithActions: Story = {
  args: {
    actions: (
      <Menu trigger={<Button size="small">Open in another editor</Button>} label="Open in another editor">
        <MenuItem onSelect={() => {}}>Open in Zed</MenuItem>
        <MenuItem onSelect={() => {}}>Show in Finder</MenuItem>
      </Menu>
    ),
  },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('button', { name: /Close/ })).toBeInTheDocument()
    await userEvent.click(body.getByRole('button', { name: 'Open in another editor' }))
    await expect(await body.findByRole('menuitem', { name: 'Open in Zed' })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}')
    await expect(args.onSelect).not.toHaveBeenCalled()
  },
}

/** Being read. */
export const Loading: Story = { args: at('src/charges/limit.ts', { state: 'loading' }) }
/** Couldn't be read: it says so, and tries again. */
export const Failed: Story = {
  args: at('src/charges/limit.ts', { state: 'failed' }),
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole('button', { name: 'Try again' }))
    await expect(args.onRetry).toHaveBeenCalled()
  },
}
/** A picture: its contents aren't shown. */
export const Binary: Story = { args: at('assets/limit.png', { state: 'ready', lines: [] }) }
/** Moved, nothing else changed. */
export const Moved: Story = { args: at('docs/retry.md', { state: 'ready', lines: [] }) }
/** Not committed yet, so not in what Althar pushes. */
export const NotCommitted: Story = { args: at('notes/scratch.md', { state: 'ready', lines: ROUTER_DIFF.slice(0, 5) }) }
/** Longer than it shows. */
export const CutShort: Story = { args: at('src/refunds/router.ts', { state: 'ready', lines: ROUTER_DIFF, truncated: true }) }
/** Nothing changed yet. */
export const Nothing: Story = { args: { files: [], selected: null, view: { state: 'ready', lines: [] } } }
/** On a phone-width window, the files sit above the diff. */
export const Narrow: Story = { globals: { viewport: { value: 'mobile1' } } }
/** In the app on macOS: the system's lights sit over the window's top row, so the view stays below it. */
export const UnderTheLights: Story = { args: { lights: 'space' } }
/** Narrow, under the lights: the whole window but its top row. */
export const NarrowUnderTheLights: Story = { args: { lights: 'space' }, globals: { viewport: { value: 'mobile1' } } }
