import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { tlsPublicKeyPin } from '@althar/transport-node'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { bonjourName, keepSetting, localName, savedSetting, tlsFor } from '../src/runtime/phones'

describe('This Mac letting phones in', () => {
  it('answers at the Mac’s Bonjour name', () => {
    expect(localName('Studio-Mac.local')).toBe('studio-mac.local')
    expect(localName('Balázs’s MacBook Pro')).toBe('bal-zs-s-macbook-pro.local')
    expect(localName('')).toBe('althar.local')
  })

  it.runIf(process.platform === 'darwin')('takes the name Bonjour publishes, not the configured hostname', async () => {
    const published = execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName']).toString().trim()
    expect(await bonjourName()).toBe(published)
  })

  it('keeps its key, and so every paired phone’s pin, when the Mac is renamed', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'althar-phones-'))
    const first = await Effect.runPromise(tlsFor(profile, 'studio-mac.local'))
    const same = await Effect.runPromise(tlsFor(profile, 'studio-mac.local'))
    const renamed = await Effect.runPromise(tlsFor(profile, 'office-mac.local'))
    expect(same.certificate).toBe(first.certificate)
    expect(renamed.certificate).not.toBe(first.certificate)
    expect(tlsPublicKeyPin(renamed.certificate)).toBe(tlsPublicKeyPin(first.certificate))
  })

  it('keeps whether phones are let in across a restart, and says when it couldn’t', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'althar-phones-'))
    await Effect.runPromise(keepSetting(profile, true))
    expect(await Effect.runPromise(savedSetting(profile))).toBe(true)
    await Effect.runPromise(keepSetting(profile, false))
    expect(await Effect.runPromise(savedSetting(profile))).toBe(false)
    const gone = join(profile, 'missing', 'deeper')
    const refused = await Effect.runPromise(Effect.flip(keepSetting(gone, false)))
    expect(refused.reason).toBe('PhonesCantReach')
  })
})
