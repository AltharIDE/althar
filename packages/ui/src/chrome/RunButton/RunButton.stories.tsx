import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { type RunTarget, RunButton } from './RunButton'

/* What althar runs, on its default branch: its repository's own way first, then what the person and the coordinator kept. */
const MANY: RunTarget[] = [
  { id: 'dev', name: 'Public site', command: 'bun run dev', where: 'main', from: 'repository' },
  { id: 'storybook', name: 'Storybook', command: 'bun --filter @althar/ui storybook', where: 'main', from: 'person' },
  { id: 'desktop', name: 'Desktop app', command: 'bun --filter @althar/desktop dev', where: 'main', from: 'coordinator' },
  { id: 'site', name: 'Site preview', command: 'bun run site', where: 'main', from: 'person' },
  { id: 'e2e', name: 'Desktop end-to-end tests', command: 'bun --filter @althar/desktop test:e2e', where: 'main', from: 'agent' },
]

/* Several at once: the public site up, Storybook starting, the end-to-end tests failed a while ago. */
const BUSY: RunTarget[] = [
  { ...MANY[0]!, run: { state: 'running', url: 'localhost:5320', since: '12m' } },
  { ...MANY[1]!, run: { state: 'starting' } },
  MANY[2]!,
  { ...MANY[3]!, run: { state: 'ended', code: 0, since: '3m ago' } },
  { ...MANY[4]!, run: { state: 'ended', code: 1, since: '8m ago' } },
]

const meta = {
  title: 'Chrome/RunButton',
  component: RunButton,
  args: { targets: MANY, onRun: fn(), onStop: fn(), onOpen: fn(), onAdd: fn(), onEdit: fn() },
  decorators: [(Story) => <div style={{ display: 'flex', justifyContent: 'flex-end', width: 520, minHeight: 460 }}>{Story()}</div>],
} satisfies Meta<typeof RunButton>
export default meta
type Story = StoryObj<typeof meta>

/** One press runs the default, the first of the list, as the one Run button did. */
export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Run Public site' }))
    await expect(args.onRun).toHaveBeenCalledWith('dev')
  },
}

/** The chevron lists everything, each with what it runs, where, and who said how; the default says so. */
export const Listed: Story = { args: { defaultOpen: true } }

/** Several running: those first, checked, with where they answer; the rest with how they last ended. Picking one starts or stops it. */
export const SeveralRunning: Story = {
  args: { targets: BUSY, defaultOpen: true },
  play: async ({ args }) => {
    const page = within(document.body)
    const running = await page.findByRole('menuitemcheckbox', { name: 'Public site' })
    await expect(running).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText('localhost:5320')).toBeInTheDocument()
    await expect(page.getByText(/Failed 8m ago · exit 1/)).toBeInTheDocument()
    await expect(page.getByText(/Finished 3m ago/)).toBeInTheDocument()
    await userEvent.click(running)
    await expect(args.onStop).toHaveBeenCalledWith('dev')
    await userEvent.click(page.getByRole('menuitemcheckbox', { name: 'Desktop app' }))
    await expect(args.onRun).toHaveBeenCalledWith('desktop')
    await userEvent.click(page.getByRole('menuitem', { name: 'Add something to run…' }))
    await expect(args.onAdd).toHaveBeenCalledWith('type')
  },
}

/** While the default runs, the button says where it answers, and opens it. */
export const DefaultRunning: Story = {
  args: { targets: BUSY },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Public site · localhost:5320' }))
    await expect(args.onOpen).toHaveBeenCalledWith('dev')
  },
}

/** Starting, it waits. */
export const DefaultStarting: Story = { args: { targets: [{ ...MANY[0]!, run: { state: 'starting' } }, ...MANY.slice(1)] } }

/** Running with no address, as the desktop app's window: the button opens the list. */
export const RunningWithNoAddress: Story = {
  args: { targets: [{ ...MANY[2]!, run: { state: 'running', since: '2m' } }, MANY[0]!] },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Desktop app' }))
    const page = within(document.body)
    await userEvent.click(await page.findByRole('menuitem', { name: 'Edit the list…' }))
    await expect(args.onEdit).toHaveBeenCalledOnce()
  },
}

/** On a task: what runs in its worktree, and its default running on main instead. */
export const OnATask: Story = {
  args: {
    targets: [
      { ...MANY[0]!, where: 'this task', elsewhere: { where: 'on main', url: 'localhost:5320' } },
      { ...MANY[1]!, where: 'this task', run: { state: 'running', url: 'localhost:6007', since: '4m' } },
      { ...MANY[2]!, where: 'this task' },
    ],
    defaultOpen: true,
  },
}

/** The one its repository says, unnamed, as light as the one button was. */
export const One: Story = { args: { targets: [{ id: 'dev', command: 'bun run dev', where: 'main', from: 'repository' }] } }

/** Nothing known to run: the three ways to say what runs. */
export const NothingYet: Story = {
  args: { targets: [], defaultOpen: true },
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('menuitem', { name: 'Ask the coordinator to work it out' }))
    await expect(args.onAdd).toHaveBeenCalledWith('ask')
  },
}

const LONG =
  'export PATH="$HOME/.bun/bin:$PATH"; unset ELECTRON_RUN_AS_NODE; P=$(pwd); cd apps/desktop && bun run build && cd "$P" && exec zypak-wrapper electron apps/desktop --no-sandbox'

/** A long unnamed command, from an agent: the button says the last thing it runs, cut short, in a narrow bar beside a title; the full command is its tooltip. */
export const LongCommand: Story = {
  args: { targets: [{ id: 'long', command: LONG, where: 'main', from: 'agent' }] },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: 260, minHeight: 60 }}>
        <strong style={{ minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Althar
        </strong>
        {Story()}
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: /^Run zypak-wrapper/ })
    await expect(button).toHaveAttribute('title', LONG)
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(260)
  },
}

/** Running, the same long command with its address, still cut short. */
export const LongCommandRunning: Story = {
  args: {
    targets: [{ id: 'long', command: LONG, where: 'main', from: 'agent', run: { state: 'running', url: 'localhost:5290', since: '1m' } }],
  },
  decorators: LongCommand.decorators!,
}

/** Two unnamed commands that end the same read the same by their label; each row's description keeps its whole command to tell them apart. */
export const SameLabel: Story = {
  args: {
    defaultOpen: true,
    targets: [
      { id: 'a', command: 'cd apps/a && bun run dev', where: 'main', from: 'agent' },
      { id: 'b', command: 'cd apps/b && bun run dev', where: 'main', from: 'agent' },
    ],
  },
  play: async () => {
    const page = within(document.body)
    await expect(page.getByText(/^cd apps\/a && bun run dev/)).toBeInTheDocument()
    await expect(page.getByText(/^cd apps\/b && bun run dev/)).toBeInTheDocument()
  },
}

/** Where the screen runs the default branch, the list offers a branch or a pull request too, in a copy of its own. */
export const RunABranch: Story = {
  args: { onRunBranch: fn(), defaultOpen: true },
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('menuitem', { name: 'Run a branch or pull request…' }))
    await expect(args.onRunBranch).toHaveBeenCalled()
  },
}
