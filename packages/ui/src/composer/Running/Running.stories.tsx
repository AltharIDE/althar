import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { Running, type RunningProcess } from './Running'

const DEV: RunningProcess = {
  id: 'dev',
  command: 'bun dev',
  url: 'localhost:5173',
  since: '12m',
}
const WATCH: RunningProcess = {
  id: 'watch',
  command: 'bun test --watch src/refunds',
  since: '4m',
}
const STRIPE: RunningProcess = {
  id: 'stripe',
  command: 'stripe listen --forward-to localhost:5173/webhooks',
  since: '9m',
}
const CRASHED: RunningProcess = {
  id: 'worker',
  command: 'bun run worker',
  since: '2m ago',
  exited: 1,
}

/** What a lead's `vite dev` is, as it named it, with the command it ran, and where it was found to answer. */
const SITE: RunningProcess = {
  id: 'site',
  name: 'Site dev server',
  command: 'cd /Users/balazs/Charrette/althar/site/althar && node_modules/.bin/vp dev --config ../../a/vite.config.ts 2>&1 | tail -20',
  label: 'vp dev',
  url: 'localhost:5173',
  since: '6m',
}
/** Named, and no address yet: it hasn't printed one, or hasn't started listening. */
const API: RunningProcess = {
  id: 'api',
  name: 'API server, writing to a log file',
  command: 'bun run api --log /tmp/api.log',
  label: 'bun run api --log /tmp/api.log',
  since: '2m',
}

const meta = {
  title: 'Composer/Running',
  component: Running,
  args: { processes: [DEV], onStop: fn(), onDismiss: fn(), onOutput: fn(), onOpenUrl: fn() },
  /* room above for the list, which opens upward; the states grid has no list open */
  decorators: [
    (Story, { parameters }) =>
      parameters.pseudo ? (
        <Story />
      ) : (
        <div style={{ paddingTop: 260 }}>
          <Story />
        </div>
      ),
  ],
} satisfies Meta<typeof Running>
export default meta
type Story = StoryObj<typeof meta>

/** One process: the pill says what it is and where it answers. */
export const OneProcess: Story = {}
export const SeveralProcesses: Story = { args: { processes: [DEV, WATCH, STRIPE] } }
/** One exited on its own: it stays, to say how, until it is dismissed or run again. Nothing is left running, so no dot. */
export const Exited: Story = { args: { processes: [CRASHED] } }
export const Open: Story = { args: { processes: [DEV, WATCH, STRIPE, CRASHED], defaultOpen: true } }
/** Several places run things, as on the coordinator's screen: each says where. */
export const WhereEach: Story = {
  args: {
    defaultOpen: true,
    processes: [
      { ...DEV, where: 'Add a black cat that wanders the great hall' },
      { ...DEV, id: 'main', url: 'localhost:5174', since: '40m', where: 'main' },
      { ...CRASHED, where: 'Bump the version' },
    ],
  },
}
/** One still running and one that exited: the pill names the one running, and says the other exited. */
export const RunningAndExited: Story = {
  args: { processes: [DEV, CRASHED] },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByRole('button', { name: /Running/ })
    await expect(pill).toHaveTextContent('Runningbun dev· localhost:5173· 1 exited')
  },
}
const LONG: RunningProcess = {
  id: 'long',
  command: 'cd /Users/balazs/Charrette/althar/shorten-long-commands-in-running-pills/althar && timeout 600 bun run dev 2>&1 | tail -20',
  label: 'bun run dev',
  url: 'localhost:5173',
  since: '3m',
}
/** The agent's `cd <worktree> && …` and output pipes are left off the pill; the whole command is on hover and in Stop's name. */
export const LongCommand: Story = {
  args: { processes: [LONG], defaultOpen: true },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByRole('button', { name: /Running/ })
    await expect(pill).toHaveTextContent('Runningbun run dev· localhost:5173')
    await expect(within(canvasElement).getByTitle(LONG.command)).toBeVisible()
  },
}
/** A server as its lead named it: the name and where it answers lead; the command at a glance and how long it has run are the quiet line under. */
export const Named: Story = {
  args: { processes: [SITE], defaultOpen: true },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByRole('button', { name: /Running/ })
    await expect(pill).toHaveTextContent('RunningSite dev server· localhost:5173')
    const page = within(document.body)
    await expect(page.getByText('vp dev')).toBeVisible()
    // The whole command is on hover, on the pill and on the row.
    await expect(page.getAllByTitle(SITE.command)).toHaveLength(3)
  },
}
/** Named but with no address, as a server that logs to a file is: Output is the way to see it. */
export const NamedNoAddress: Story = { args: { processes: [API], defaultOpen: true } }
/** Several named servers, each with its address or without, and one exited. */
export const NamedSeveral: Story = { args: { processes: [SITE, API, { ...CRASHED, name: 'Queue worker' }], defaultOpen: true } }
/** A name too long for the popover keeps to two lines; the address and the command under it to one each, the whole on hover. */
export const NamedLong: Story = {
  args: {
    defaultOpen: true,
    processes: [
      {
        ...SITE,
        name: 'Marketing site dev server for the new landing page, with the pricing calculator and the docs preview mounted under it',
        label: 'vp dev --host 0.0.0.0 --port 5173 --strictPort --mode staging --open /pricing/calculator?plan=team&seats=25',
        url: 'my-very-long-branch-name.preview.localhost:5173',
      },
    ],
  },
}
/** Its output isn't kept anywhere to read, as an Althar run's isn't: no Output button on its row. */
export const NoOutput: Story = { args: { processes: [{ ...SITE, output: false }], defaultOpen: true } }

/** A command that can't be shortened still can't stretch the pill: it ends in an ellipsis. */
export const LongUnshortened: Story = {
  args: {
    processes: [{ id: 'sh', command: 'python3 -c "print(' + '1234567890'.repeat(12) + ')"', since: '1m' }],
  },
}
/** Ended by itself, with no exit code to say: it ended, no more. */
export const EndedUnknown: Story = { args: { processes: [{ ...CRASHED, exited: null }] } }
/** Nothing running: nothing shows. */
export const Empty: Story = { args: { processes: [] } }

export const StopOne: Story = {
  render: function Render(args) {
    const [processes, setProcesses] = useState([DEV, WATCH])
    return <Running {...args} processes={processes} onStop={(id) => setProcesses((v) => v.filter((x) => x.id !== id))} />
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: /Running/ }))
    await userEvent.click(await page.findByRole('button', { name: 'Stop bun test --watch src/refunds' }))
    await expect(page.queryByText('bun test --watch src/refunds')).toBeNull()
    await expect(c.getByRole('button', { name: /bun dev/ })).toBeInTheDocument()
  },
}

export const OpensWhereItAnswers: Story = {
  args: { defaultOpen: true },
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Open localhost:5173' }))
    await expect(args.onOpenUrl).toHaveBeenCalledWith('dev')
    await userEvent.click(page.getByRole('button', { name: 'Show the output of bun dev' }))
    await expect(args.onOutput).toHaveBeenCalledWith('dev')
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: () => (
    <States
      size="wide"
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <Running processes={[DEV]} /> })),
        { state: 'several', node: <Running processes={[DEV, WATCH, STRIPE]} /> },
        { state: 'named', node: <Running processes={[SITE]} /> },
        { state: 'named, no address', node: <Running processes={[API]} /> },
        { state: 'exited', node: <Running processes={[CRASHED]} /> },
        { state: 'running and exited', node: <Running processes={[DEV, CRASHED]} /> },
        { state: 'ended, code unknown', node: <Running processes={[{ ...CRASHED, exited: null }]} /> },
      ]}
    />
  ),
}
