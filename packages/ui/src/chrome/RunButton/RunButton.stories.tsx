import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { type RunTarget, RunButton } from './RunButton'

/* What althar runs: its repository's own way first, then what the person and the coordinator kept. */
const MANY: RunTarget[] = [
  { id: 'dev', name: 'Public site', command: 'bun run dev', from: 'repository' },
  { id: 'storybook', name: 'Storybook', command: 'bun --filter @althar/ui storybook', from: 'person' },
  { id: 'desktop', name: 'Desktop app', command: 'bun --filter @althar/desktop dev', from: 'coordinator' },
  { id: 'site', name: 'Site preview', command: 'bun run site', from: 'person' },
  { id: 'e2e', name: 'Desktop end-to-end tests', command: 'bun --filter @althar/desktop test:e2e', from: 'agent' },
]

/* Several at once: the public site up, Storybook starting, the desktop app stopped a while ago. */
const BUSY: RunTarget[] = [
  { ...MANY[0]!, run: { state: 'running', url: 'localhost:5320', since: '12m' } },
  { ...MANY[1]!, run: { state: 'starting' } },
  { ...MANY[2]!, run: { state: 'ended', code: null, stopped: true, since: '3m ago' } },
  MANY[3]!,
  MANY[4]!,
]

/* On a pull request: one fetching, one that couldn't be fetched, one that ended by itself, not well. */
const FAILED: RunTarget[] = [
  { ...MANY[0]!, run: { state: 'running', url: 'localhost:5320', since: '2m' } },
  { ...MANY[1]!, run: { state: 'ended', code: 1, since: '1m ago' } },
  { ...MANY[2]!, run: { state: 'fetching' } },
  {
    ...MANY[3]!,
    run: { state: 'unfetched', since: 'just now', why: 'Althar couldn’t reach origin to fetch feature/payouts. Check you’re online.' },
  },
  MANY[4]!,
]

/* A large project: twenty-four to run. */
const LARGE: RunTarget[] = [
  ...MANY,
  ...[
    'Admin',
    'Checkout',
    'Merchant portal',
    'Marketing site',
    'Status page',
    'Email previews',
    'Mobile (Expo)',
    'Webhooks',
    'Ledger service',
    'Payouts service',
    'Search',
    'Postgres',
    'Redis',
    'Mock bank',
    'Auth server',
    'GraphQL playground',
    'Bundle analyzer',
    'Traces',
    'Mail catcher',
  ].map((name): RunTarget => ({
    id: name.toLowerCase().replaceAll(/\W+/g, '-'),
    name,
    command: `bun --filter ${name.toLowerCase()} dev`,
    from: 'person',
  })),
]

const meta = {
  title: 'Chrome/RunButton',
  component: RunButton,
  args: { targets: MANY, onRun: fn(), onStop: fn(), onOpen: fn(), onClear: fn(), onAdd: fn(), onEdit: fn() },
  decorators: [(Story) => <div style={{ display: 'flex', justifyContent: 'flex-end', width: 560, minHeight: 600 }}>{Story()}</div>],
} satisfies Meta<typeof RunButton>
export default meta
type Story = StoryObj<typeof meta>

/** A press only opens the list: nothing runs until it is picked there, the first included. */
export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Run' }))
    await expect(args.onRun).not.toHaveBeenCalled()
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Run Public site' }))
    await expect(args.onRun).toHaveBeenCalledWith('dev')
  },
}

/** Listed, each with what it runs, in the person's order; adding and the whole list at its foot. */
export const Listed: Story = { args: { defaultOpen: true } }

/** Several running: still Run, with how many after it. Those first, with where they answer and Stop; the rest with how they last ended. */
export const SeveralRunning: Story = {
  args: { targets: BUSY, defaultOpen: true },
  play: async ({ args, canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /^Run.*1 running/ })).toBeInTheDocument()
    const page = within(document.body)
    await expect(await page.findByText('localhost:5320')).toBeInTheDocument()
    await expect(page.getByText('Stopped 3m ago')).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Stop Public site' }))
    await expect(args.onStop).toHaveBeenCalledWith('dev')
    await userEvent.click(page.getByText('localhost:5320'))
    await expect(args.onOpen).toHaveBeenCalledWith('dev')
    await userEvent.click(page.getByRole('button', { name: 'Run Site preview' }))
    await expect(args.onRun).toHaveBeenCalledWith('site')
  },
}

/** Something failed: the button says how many in red; each line says what, with its way out. */
export const Failed: Story = {
  args: { targets: FAILED, defaultOpen: true },
  play: async ({ args, canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /^Run.*2 failed/ })).toBeInTheDocument()
    const page = within(document.body)
    await expect(await page.findByText('Exited 1')).toBeInTheDocument()
    await expect(page.getByText('Couldn’t fetch')).toBeInTheDocument()
    await expect(page.getByText('Fetching…')).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Try again' }))
    await expect(args.onRun).toHaveBeenCalledWith('site')
    await userEvent.click(page.getByRole('button', { name: 'Clear Storybook' }))
    await expect(args.onClear).toHaveBeenCalledWith('storybook')
  },
}

/** A large project: the list opens on a field to find in; the arrows move and Enter runs. */
export const Large: Story = {
  args: { targets: LARGE, defaultOpen: true },
  play: async ({ args }) => {
    const page = within(document.body)
    const field = await page.findByRole('textbox', { name: 'Find something to run' })
    await expect(field).toHaveFocus()
    await userEvent.type(field, 'serv')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(args.onRun).toHaveBeenCalledWith('payouts-service')
  },
}

/** Nothing known to run: the ways to say what runs. */
export const Empty: Story = {
  args: { targets: [], defaultOpen: true },
  play: async ({ args }) => {
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: /Ask the coordinator/ }))
    await expect(args.onAdd).toHaveBeenCalledWith('ask')
  },
}
