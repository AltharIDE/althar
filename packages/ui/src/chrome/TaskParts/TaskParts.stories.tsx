import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { TaskStatus } from '../../foundations/vocabulary'
import { ChromeButton } from '../ChromeButton/ChromeButton'
import { TaskHeader } from '../TaskHeader/TaskHeader'
import { PartLines, type PartKind, TaskParts, type TaskPartModel } from './TaskParts'
import { WorktreeBody, type WorktreeFile } from './WorktreeBody'

/* A task's parts, just before the faces, which never move with Run and the menu (ADR-097). */

const FILES: ReadonlyArray<WorktreeFile> = [
  { path: 'apps/desktop/src/renderer/features/news/AltharPage.tsx', add: 42, del: 8 },
  { path: 'apps/site/src/changelog/takes/Log.tsx', add: 23, del: 4 },
  { path: 'apps/site/src/changelog/takes/LogData.ts', add: 118, del: 31 },
  { path: 'apps/site/src/changelog/takes/LogPictures.module.css', add: 64, del: 0 },
  { path: 'apps/site/src/changelog/takes/LogPictures.tsx', add: 15, del: 2 },
  { path: 'apps/site/public/changelog/0-10-0/host.png', add: 0, del: 0, binary: true },
  ...Array.from({ length: 15 }, (_, at) => ({ path: `packages/ui/src/screens/News/takes/Take${at + 1}.tsx`, add: 4 + at, del: at % 3 })),
]

const PARTS: ReadonlyArray<TaskPartModel> = [
  {
    id: 'worktree',
    icon: 'folder',
    name: 'Worktree',
    detail: '21 files changed',
    body: (
      <WorktreeBody
        branch="althar/changelog-entry-for-0-10-0-led-by-your-own-host"
        target="main"
        folder="/Users/balazs/Charrette/althar/changelog-entry-for-0-10-0-led-by-your-own-host/althar"
        files={FILES}
        onToward={fn(async () => null)}
        towardNote="Its commits go to a new pull request into it."
      />
    ),
    actions: [
      { label: 'Move to Local', onClick: fn(), variant: 'quiet' },
      { label: 'VS Code', onClick: fn(), variant: 'quiet', icon: 'external' },
      { label: 'See the changes', onClick: fn(), variant: 'signal', kbd: '⌘D', end: true },
    ],
  },
  {
    id: 'pr1',
    icon: 'pr',
    name: '#635',
    detail: 'Open · checks pass',
    tone: 'you',
    act: { label: 'Merge', onClick: fn() },
    facts: [
      ['Title', 'Runs stay in the pill until they end'],
      ['Checks', '12 pass'],
    ],
  },
  {
    id: 'pr2',
    icon: 'pr',
    name: '#639',
    detail: 'Draft · 1 check fails',
    tone: 'bad',
    act: { label: 'See the check' },
    facts: [
      ['Title', 'Show a run’s address in the pill'],
      ['Checks', '11 pass, 1 fails'],
    ],
    body: <PartLines log lines={[['✗ e2e · macOS\n  run-pill.spec.ts:41 shows the address', '']]} />,
    actions: [{ label: 'Ask the lead to fix it', onClick: fn() }],
  },
  { id: 'issue', icon: Brand.Linear, name: 'DEV-188', detail: 'Runs vanish from the pill' },
  {
    id: 'run',
    icon: 'globe',
    name: 'localhost:5367',
    detail: 'Running',
    tone: 'live',
    actions: [
      { label: 'Open', onClick: fn(), icon: 'external' },
      { label: 'Stop', onClick: fn(), variant: 'quiet', end: true },
    ],
  },
  { id: 'shots', icon: 'image', name: '4 screenshots', detail: 'The pill, light and dark' },
]

const KINDS: ReadonlyArray<PartKind> = [
  { kind: 'pr', icon: 'pr', name: 'A pull request', about: 'Opened from its branch, or one that exists', form: () => null },
  { kind: 'worktree', icon: 'folder', name: 'A worktree', about: 'A checkout of its own, to change code in', form: () => null },
  { kind: 'review', icon: 'answer', name: 'A review', about: 'Of any pull request, by another model', form: () => null },
  { kind: 'issue', icon: 'list', name: 'An issue', about: 'For its lead to read', form: () => null },
  { kind: 'browser', icon: 'globe', name: 'A browser', about: 'A page its lead can see and click', form: () => null },
  { kind: 'access', icon: 'lock', name: 'Access', about: 'Something that asks, given for this task', form: () => null },
]

const meta = {
  title: 'Chrome/TaskParts',
  component: TaskParts,
  parameters: { layout: 'padded' },
  args: { parts: PARTS, kinds: KINDS },
  render: (args) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', minHeight: 560, maxWidth: 900 }}>
      <TaskHeader
        title="Runs show in the pill"
        status={TaskStatus.Yours}
        state="Ready to accept"
        faces={[
          { value: 'talk', label: 'Conversation' },
          { value: 'out', label: 'Outputs' },
        ]}
        face="talk"
        onFace={fn()}
        parts={<TaskParts {...args} />}
        actions={
          <>
            <ChromeButton icon="play" label="Run" onClick={fn()} />
            <ChromeButton icon="more" label="More" compact onClick={fn()} />
          </>
        }
      />
    </div>
  ),
} satisfies Meta<typeof TaskParts>
export default meta
type Story = StoryObj<typeof meta>

/** The bar: the parts' marks, one waiting in its colour, then the faces, Run and the menu where they always are. */
export const InTheBar: Story = {}

/** Open: what waits first, with Merge acting from its row; what runs; the rest as chips. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Parts, 6/ }))
    await expect(within(document.body).getByRole('button', { name: 'Merge' })).toBeVisible()
  },
}

/** Merge pressed: its pull request's row says In the merge queue as the runtime reads it, with nothing to merge again. */
export const InTheQueue: Story = {
  args: {
    parts: PARTS.map((part) =>
      part.id === 'pr1'
        ? {
            id: part.id,
            icon: part.icon,
            name: part.name,
            detail: 'In the merge queue',
            tone: 'live' as const,
            ...(part.facts === undefined ? {} : { facts: part.facts }),
          }
        : part,
    ),
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Parts, 6/ }))
    await expect(within(document.body).getByText('In the merge queue')).toBeVisible()
    await expect(within(document.body).queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument()
  },
}

/** A part open in place: the worktree, its branch going into main, its folder, what it changed as one bar, See the changes last. */
export const AWorktree: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Parts, 6/ }))
    await userEvent.click(within(document.body).getByRole('button', { name: 'Worktree' }))
  },
}

/** The worktree with its files listed, and pointed at another branch: the one line that holds for it. */
export const AWorktreeOpened: Story = {
  play: async (context) => {
    await AWorktree.play?.(context)
    const body = within(document.body)
    await userEvent.click(body.getByRole('button', { name: 'Show the 21 files' }))
    await expect(body.getAllByRole('listitem')).toHaveLength(21)
    await userEvent.click(body.getByRole('button', { name: /Work toward another branch/ }))
    await expect(body.getByText('Its commits go to a new pull request into it.')).toBeVisible()
  },
}

/** A long branch it goes into, in a narrow window: it shortens in its chip, whole on hover; and a refused branch, back at its field. */
export const AWorktreeLongTarget: Story = {
  args: {
    parts: [
      {
        id: 'worktree',
        icon: 'folder',
        name: 'Worktree',
        detail: '2 files changed',
        body: (
          <WorktreeBody
            branch="althar/retry"
            target="release/0.10.0-hotfix-for-the-long-branch-names"
            folder="~/Charrette/althar/retry"
            files={FILES.slice(0, 2)}
            onToward={async (branch) => `${branch} isn’t a branch of althar.`}
            towardNote="Its branch moves onto it."
          />
        ),
        actions: [{ label: 'See the changes', onClick: fn(), variant: 'signal', kbd: '⌘D', end: true }],
      },
    ],
  },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Parts, 1/ }))
    const body = within(document.body)
    await userEvent.click(body.getByRole('button', { name: 'Worktree' }))
    const target = body.getByRole('button', { name: /Work toward another branch/ })
    await expect(target).toHaveAttribute('title', 'release/0.10.0-hotfix-for-the-long-branch-names')
    await userEvent.click(target)
    await userEvent.type(body.getByRole('textbox', { name: 'Another branch to work toward' }), 'release/9')
    await userEvent.click(body.getByRole('button', { name: 'Work toward it' }))
    await expect(await body.findByRole('alert')).toHaveTextContent('release/9 isn’t a branch of althar.')
  },
}

const workerCopies = (pending: boolean): ReadonlyArray<TaskPartModel> => {
  const worktree = PARTS[0]
  if (worktree === undefined) return []
  // On a worker: where it works is the worker, and its files come to this computer as a copy.
  return [
    {
      ...worktree,
      body: <WorktreeBody branch="althar/runs-pill" target="main" folder={null} place="Linux worker 3f9a2c" files={FILES.slice(0, 6)} />,
      actions: [
        { label: 'See the changes', onClick: fn() },
        { label: pending ? 'Copying…' : 'Copy to this Mac…', onClick: fn(), disabled: pending, variant: 'quiet', icon: 'download' },
      ],
    },
  ]
}

export const WorkerCopy: Story = {
  args: { parts: workerCopies(false) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Parts, 1/ }))
    await userEvent.click(within(document.body).getByRole('button', { name: 'Worktree' }))
  },
}

export const SavingWorkerCopy: Story = {
  ...WorkerCopy,
  args: { parts: workerCopies(true) },
}

/** A failing check, open: its last lines and Ask the lead to fix it. */
export const AFailingCheck: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Parts, 6/ }))
    await userEvent.click(within(document.body).getByRole('button', { name: /#639/ }))
  },
}

/** Add: what a task can take on. */
export const Add: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Parts, 6/ }))
    await userEvent.click(within(document.body).getByRole('button', { name: 'Add' }))
  },
}
