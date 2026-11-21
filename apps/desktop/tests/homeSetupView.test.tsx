import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type { CheckedHome, HomeSetup, HomeState, HomesHost, HomesOverview } from '../src/homes'
import { ConnectHome } from '../src/renderer/features/homes/ConnectHome'
import { Chip } from '../src/renderer/features/homes/HomeConnections'
import { homesUi } from '../src/renderer/features/homes/useHomes'

/* Connect a home, set up over SSH: the steps as main runs them, what each press shows at once, and the chip meanwhile. */

const homeId = `home_${'2'.repeat(32)}`
const checked: CheckedHome = {
  checkId: 'opaque-confirmation',
  homeId,
  hostDeviceId: `dev_${'3'.repeat(32)}`,
  version: '0.14.2',
  apiVersion: 1,
  target: 'deploy@vps.test',
}
const local: HomeState = { current: { kind: 'local' }, connection: 'local' }
const empty: HomesOverview = { homes: [], windows: { local: 'local' }, projects: {}, opened: {} }
const setup = (more: Partial<HomeSetup> = {}): HomeSetup => ({
  target: { target: 'deploy@vps.test' },
  phase: 'running',
  at: 0,
  upload: false,
  madeUser: false,
  log: ['$ ssh deploy@vps.test'],
  ...more,
})
const fixture = (first: HomeSetup | null = null) => {
  const listeners = new Set<(setup: HomeSetup | null) => void>()
  const homes = {
    state: vi.fn(async () => local),
    list: vi.fn(async () => []),
    overview: vi.fn(async () => empty),
    inspect: vi.fn(async () => checked),
    connect: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    change: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
    cancelCheck: vi.fn(async () => {}),
    reconnect: vi.fn(async () => {}),
    report: vi.fn(),
    onState: () => () => {},
    onOverview: () => () => {},
    onOpen: () => () => {},
    onProject: () => () => {},
    pair: vi.fn(async () => {}),
    pairingInfo: vi.fn(async () => ({ origin: 'https://vps.test:6769', homeId, expiresAt: Number.MAX_SAFE_INTEGER })),
    setup: vi.fn(async () => first),
    setUp: vi.fn(async () => {}),
    setupAct: vi.fn(async () => {}),
    onSetup: (listener: (setup: HomeSetup | null) => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  } satisfies HomesHost
  return {
    homes,
    tell: (next: HomeSetup | null) =>
      act(() => {
        for (const listener of listeners) listener(next)
      }),
  }
}
const steps = () => within(screen.getByRole('list', { name: /^Setting up / }))
const stateOf = (label: string) => steps().getByText(label).closest('li')?.getAttribute('data-state')

it('opens a first home on what a home is, then sets it up over SSH, step by step, until it connects', async () => {
  const at = fixture()
  const close = vi.fn()
  render(<ConnectHome homes={at.homes} first onClose={close} />)
  expect(screen.getByRole('dialog', { name: 'Your first home' })).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Set one up' }))
  expect(screen.getByRole('dialog', { name: 'Set up a home' })).not.toBeNull()
  expect(screen.getByRole('radio', { name: /Over SSH/ }).getAttribute('aria-checked')).toBe('true')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await userEvent.type(screen.getByLabelText('SSH host'), 'deploy@vps.test')
  await userEvent.click(screen.getByRole('button', { name: 'Set it up' }))
  // At once: the steps, on the first, before main says anything.
  expect(at.homes.setUp).toHaveBeenCalledExactlyOnceWith({ target: 'deploy@vps.test' })
  expect(stateOf('Reach the server')).toBe('now')
  expect(screen.getByRole('button', { name: 'Setting up…' })).not.toBeNull()
  at.tell(
    setup({ at: 2, facts: { arch: 'x64', freeKiB: 22_020_096, git: true }, progress: { bytes: 20 * 1_048_576, total: 40 * 1_048_576 } }),
  )
  expect(stateOf('Look it over')).toBe('done')
  expect(screen.getByText('Linux · x64 · systemd · 21 GB free')).not.toBeNull()
  expect(screen.getByText('Downloading · 20 of 40 MB')).not.toBeNull()
  at.tell(setup({ phase: 'done', at: 5, version: '0.14.2', linger: 'sudo loginctl enable-linger -- deploy' }))
  // Set up: its identity is read by the form's own check, and it's named and connected.
  await waitFor(() => expect(at.homes.inspect).toHaveBeenCalledExactlyOnceWith({ target: 'deploy@vps.test' }))
  expect(await screen.findByText(/althar-host 0\.14\.2 is running on vps\.test/)).not.toBeNull()
  expect(screen.getByText('sudo loginctl enable-linger -- deploy')).not.toBeNull()
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('vps')
  await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
  expect(at.homes.connect).toHaveBeenCalledExactlyOnceWith('opaque-confirmation', 'vps')
  await waitFor(() => expect(close).toHaveBeenCalledOnce(), { timeout: 2000 })
  expect(at.homes.setupAct).toHaveBeenCalledWith('dismiss')
})

it('says where a setup stopped and what to do, and Try again picks up there', async () => {
  const at = fixture(setup({ phase: 'failed', at: 0, problem: 'AuthFailed' }))
  render(<ConnectHome homes={at.homes} onClose={() => {}} />)
  expect(await screen.findByText('The server turned down this Mac’s SSH keys.')).not.toBeNull()
  expect(screen.getByText('ssh-copy-id deploy@vps.test')).not.toBeNull()
  expect(stateOf('Reach the server')).toBe('failed')
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(at.homes.setupAct).toHaveBeenCalledExactlyOnceWith('resume')
  expect(stateOf('Reach the server')).toBe('now')
})

it('asks to trust a server’s key the first time, offers to send althar-host from here, and has no Try again where it can’t help', async () => {
  const at = fixture(
    setup({
      phase: 'trust',
      hostKey: { host: 'vps.test', type: 'ED25519', fingerprint: 'SHA256:q7Tf3kVxN2mWc9hZp1RaLd8yGs4uEoBi6tJ0nKvYw5M' },
    }),
  )
  render(<ConnectHome homes={at.homes} onClose={() => {}} />)
  expect(await screen.findByText('SHA256:q7Tf3kVxN2mWc9hZp1RaLd8yGs4uEoBi6tJ0nKvYw5M')).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Trust and continue' }))
  expect(at.homes.setupAct).toHaveBeenLastCalledWith('trust')
  at.tell(setup({ phase: 'failed', at: 2, problem: 'CannotDownload' }))
  await userEvent.click(screen.getByRole('button', { name: 'Send it from here' }))
  expect(at.homes.setupAct).toHaveBeenLastCalledWith('upload')
  at.tell(setup({ phase: 'failed', at: 1, problem: 'NoSystemd' }))
  expect(screen.getByText('This server can’t keep a home running: it has no systemd.')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
})

it('starts over on another host typed after a failure, and Cancel calls the setup off', async () => {
  const at = fixture(setup({ phase: 'failed', at: 0, problem: 'Unreachable' }))
  const close = vi.fn()
  render(<ConnectHome homes={at.homes} onClose={close} />)
  const field = await screen.findByLabelText('SSH host')
  await waitFor(() => expect((field as HTMLInputElement).value).toBe('deploy@vps.test'))
  await userEvent.clear(field)
  await userEvent.type(field, 'deploy@other.test')
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(at.homes.setUp).toHaveBeenCalledExactlyOnceWith({ target: 'deploy@other.test' })
  expect(at.homes.setupAct).not.toHaveBeenCalled()
  at.tell(setup({ target: { target: 'deploy@other.test' }, phase: 'failed', at: 0, problem: 'Unreachable' }))
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(at.homes.setupAct).toHaveBeenCalledExactlyOnceWith('dismiss')
  expect(close).toHaveBeenCalledOnce()
})

it('shows a setup under way on the chip while its dialog is closed, and the chip brings it back', async () => {
  const at = fixture(setup({ at: 2, progress: { bytes: 21, total: 50 } }))
  render(<Chip homes={at.homes} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Setting up vps.test: Getting althar-host · 42%. Show it' }))
  expect(homesUi.get().dialog).toBe('connect')
  act(() => homesUi.set({ dialog: null }))
  at.tell(setup({ phase: 'trust', at: 0 }))
  expect(screen.getByRole('button', { name: 'Setting up vps.test: Needs you. Show it' })).not.toBeNull()
  at.tell(null)
  expect(screen.queryByRole('button', { name: /^Setting up/ })).toBeNull()
})
