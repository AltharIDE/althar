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
        { state: 'exited', node: <Running processes={[CRASHED]} /> },
      ]}
    />
  ),
}
