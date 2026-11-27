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

/** Started: its check running, a test run of its sandbox and agents. */
export const StartedWaiting: Story = {
  args: {
    setup: {
      ...RUNNING,
      phase: 'running',
      at: 5,
      facts: 'Linux · arm64 · 62 GB free',
      version: '0.11.0',
    },
  },
}

/** Checked: its sandbox started and its agents did, so it can run a task; waiting for it to connect. */
export const Checked: Story = {
  args: {
    setup: {
      ...RUNNING,
      phase: 'done',
      at: 6,
      facts: 'Linux · x64 · 62 GB free',
      version: '0.3.0',
      checked: 'Its sandbox starts. Sign its agents in on its sheet.',
    },
  },
}

const FIX =
  'sudo sh -c \'printf "%s\\n" "abi <abi/4.0>," "include <tunables/global>" "profile althar-worker-bwrap /home/althar/.local/share/althar-worker-program/bundle-*/**/bwrap flags=(unconfined) {" "  userns," "}" > /etc/apparmor.d/althar-worker-bwrap && apparmor_parser -r /etc/apparmor.d/althar-worker-bwrap\''

/** Added, but newer Ubuntu keeps its sandbox from starting: the rule an administrator adds once, and Allow with sudo. */
export const SandboxNeedsRoot: Story = {
  args: {
    onCheckWorker: fn(),
    onAllow: fn(),
    setup: {
      ...RUNNING,
      phase: 'done',
      at: 5,
      facts: 'Linux · x64 · 62 GB free',
      version: '0.3.0',
      canAllow: true,
      problem: {
        title: 'Its agents’ sandbox can’t start on build-box.',
        body: 'This Linux lets only programs it names make the namespaces the sandbox needs. Allow the worker’s once, as an administrator:',
        command: FIX,
        retry: true,
      },
    },
  },
}

export const SandboxNeedsRootDark: Story = { ...SandboxNeedsRoot, globals: { theme: 'dark' } }

/** Its login can’t use sudo without a password: the command stays, for its administrator, and Check again. */
export const SandboxNeedsAdministrator: Story = {
  args: {
    onCheckWorker: fn(),
    onAllow: fn(),
    setup: {
      ...RUNNING,
      phase: 'done',
      at: 5,
      facts: 'Linux · x64 · 62 GB free',
      version: '0.3.0',
      problem: {
        title: 'Its agents’ sandbox can’t start on build-box.',
        body: 'Its login can’t use sudo without a password. Have its administrator run this once, then check again:',
        command: FIX,
        retry: true,
      },
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

/** No release can add a worker yet: said for both ways, before anything is pressed. */
export const NoReleaseWithWorkers: Story = {
  args: {
    unavailable: {
      title: 'There’s no Althar release with workers yet.',
      body: 'The newest host release, 0.1.0, came before workers. Check again once a newer one is out.',
    },
    onCheck: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.queryByLabelText('SSH address')).not.toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Check again' }))
    await expect(args.onCheck).toHaveBeenCalled()
  },
}

/** A step that failed: a short line, what it said in Althar's log. */
export const AStepFailed: Story = {
  args: {
    setup: {
      ...RUNNING,
      phase: 'failed',
      at: 2,
      facts: 'Linux · arm64 · 62 GB free',
      problem: { title: 'The release couldn’t get to build-box.', retry: true },
    },
  },
}

/** The release couldn't be found out, for the code's line: said, with Check again. */
export const CodeWithoutARelease: Story = {
  args: {
    way: 'code',
    code: {
      command: null,
      failed: 'Couldn’t find out which release to install from. Check your connection, then check again.',
    },
    onCheck: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: 'Check again' }))
    await expect(args.onCheck).toHaveBeenCalled()
  },
}

/** A machine without SSH: a one-time code, and the one line that takes it. */
export const WithACode: Story = {
  args: {
    way: 'code',
    code: {
      command:
        "curl -fsSL https://github.com/AltharIDE/althar/releases/download/host-v0.11.0/althar-worker.sh | ALTHAR_RELEASE_BASE=https://github.com/AltharIDE/althar/releases/download/host-v0.11.0 sh -s -- join 'althar-worker1.eyJob21lSWQiOiJob21lXzA…'",
    },
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getByText(/althar-worker\.sh \| ALTHAR_RELEASE_BASE=\S+\/host-v0\.11\.0 sh -s -- join/)).toBeInTheDocument()
    await expect(page.queryByText(/Works for/)).not.toBeInTheDocument()
  },
}
