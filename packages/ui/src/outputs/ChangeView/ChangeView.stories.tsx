import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { DiffLineKind } from '../../foundations/vocabulary'
import { ROUTER_DIFF } from '../../fixtures/meridian'
import { REVIEW_DIFFS, REVIEW_FILES, REVIEW_FINDINGS, REVIEW_FINDINGS_SETTLED, REVIEW_LOOSE } from '../../fixtures/reviewFindings'
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

/** With a review's findings: the file and the finding you're on kept, as the app does, each file's diff as it was read. */
const Reviewed = (args: ChangeViewProps) => {
  const [selected, setSelected] = useState(args.selected)
  const [finding, setFinding] = useState(args.finding ?? null)
  const path = selected ?? args.files[0]?.path ?? ''
  const lines = REVIEW_DIFFS[path]
  return (
    <ChangeView
      {...args}
      selected={selected}
      onSelect={(next) => {
        args.onSelect(next)
        setSelected(next)
      }}
      finding={finding}
      onFinding={(id) => {
        args.onFinding?.(id)
        setFinding(id)
      }}
      view={lines === undefined ? { state: 'ready', lines: [] } : { state: 'ready', lines }}
    />
  )
}

const MODEL_CHOICE = 'apps/desktop/src/renderer/shared/ModelChoice.tsx'
const BROWSER = 'packages/ui/src/composer/ModelBrowser/ModelBrowser.tsx'

/**
 * A review being settled: the files it names first, worst first, each with
 * its count; each finding a note under its line, the first open. A file the
 * change left alone is there, as the first finding is about it.
 */
export const Findings: Story = {
  args: {
    branch: 'althar/model-browser-full-model-names',
    files: REVIEW_FILES,
    selected: MODEL_CHOICE,
    findings: REVIEW_FINDINGS,
    finding: 'find_1',
    onFinding: fn(),
  },
  render: (args) => <Reviewed {...args} />,
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const list = body.getByRole('navigation', { name: 'Changed files' })
    await expect(body.getByText('6 open')).toBeInTheDocument()
    // What it changed, not the files it left alone.
    await expect(body.getByText('7 files')).toBeInTheDocument()
    // Named files first, worst finding first: the file it left alone, then the tests, then the browser's styles.
    const names = within(list)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')
    await expect(names[0]).toContain('ModelChoice.tsx')
    await expect(names[0]).toContain('Unchanged')
    await expect(names[1]).toContain('models.test.tsx')
    await expect(names[2]).toContain('ModelBrowser.module.css')
    await expect(names[3]).toContain('ModelBrowser.tsx')
    await expect(names[3]).toContain('2 findings')
    // The finding is under its line, which stays out of the folds.
    const note = await body.findByRole('article', { current: true })
    await expect(within(note).getByText('The Usage header is blank in the app: its text lacks room')).toBeInTheDocument()
    await expect(within(note).getByText('Blocking')).toBeInTheDocument()
    // ] goes to the next, in its own file; [ comes back.
    await userEvent.keyboard(']')
    await expect(args.onFinding).toHaveBeenLastCalledWith('find_2')
    await expect(args.onSelect).toHaveBeenLastCalledWith('apps/desktop/tests/models.test.tsx')
    await userEvent.keyboard('[[')
    await expect(args.onFinding).toHaveBeenLastCalledWith('find_1')
    await expect(args.onSelect).toHaveBeenLastCalledWith(MODEL_CHOICE)
  },
}

/** Two findings in one file: each under its own line; the one you're not on shows its first lines, and its title goes to it. */
export const FindingsInOneFile: Story = {
  args: { ...Findings.args, selected: BROWSER, finding: 'find_4' },
  render: (args) => <Reviewed {...args} />,
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(body.getAllByRole('article')).toHaveLength(2))
    await userEvent.click(body.getByRole('button', { name: 'aria-describedby names a cell that isn’t there' }))
    await expect(args.onFinding).toHaveBeenLastCalledWith('find_6')
    await expect(body.getByRole('article', { current: true })).toHaveTextContent('Nit')
  },
}

/** Once settled: what became of each, the lead's words and commit under it, the file's count ticked. */
export const FindingsSettled: Story = {
  args: { ...Findings.args, findings: REVIEW_FINDINGS_SETTLED },
  render: (args) => <Reviewed {...args} />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByText('6 fixed')).toBeInTheDocument()
    const note = await body.findByRole('article', { current: true })
    await expect(within(note).getByText('Fixed')).toBeInTheDocument()
    await expect(within(note).getByText('6c3783c')).toBeInTheDocument()
  },
}

/** A finding about no file of the change, a picture missing: listed first, its note alone; ] reaches it in its weight's turn. */
export const FindingNotInTheCode: Story = {
  args: {
    ...Findings.args,
    findings: [...REVIEW_FINDINGS, REVIEW_LOOSE],
    finding: 'find_5',
    selected: 'packages/ui/src/composer/ModelBrowser/ModelBrowser.stories.tsx',
  },
  render: (args) => <Reviewed {...args} />,
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.keyboard(']')
    await expect(args.onFinding).toHaveBeenLastCalledWith('find_7')
    await expect(body.getByRole('region', { name: 'Not in the code' })).toBeInTheDocument()
    await expect(body.getByRole('article', { current: true })).toHaveTextContent('No picture of the settled note and Usage layout')
    // A file picked leaves it.
    await userEvent.click(body.getByRole('button', { name: /ModelChoice\.tsx/ }))
    await expect(body.queryByRole('region', { name: 'Not in the code' })).toBeNull()
  },
}

/** A change with no files yet, and a review that found only what isn't about one: its findings still show, whole. */
export const FindingsWithNoFiles: Story = {
  args: { ...Findings.args, files: [], selected: null, findings: [REVIEW_LOOSE], finding: null },
  render: (args) => <Reviewed {...args} />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('region', { name: 'Not in the code' })).toBeInTheDocument()
    await expect(body.getByRole('article')).toHaveTextContent('No picture of the settled note and Usage layout')
    await expect(body.queryByText('Nothing has changed yet.')).toBeNull()
  },
}
