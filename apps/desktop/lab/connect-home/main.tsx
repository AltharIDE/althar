import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

import type { CheckedHome, HomesHost } from '../../src/homes'
import { ConnectHome } from '../../src/renderer/features/homes/ConnectHome'

/*
 * The Connect a home lab (README.md): the app's own dialog, on a home host
 * that answers as each scene needs, driven to that scene as a person would
 * type and press. ?scene= picks it, ?theme=dark draws it dark.
 */

const scenes = [
  'ssh',
  'ssh-options',
  'ssh-checking',
  'ssh-refused',
  'ssh-checked',
  'ssh-connecting',
  'ssh-failed',
  'pair',
  'pair-checked',
  'pair-refused',
  'pair-pairing',
] as const
type Scene = (typeof scenes)[number]

const params = new URLSearchParams(location.search)
const scene: Scene = scenes.find((one) => one === params.get('scene')) ?? 'ssh'
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'

const homeId = 'home_01a1c4f39e2b7d5a80c6e1f42b9d3a77'
const checked: CheckedHome = {
  checkId: 'lab-check',
  homeId,
  hostDeviceId: `dev_${'3'.repeat(32)}`,
  version: 'lab',
  apiVersion: 1,
  target: 'deploy@vps.example.com',
}
const never = () => new Promise<never>(() => undefined)
const nothing = async () => {}

const homes: HomesHost = {
  state: async () => ({ current: { kind: 'local' }, connection: 'local' }),
  list: async () => [],
  overview: async () => ({ homes: [], windows: { local: 'local' }, projects: {}, opened: {} }),
  inspect: async () => {
    if (scene === 'ssh-checking') return never()
    if (scene === 'ssh-refused')
      throw new Error('ssh: Could not resolve hostname vps.example.com: nodename nor servname provided, or not known.')
    return checked
  },
  connect: async () => {
    if (scene === 'ssh-connecting') return never()
    throw new Error('This home check expired. Check the host again.')
  },
  save: nothing,
  open: nothing,
  rename: nothing,
  change: nothing,
  forget: nothing,
  restore: nothing,
  cancelCheck: nothing,
  reconnect: nothing,
  report: () => undefined,
  onState: () => () => {},
  onOverview: () => () => {},
  onOpen: () => () => {},
  onProject: () => () => {},
  pairingInfo: async () => {
    if (scene === 'pair-refused') throw new Error('This pairing code has expired. Run althar-host pair on the host for a new one.')
    return { origin: 'https://vps.example.com:6769', homeId, expiresAt: Date.now() + 10 * 60_000 }
  },
  pair: async () => never(),
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const input = (label: string) => {
  const field = [...document.querySelectorAll('label')].find((one) => one.textContent?.trim().startsWith(label))
  const id = field?.getAttribute('for')
  return (id === null || id === undefined ? field?.querySelector('input') : document.getElementById(id)) as HTMLInputElement | null
}
const type = (label: string, value: string) => {
  const field = input(label)
  if (field === null) throw new Error(`No field ${label}`)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
const press = (name: string) => {
  const button = [...document.querySelectorAll('button, [role=radio]')].find((one) => one.textContent?.trim() === name)
  if (!(button instanceof HTMLElement)) throw new Error(`No button ${name}`)
  button.click()
}

/** Drives the dialog to the scene, as a person would. */
const drive = async () => {
  await wait(150)
  if (scene.startsWith('ssh')) {
    press('SSH')
    await wait(80)
    if (scene === 'ssh') return
    type('SSH host', 'deploy@vps.example.com')
    await wait(30)
    if (scene === 'ssh-options') {
      press('Connection options')
      await wait(60)
      type('Port', '2222')
      return
    }
    press('Check host')
    await wait(80)
    if (scene === 'ssh-connecting' || scene === 'ssh-failed') {
      press('Connect')
      await wait(80)
    }
    return
  }
  if (scene === 'pair') return
  type('Pairing code', 'k7Qp-3xWm-9fTa')
  await wait(80)
  if (scene === 'pair-refused') return
  type('Name', 'VPS')
  await wait(30)
  if (scene === 'pair-pairing') press('Pair and open')
}

let driven = false
function Lab() {
  useEffect(() => {
    if (driven) return
    driven = true
    void drive().then(() => document.body.setAttribute('data-driven', ''))
  }, [])
  return <ConnectHome homes={homes} onClose={() => undefined} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
