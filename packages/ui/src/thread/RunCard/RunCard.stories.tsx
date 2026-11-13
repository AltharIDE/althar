import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { RunCard } from './RunCard'

const SERVING = [
  '$ vite --config vite.config.mjs',
  '',
  '  VITE v7.1.4  ready in 312 ms',
  '',
  '  ➜  Local:   http://localhost:5173/',
  '  ➜  Network: use --host to expose',
  '',
  '9:41:07 AM [vite] hmr update /src/thread/RunCard/RunCard.tsx',
  '9:41:12 AM [vite] hmr update /src/thread/RunCard/RunCard.module.css',
  '9:42:30 AM [vite] page reload src/main.tsx',
  '',
].join('\n')

/** Served a while: more than its console shows at once. */
const SERVED = `${SERVING}${Array.from(
  { length: 30 },
  (_, i) =>
    `9:${String(43 + Math.floor(i / 3)).padStart(2, '0')}:${String((i % 3) * 19).padStart(2, '0')} AM [vite] hmr update /src/thread/RunCard/RunCard.${i % 2 === 0 ? 'tsx' : 'module.css'}`,
).join('\n')}\n`

const FAILED = [
  '$ vite --config vite.config.mjs',
  '',
  'error when starting dev server:',
  'Error: Port 5173 is already in use',
  '    at Server.onError (file:///node_modules/vite/dist/node/chunks/dep-CHZK6zbr.js:45596:18)',
  '    at Server.emit (node:events:518:28)',
  '',
].join('\n')

const LONG =
  'cd apps/desktop && ALTHAR_PROFILE="$(mktemp -d -t althar-fresh)" ../../node_modules/.bin/electron-vite dev --inspect --remote-debugging-port=9222'

const meta = {
  title: 'Thread/RunCard',
  component: RunCard,
  decorators: [threadDecorator],
  args: {
    where: 'Add a black cat that wanders the great hall',
    ownThread: true,
    name: 'Dev server',
    command: 'cd web && npm run dev -- --port 5173',
    url: 'localhost:5173',
    output: { text: SERVING },
    onOpen: fn(),
    onStop: fn(),
    onRunAgain: fn(),
  },
} satisfies Meta<typeof RunCard>
export default meta
type Story = StoryObj<typeof meta>

/** Up: what runs, where it answers, to open, Stop, and its console. */
export const Up: Story = {}
/** Before it says where it answers. */
export const Starting: Story = { args: { url: undefined, output: { text: '$ vite --config vite.config.mjs\n' } } }
/** It failed: the line that says why, which opens its console, and Run again. */
export const Failed: Story = {
  args: { ended: { code: 1, stopped: false, last: 'Error: Port 5173 is already in use' }, output: { text: FAILED } },
}
/** It ended by itself, well. */
export const Finished: Story = {
  args: { name: 'Build', command: 'npm run build', ended: { code: 0, stopped: false, last: '✓ built in 2.41s' } },
}
/** Stopped, by the person or as Althar quit. */
export const Stopped: Story = { args: { ended: { code: null, stopped: true } } }
/** In the project's conversation: where it runs, after its address. */
export const ProjectConversation: Story = { args: { where: 'main', ownThread: false } }
/** No name: what the command runs, at a glance, as code. */
export const Unnamed: Story = {
  args: { name: undefined, command: 'cd packages/ui && ../../node_modules/.bin/vp dev --config prototypes/run-card/vite.config.mjs' },
}
/** Its address with nothing to open it with. */
export const NothingToOpen: Story = { args: { onOpen: undefined } }

/** Its console: the command at its head, read for a person; what it printed under it, following the end. */
export const Console: Story = { args: { defaultOutputOpen: true, output: { text: SERVED } } }
/** Its console, as a long command and a failure show it. */
export const ConsoleFailed: Story = {
  args: {
    name: 'Althar, fresh profile',
    command: LONG,
    defaultOutputOpen: true,
    ended: { code: 1, stopped: false, last: 'Error: Port 5173 is already in use' },
    output: { text: FAILED },
  },
}
/** Its console while what it printed is read, and once it can't be. */
export const ConsoleReading: Story = { args: { defaultOutputOpen: true, output: {} } }
export const ConsoleNotKept: Story = {
  args: { defaultOutputOpen: true, ended: { code: null, stopped: true }, output: { error: 'Output not kept.' } },
}

export const Opening: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Open localhost:5173' }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
    await userEvent.click(c.getByRole('button', { name: 'Stop Dev server' }))
    await expect(args.onStop).toHaveBeenCalledOnce()
  },
}

export const OpeningItsConsole: Story = {
  args: { onOutputOpenChange: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Output' }))
    await expect(args.onOutputOpenChange).toHaveBeenCalledWith(true)
    const panel = within(canvasElement.ownerDocument.body).getByRole('dialog', { name: 'Output of Dev server' })
    await expect(within(panel).getByText('9:42:30 AM [vite] page reload src/main.tsx')).toBeVisible()
    await expect(within(panel).getByRole('button', { name: 'Copy command' })).toBeVisible()
  },
}

export const WhyOpensItsConsole: Story = {
  args: { ...Failed.args, onOutputOpenChange: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button', { name: /^Stop/ })).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Error: Port 5173 is already in use' }))
    await expect(args.onOutputOpenChange).toHaveBeenCalledWith(true)
    await userEvent.keyboard('{Escape}')
    await userEvent.click(c.getByRole('button', { name: 'Run Dev server again' }))
    await expect(args.onRunAgain).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'starting', node: <RunCard {...args} url={undefined} /> },
        { state: 'up', node: <RunCard {...args} /> },
        { state: 'failed', node: <RunCard {...args} {...Failed.args} /> },
        { state: 'failed, nothing said', node: <RunCard {...args} ended={{ code: 1, stopped: false }} /> },
        { state: 'finished', node: <RunCard {...args} {...Finished.args} /> },
        { state: 'stopped', node: <RunCard {...args} ended={{ code: null, stopped: true }} /> },
        { state: 'project, up', node: <RunCard {...args} where="main" ownThread={false} /> },
        {
          state: 'project, failed',
          node: (
            <RunCard
              {...args}
              ownThread={false}
              ended={{
                code: 137,
                stopped: false,
                last: 'Error: listen EADDRINUSE: address already in use :::5173, while starting the preview',
              }}
            />
          ),
        },
        { state: 'unnamed', node: <RunCard {...args} {...Unnamed.args} /> },
        {
          state: 'long',
          node: (
            <RunCard
              {...args}
              name="Rate-limit refunds the way charges are, per partner, on its own port"
              command={LONG}
              ownThread={false}
            />
          ),
        },
      ]}
    />
  ),
}
