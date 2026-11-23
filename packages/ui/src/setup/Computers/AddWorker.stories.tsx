import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { AddWorkerDialog, type AddWorkerDialogProps } from './AddWorker'

/** The dialog as Settings › Computers holds it: the way and the address are its own. */
function Held(props: Partial<AddWorkerDialogProps>) {
  const [way, setWay] = useState<'ssh' | 'code'>(props.way ?? 'ssh')
  const [address, setAddress] = useState(props.address ?? '')
  return (
    <AddWorkerDialog
      home="This Mac"
      setup={null}
      code={null}
      onAdd={fn()}
      onTrust={fn()}
      onAgain={fn()}
      onStop={fn()}
      onClose={fn()}
      {...props}
      way={way}
      onWay={setWay}
      address={address}
      onAddress={setAddress}
    />
  )
}

const meta = {
  title: 'Setup/Computers/Add a worker',
  component: Held,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Held>
export default meta
type Story = StoryObj<typeof meta>

const RUNNING = { name: 'build-box', phase: 'running' as const }

/** An SSH address, as for a home: Althar installs the worker there. */
export const OverSsh: Story = {
  args: { onAdd: fn() },
  play: async ({ canvasElement, args }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.type(page.getByLabelText('SSH address'), 'build@build-box')
    await userEvent.click(page.getByRole('button', { name: 'Add worker' }))
    await expect(args.onAdd).toHaveBeenCalled()
  },
}

/** The machine's SSH key, seen for the first time: the person's to trust. */
export const TrustItsKey: Story = {
  args: { setup: { ...RUNNING, phase: 'trust', at: 0, hostKey: { fingerprint: 'SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8' } } },
}

/** Installing: the release coming down to the machine, checked against Althar's key. */
export const Installing: Story = {
  args: {
    setup: { ...RUNNING, at: 2, facts: 'Linux · arm64 · 62 GB free', progress: { fraction: 0.42, megabytes: 148, sending: false } },
  },
}

/** Started, with a line left for its administrator: its login doesn't linger, so it would stop at logout. */
export const StartedWaiting: Story = {
  args: {
    setup: {
      ...RUNNING,
      phase: 'done',
      at: 5,
      facts: 'Linux · arm64 · 62 GB free',
      version: '0.11.0',
      linger: 'sudo loginctl enable-linger -- build',
    },
  },
}

/** Nothing to install yet: no release is published. */
export const NothingToInstall: Story = {
  args: {
    setup: {
      ...RUNNING,
      phase: 'failed',
      at: 2,
      facts: 'Linux · arm64 · 62 GB free',
      problem: { title: 'There’s no Althar release to install yet.', body: 'Set the worker up by hand for now.', retry: false },
    },
  },
}

/** A machine without SSH: a one-time code, and the one line that takes it. */
export const WithACode: Story = {
  args: {
    way: 'code',
    code: {
      command:
        "curl -fsSL https://github.com/AltharIDE/althar/releases/download/host-v0.11.0/althar-worker.sh | sh -s -- join 'althar-worker1.eyJob21lSWQiOiJob21lXzA…'",
      lasts: '10 minutes',
    },
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getByText(/althar-worker\.sh \| sh -s -- join/)).toBeInTheDocument()
    await expect(page.getByText('Works for 10 minutes')).toBeInTheDocument()
  },
}
