import type { CheckedHome, HomesHost } from '../../src/homes'

/*
 * A home host for the lab: it answers after a believable while, as a real
 * host over SSH or HTTPS would, and fails the next attempt when asked (F).
 * With ?s= (a scene, for shooting), it answers at once, or never, as that
 * scene needs.
 */

export const HOME_ID = 'home_01a1c4f39e2b7d5a80c6e1f42b9d3a77'
const params = new URLSearchParams(location.search)
const scene = params.get('s')

let failing = false
const listeners = new Set<() => void>()
export const failNext = {
  get: () => failing,
  set: (on: boolean) => {
    failing = on
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
}
const failed = () => {
  const was = failing
  if (was) failNext.set(false)
  return was
}
const never = () => new Promise<never>(() => undefined)
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, scene === null ? ms : 0))
const nothing = async () => {}

export const homes: HomesHost = {
  state: async () => ({ current: { kind: 'local' }, connection: 'local' }),
  list: async () => [],
  overview: async () => ({ homes: [], windows: { local: 'local' }, projects: {}, opened: {} }),
  inspect: async (target): Promise<CheckedHome> => {
    if (scene === 'checking') return never()
    await wait(1300)
    if (scene === 'refused' || failed())
      throw new Error(`ssh: Could not resolve hostname ${target.target.split('@').at(-1)}: nodename nor servname provided, or not known`)
    return {
      checkId: 'lab-check',
      homeId: HOME_ID,
      hostDeviceId: `dev_${'3'.repeat(32)}`,
      version: 'lab',
      apiVersion: 1,
      target: target.target,
    }
  },
  connect: async () => {
    if (scene === 'connecting') return never()
    await wait(1500)
    if (scene === 'failed' || failed()) throw new Error('This home check expired. Check the host again.')
  },
  pairingInfo: async () => {
    if (scene === 'checking') return never()
    await wait(500)
    if (scene === 'refused' || failed()) throw new Error('This pairing code has expired. Run althar-host pair on the host for a new one.')
    return { origin: 'https://vps.example.com:6769', homeId: HOME_ID, expiresAt: Date.now() + 10 * 60_000 }
  },
  pair: async () => {
    if (scene === 'connecting') return never()
    await wait(1500)
    if (scene === 'failed' || failed()) throw new Error('The host turned this device away. Run althar-host pair again for a new code.')
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
}
