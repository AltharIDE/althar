import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { RunConsole } from '../../thread/RunCard/RunCard'
import { TerminalSession } from '../TerminalView/session'
import { TerminalView } from '../TerminalView/TerminalView'
import { RunMark, RunWords, StatusDrawer, type StatusItem, StatusLine } from './StatusLine'

/* The person's iOS run that failed, Storybook up, and two terminals: one idle, one with bun running in it. */
const ITEMS: StatusItem[] = [
  { kind: 'run', id: 'ios', name: 'iOS simulator', phase: 'failed', code: 1 },
  { kind: 'run', id: 'sb', name: 'Storybook', phase: 'up', url: 'http://localhost:6006/' },
  { kind: 'run', id: 'site', name: 'Public site', phase: 'starting' },
  { kind: 'terminal', id: 't1', name: 'althar' },
  { kind: 'terminal', id: 't2', name: 'Runs and a terminal', busy: 'bun' },
]

const IOS_OUTPUT = `$ expo run:ios
› Building app...
› Compiling althar-mobile » AppDelegate.mm
error: log file changed but frozen: ios/build/Logs/Build/LogStoreManifest.plist
TypeError: Cannot read properties of undefined (reading 'scheme')
    at resolveScheme (node_modules/@expo/cli/build/src/run/ios/options.js:42:31)
`

const meta = {
  title: 'Chrome/StatusLine',
  component: StatusLine,
  parameters: { layout: 'fullscreen' },
  args: { items: ITEMS, onPress: fn(), onDismiss: fn(), onNewTerminal: fn(), newTerminalKbd: 'Ctrl `' },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          height: 560,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          background: 'var(--n-2)',
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StatusLine>

export default meta
type Story = StoryObj<typeof meta>

/** At rest: each run by its mark, name and how it stands; each terminal by where it is, and what runs in it in front. */
export const AtRest: Story = {}

/** One run, the person's: what shows as soon as Run is pressed. */
export const Starting: Story = { args: { items: [{ kind: 'run', id: 'ios', name: 'iOS simulator', phase: 'starting' }] } }

/** A narrow window: an address and what runs in a terminal give way first, a name keeps a few letters, how a run failed stays whole. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 520 }}>
        <Story />
      </div>
    ),
  ],
}

/** Closing a terminal with something running in it asks first, in its mark's place. */
export const AsksBeforeStopping: Story = {
  play: async ({ canvasElement, args }) => {
    const line = within(canvasElement)
    await userEvent.click(line.getByRole('button', { name: 'Close Runs and a terminal' }))
    const ask = within(document.body).getByRole('dialog', { name: 'Close terminal' })
    await expect(ask).toHaveTextContent('bun is still running in it. Closing the terminal stops it.')
    await expect(args.onDismiss).not.toHaveBeenCalled()
  },
}

/** A run that ended goes at once, with no ask. */
export const EndedGoesAtOnce: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Close iOS simulator' }))
    await expect(args.onDismiss).toHaveBeenCalledWith('ios')
  },
}

/** The drawer, raised on the failed run: its output, with its ways out. */
export const DrawerOnARun: Story = {
  render: (args) => (
    <>
      <StatusDrawer
        label="Runs and terminals drawer"
        height={360}
        max={480}
        onHeight={() => {}}
        onLower={() => {}}
        title={
          <>
            <RunMark phase="failed" />
            <strong style={{ fontWeight: 500 }}>iOS simulator</strong>
            <RunWords item={{ kind: 'run', id: 'ios', name: 'iOS simulator', phase: 'failed', code: 1 }} />
          </>
        }
      >
        <RunConsole command="bunx expo run:ios" output={{ text: IOS_OUTPUT }} running={false} exit={1} fill />
      </StatusDrawer>
      <StatusLine {...args} chosen="ios" />
    </>
  ),
}

/** A terminal that echoes what is typed, as a shell would, in the drawer: its keys, find and colours. */
function EchoTerminal() {
  const session = useMemo(() => {
    const made: TerminalSession = new TerminalSession({
      onData: (data) => made.write(data === '\r' ? '\r\n\x1b[32m~/althar\x1b[0m $ ' : data),
      onResize: () => {},
    })
    made.write('\x1b[32m~/althar\x1b[0m $ bun install\r\n\x1b[2mbun install v1.3.4\x1b[0m\r\n\r\n')
    made.write('\x1b[32m+\x1b[0m @xterm/xterm@6.0.0\r\n\x1b[32m+\x1b[0m node-pty@1.1.0\r\n\r\n')
    made.write(' \x1b[1m2847\x1b[0m packages installed \x1b[2m[1.92s]\x1b[0m\r\n')
    made.write('\x1b[32m~/althar\x1b[0m $ ')
    return made
  }, [])
  const [height, setHeight] = useState(340)
  return (
    <StatusDrawer
      label="Runs and terminals drawer"
      height={height}
      max={480}
      onHeight={setHeight}
      onLower={() => {}}
      title={<strong style={{ fontWeight: 500 }}>althar</strong>}
    >
      <TerminalView session={session} autoFocus />
    </StatusDrawer>
  )
}

export const DrawerOnATerminal: Story = {
  render: (args) => (
    <>
      <EchoTerminal />
      <StatusLine {...args} chosen="t1" />
    </>
  ),
}
