import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { DictationSetup } from '../../foundations/vocabulary'
import { States, statesParameters } from '../../storybook/States'
import { DictationTray, type DictationState } from './DictationTray'

const OFFER: DictationState = { kind: DictationSetup.Offer, size: '480 MB' }
const DOWNLOADING: DictationState = {
  kind: DictationSetup.Downloading,
  got: '198 MB',
  size: '480 MB',
  left: 'about 20 s',
  progress: 198 / 480,
}
const STOPPED: DictationState = { kind: DictationSetup.Stopped, got: '291 MB', size: '480 MB', progress: 291 / 480 }

const meta = {
  title: 'Composer/DictationTray',
  component: DictationTray,
  args: {
    state: OFFER,
    onDownload: fn(),
    onCancel: fn(),
    onRetry: fn(),
    onOpenSettings: fn(),
    onDiscard: fn(),
    onDismiss: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 680, paddingTop: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DictationTray>
export default meta
type Story = StoryObj<typeof meta>

/** The first press, with no speech model on this Mac: what it is, its size, and the way to get it. */
export const Offer: Story = {}
/** macOS is asking whether Althar may use the microphone; the tray waits with it. */
export const Asking: Story = { args: { state: { kind: DictationSetup.Asking } } }
/** Coming down: the tray's bottom edge is the bar. The field under it stays yours. */
export const Downloading: Story = { args: { state: DOWNLOADING } }
/** Down, and being checked and loaded before it listens. */
export const Preparing: Story = { args: { state: { kind: DictationSetup.Preparing } } }
/** The connection dropped partway; it carries on from where it stopped. */
export const Stopped: Story = { args: { state: STOPPED } }
/** The disk hasn't room for what is left of the model. */
export const NoRoom: Story = { args: { state: { kind: DictationSetup.NoRoom, need: '670 MB', free: '212 MB' } } }
/** The microphone was refused before: only System Settings can change it. */
export const Denied: Story = { args: { state: { kind: DictationSetup.Denied } } }
export const NoMicrophone: Story = { args: { state: { kind: DictationSetup.NoMicrophone } } }
/** What was said couldn't be written down; the recording is kept to try again. */
export const Failed: Story = { args: { state: { kind: DictationSetup.Failed, said: '0:12' } } }
/** Without callbacks there is nothing to press: the tray only says where things stand. */
export const NoActions: Story = {
  args: {
    state: DOWNLOADING,
    onDownload: undefined,
    onCancel: undefined,
    onRetry: undefined,
    onOpenSettings: undefined,
    onDiscard: undefined,
    onDismiss: undefined,
  },
}
/** Narrow: the actions go under the words. */
export const Narrow: Story = {
  args: { state: { kind: DictationSetup.Denied } },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 340 }}>
        <Story />
      </div>
    ),
  ],
}

/** Shown with nothing focused, the first action takes focus; Escape closes the tray. */
export const FocusAndEscape: Story = {
  render: function Render(args) {
    const [open, setOpen] = useState(false)
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          Dictate
        </button>
        {open && <DictationTray {...args} onDismiss={() => setOpen(false)} />}
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Dictate' }))
    await expect(c.getByRole('button', { name: 'Download' })).toHaveFocus()
    await expect(c.getByRole('status')).toHaveTextContent('Dictation needs a speech model on this Mac')
    await userEvent.keyboard('{Escape}')
    await expect(c.queryByRole('group', { name: 'Dictation' })).toBeNull()
  },
}

/** Typing in a field beside it, a stopped download doesn't take your focus. */
export const KeepsTyping: Story = {
  render: function Render(args) {
    const [state, setState] = useState<DictationState>(DOWNLOADING)
    return (
      <div>
        <DictationTray {...args} state={state} />
        <textarea aria-label="Tell the lead" onChange={() => setState(STOPPED)} />
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const field = c.getByRole('textbox', { name: 'Tell the lead' })
    await userEvent.type(field, 'a')
    await expect(c.getByText('The download stopped')).toBeInTheDocument()
    await expect(field).toHaveFocus()
  },
}

/* The buttons inside are the kit's own, with their hover, focus and pressed states in their stories. */
export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'offer', node: <DictationTray {...args} state={OFFER} /> },
        { state: 'asking', node: <DictationTray {...args} state={{ kind: DictationSetup.Asking }} /> },
        { state: 'downloading', node: <DictationTray {...args} state={DOWNLOADING} /> },
        { state: 'preparing', node: <DictationTray {...args} state={{ kind: DictationSetup.Preparing }} /> },
        { state: 'stopped', node: <DictationTray {...args} state={STOPPED} /> },
        { state: 'no room', node: <DictationTray {...args} state={{ kind: DictationSetup.NoRoom, need: '670 MB', free: '212 MB' }} /> },
        { state: 'denied', node: <DictationTray {...args} state={{ kind: DictationSetup.Denied }} /> },
        { state: 'no microphone', node: <DictationTray {...args} state={{ kind: DictationSetup.NoMicrophone }} /> },
        { state: 'failed', node: <DictationTray {...args} state={{ kind: DictationSetup.Failed, said: '0:12' }} /> },
      ]}
    />
  ),
}
