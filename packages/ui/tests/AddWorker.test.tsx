import { render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

import { WORKER_FREE } from '../src/fixtures/computers'
import { Brand } from '../src/foundations/brands/brands'
import { AddWorkerDialog, type AddWorkerDialogProps, type WorkerSetupView } from '../src/setup/Computers/AddWorker'
import { AddWorkerByHandDialog, Computers, type ComputersProps, type ComputerWorker } from '../src/setup/Computers/Computers'

/*
 * Add a worker, and a worker's sheet once added (ADR-103): an SSH address or a code; the steps as they go, a host key
 * to trust, where it stopped and what to do; then its projects picked and its agents signed in, each step said.
 */

const dialog = (props: Partial<AddWorkerDialogProps> = {}) => {
  const handlers = {
    onAdd: vi.fn(),
    onTrust: vi.fn(),
    onAgain: vi.fn(),
    onStop: vi.fn(),
    onClose: vi.fn(),
    onWay: vi.fn(),
    onAddress: vi.fn(),
  }
  function Held() {
    const [address, setAddress] = useState(props.address ?? '')
    return (
      <AddWorkerDialog
        home="This Mac"
        way="ssh"
        setup={null}
        code={null}
        {...handlers}
        {...props}
        address={address}
        onAddress={(value) => {
          handlers.onAddress(value)
          setAddress(value)
        }}
      />
    )
  }
  render(<Held />)
  return handlers
}
const running = (change: Partial<WorkerSetupView>): WorkerSetupView => ({ name: 'build-box', phase: 'running', at: 0, ...change })

describe('adding a worker', () => {
  it('takes an SSH address, as for a home, and adds it on Enter', async () => {
    const { onAdd, onWay } = dialog()
    const box = screen.getByRole('dialog', { name: 'Add a worker to This Mac' })
    expect(within(box).getByRole('button', { name: 'Add worker' }).hasAttribute('disabled')).toBe(true)
    await userEvent.type(within(box).getByLabelText('SSH address'), 'build@build-box{Enter}')
    expect(onAdd).toHaveBeenCalledOnce()
    await userEvent.click(within(box).getByRole('radio', { name: 'With a code' }))
    expect(onWay).toHaveBeenCalledWith('code')
  })

  it('says what is wrong with the address at its field', () => {
    dialog({ addressError: 'That isn’t an SSH address.' })
    expect(screen.getByLabelText('SSH address').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toContain('That isn’t an SSH address.')
  })

  it('shows its steps: what each did, the release coming, and Stop while it goes', async () => {
    const { onStop } = dialog({
      setup: running({ at: 2, facts: 'Linux · arm64 · 62 GB free', progress: { fraction: 0.5, megabytes: 148, sending: true } }),
    })
    expect(screen.getByText('build-box')).toBeTruthy()
    expect(screen.getByText('Linux · arm64 · 62 GB free')).toBeTruthy()
    expect(screen.getByText('Sending from this computer · 74 of 148 MB')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('downloads on the machine', () => {
    dialog({ setup: running({ at: 2, progress: { fraction: 0.25, megabytes: 100, sending: false } }) })
    expect(screen.getByText('Downloading · 25 of 100 MB')).toBeTruthy()
  })

  it('asks to trust the machine’s key the first time, with where to read it there', async () => {
    const { onTrust } = dialog({ setup: running({ phase: 'trust', hostKey: { fingerprint: 'SHA256:abc' } }) })
    expect(screen.getByText('Is this build-box’s key?')).toBeTruthy()
    expect(screen.getByText('ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Trust and go on' }))
    expect(onTrust).toHaveBeenCalledOnce()
  })

  it('names the key file of the type the machine offered', () => {
    dialog({ setup: running({ phase: 'trust', hostKey: { fingerprint: 'SHA256:abc', type: 'ECDSA' } }) })
    expect(screen.getByText('ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub')).toBeTruthy()
  })

  it('says where it stopped and what to do; Try again only where it can help', async () => {
    const { onAgain } = dialog({
      setup: running({
        phase: 'failed',
        at: 0,
        problem: {
          title: 'Couldn’t sign in to build-box over SSH.',
          body: 'Check that this works:',
          command: 'ssh build-box',
          retry: true,
        },
      }),
    })
    expect(screen.getByText('Couldn’t sign in to build-box over SSH.')).toBeTruthy()
    expect(screen.getByText('ssh build-box')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onAgain).toHaveBeenCalledOnce()
  })

  it('offers no Try again where nothing can be installed yet', () => {
    dialog({ setup: running({ phase: 'failed', at: 2, problem: { title: 'There’s no Althar release to install yet.', retry: false } }) })
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('once started, waits for it to connect', () => {
    dialog({ setup: running({ phase: 'done', at: 5, version: '0.11.0' }) })
    expect(screen.getByText('0.11.0, signature checked')).toBeTruthy()
    expect(screen.getByText('Signed by This Mac')).toBeTruthy()
    expect(screen.getByText('Starts with the machine, updates itself')).toBeTruthy()
    expect(screen.getByText('Waiting for it to connect…')).toBeTruthy()
  })

  it('gives a code’s line, how long it works, and says when the home couldn’t make one', () => {
    const { unmount } = render(
      <AddWorkerDialog
        home="studio"
        way="code"
        onWay={vi.fn()}
        address=""
        onAddress={vi.fn()}
        onAdd={vi.fn()}
        setup={null}
        onTrust={vi.fn()}
        onAgain={vi.fn()}
        onStop={vi.fn()}
        code={{ command: null, lasts: null }}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Making a code…')).toBeTruthy()
    unmount()
    dialog({ way: 'code', code: { command: "curl … | sh -s -- join 'althar-worker1.x'", lasts: '9 minutes' } })
    expect(screen.getByText("curl … | sh -s -- join 'althar-worker1.x'")).toBeTruthy()
    expect(screen.getByText('Works for 9 minutes')).toBeTruthy()
  })

  it('without SSH here, offers only the code', () => {
    dialog({ ssh: false, code: { command: null, lasts: null, failed: 'The home couldn’t make a code.' } })
    expect(screen.queryByRole('radio', { name: 'Over SSH' })).toBeNull()
    expect(screen.getByText('The home couldn’t make a code.')).toBeTruthy()
  })

  it('by hand, for a home that takes workers by its operator’s certificates', () => {
    render(<AddWorkerByHandDialog home="studio" enabled standalone onClose={vi.fn()} />)
    expect(screen.getByText(/althar-host enroll-worker/)).toBeTruthy()
    expect(screen.queryByText(/configure-workers/)).toBeNull()
  })
})

const ADDED: ComputerWorker = {
  ...WORKER_FREE,
  id: 'wrk_box',
  name: 'build-box',
  managed: true,
  reachable: true,
  projects: [],
  projectIds: [],
  agents: [
    { id: 'claude-code', name: 'Claude Code', mark: Brand.ClaudeCode, signedIn: true },
    { id: 'codex', name: 'Codex', mark: Brand.Codex, signedIn: false },
  ],
}
const sheet = (props: Partial<ComputersProps> = {}) =>
  render(
    <Computers
      home={{ name: 'This Mac', load: null, agents: null }}
      workers={{ enabled: true, list: [ADDED] }}
      opened={ADDED.id}
      onOpen={vi.fn()}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      allProjects={[
        { id: 'proj_m', name: 'meridian' },
        { id: 'proj_s', name: 'site' },
      ]}
      {...props}
    />,
  )

describe('a worker’s sheet', () => {
  it('picks its projects, and signs an agent in that isn’t', async () => {
    const onProjects = vi.fn()
    const onSignIn = vi.fn()
    sheet({ onProjects, onSignIn })
    expect(screen.getByText('Pick the projects it works on. It takes no tasks until one is picked.')).toBeTruthy()
    await userEvent.click(screen.getByRole('checkbox', { name: 'site' }))
    expect(onProjects).toHaveBeenCalledWith(ADDED.id, ['proj_s'])
    expect(screen.getByText('Signed in')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSignIn).toHaveBeenCalledWith(ADDED.id, 'codex')
  })

  it('names its projects where this connection can’t pick them', () => {
    sheet({ workers: { enabled: true, list: [{ ...ADDED, projects: ['meridian'], projectIds: ['proj_m'] }] } })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('meridian')).toBeTruthy()
  })

  it('says each step of a sign-in, a code to enter, a page and a code to paste back, and why it stopped', async () => {
    const onPaste = vi.fn()
    const onCancel = vi.fn()
    const onOpenLink = vi.fn()
    const base = { onSignIn: vi.fn(), onPaste, onCancelSignIn: onCancel, onOpenLink }
    const { rerender } = sheet({ ...base, signingIn: { workerId: ADDED.id, agent: 'codex', step: { kind: 'starting' } } })
    expect(screen.getByText('Starting its sign-in…')).toBeTruthy()
    const at = (step: NonNullable<ComputersProps['signingIn']>['step']) =>
      rerender(
        <Computers
          home={{ name: 'This Mac', load: null, agents: null }}
          workers={{ enabled: true, list: [ADDED] }}
          opened={ADDED.id}
          onOpen={vi.fn()}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          {...base}
          signingIn={{ workerId: ADDED.id, agent: 'codex', step }}
        />,
      )
    at({ kind: 'code', code: 'K7QF-2MXD', page: 'https://auth.openai.com/codex/device' })
    expect(screen.getByText('Enter this code at auth.openai.com/codex/device')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open the page' }))
    expect(onOpenLink).toHaveBeenCalledWith('https://auth.openai.com/codex/device')
    at({ kind: 'browser', link: 'https://claude.ai/oauth', paste: true, refused: 'That code didn’t work.' })
    await userEvent.click(screen.getByRole('button', { name: 'Open the page' }))
    expect(onOpenLink).toHaveBeenCalledWith('https://claude.ai/oauth')
    expect(screen.getByText('That code didn’t work.')).toBeTruthy()
    await userEvent.type(screen.getByLabelText('Code from the page'), ' abc123 ')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onPaste).toHaveBeenCalledWith('abc123')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    at({ kind: 'failed', message: 'The worker couldn’t be reached over SSH.' })
    expect(screen.getByText('The worker couldn’t be reached over SSH.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('says to sign in on the worker itself where this window can’t reach it', () => {
    sheet({ onSignIn: vi.fn(), workers: { enabled: true, list: [{ ...ADDED, reachable: false }] } })
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    expect(screen.getByText('Sign in on the worker itself: this window can’t reach it over SSH.')).toBeTruthy()
  })
})
