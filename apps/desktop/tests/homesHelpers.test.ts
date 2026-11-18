import { expect, it } from 'vitest'

import { homeProblem, keyOf, livenessOf, openedAgo, nameFrom } from '../src/renderer/features/homes/useHomes'
import { optionsOf, targetOf } from '../src/renderer/features/homes/ConnectHome'

it('preserves explicit SSH options and omits blank defaults when sending a check', () => {
  expect(targetOf(' user@box ', { profile: ' /profile ', launcher: ' host ', config: ' /config ', port: ' 2222 ' })).toEqual({
    target: 'user@box',
    profile: '/profile',
    launcher: 'host',
    configFile: '/config',
    port: 2222,
  })
  const ssh = { target: 'box', profile: '/profile', launcher: 'host', configFile: '/config', port: 2222 }
  expect(targetOf(ssh.target, optionsOf(ssh))).toEqual(ssh)
  expect(targetOf('box', optionsOf({ target: 'box' }))).toEqual({ target: 'box' })
  expect(nameFrom(' user@box.example.com ')).toBe('box')
  expect(nameFrom('box')).toBe('box')
})

it('identifies local, saved and not-yet-verified homes consistently', () => {
  expect(keyOf('local')).toBe('local')
  expect(keyOf({ id: 'local' })).toBe('local')
  expect(keyOf({ id: 'saved', homeId: 'verified' })).toBe('verified')
  expect(keyOf({ id: 'saved' })).toBe('saved')
  expect(livenessOf(null, 'local')).toBe('live')
  expect(livenessOf(null, { id: 'saved', homeId: 'home', name: 'Box', ssh: { target: 'box' } })).toBe('rest')
})

it.each([
  [undefined, 'Not opened yet'],
  [-60_000, 'Just now'],
  [0, 'Just now'],
  [60_000, 'Just now'],
  [2 * 60_000, '2 minutes ago'],
  [40 * 60_000, '40 minutes ago'],
  [60 * 60_000, 'An hour ago'],
  [3 * 60 * 60_000, '3 hours ago'],
  [24 * 60 * 60_000, 'Yesterday'],
  [6 * 24 * 60 * 60_000, '6 days ago'],
])('describes a home last opened %s milliseconds ago', (ago, expected) => {
  expect(openedAgo(ago === undefined ? undefined : 0 - ago, 0)).toBe(expected)
})

it('strips the Electron wrapper from errors and has a readable fallback for non-errors', () => {
  expect(homeProblem(new Error("Error invoking remote method 'homes': Error: Offline"))).toBe('Offline')
  expect(homeProblem(new Error("Error invoking remote method 'homes': Offline"))).toBe('Offline')
  expect(homeProblem(new Error('Offline'))).toBe('Offline')
  expect(homeProblem(null)).toBe('The home connection could not be changed. Try again.')
})
