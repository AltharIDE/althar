import { chmod, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { DiagnosticOutcome, type DiagnosticLog, type DiagnosticResult } from '@althar/worker-protocol'
import { describe, expect, it } from 'vitest'

import { openWorkerStore } from '../src/workerStore'
import { temporary } from './support'

const homeId = `home_${'1'.repeat(32)}`
const otherHome = `home_${'2'.repeat(32)}`
const fingerprint = 'a'.repeat(64)
const otherFingerprint = 'b'.repeat(64)
const result = (attemptId: string, fence: string, outcome: DiagnosticOutcome = DiagnosticOutcome.SUCCEEDED): DiagnosticResult => ({
  $typeName: 'althar.worker.v1.DiagnosticResult',
  attemptId,
  fence,
  outcome,
  output: outcome === DiagnosticOutcome.UNKNOWN ? new Uint8Array() : Buffer.from('Linux\n'),
})

describe('the private worker ledger', () => {
  it('requires a current enrollment and records exactly one grant across concurrent store handles', async () => {
    const profile = temporary()
    let clock = 1000
    const first = await openWorkerStore(profile, homeId, () => clock)
    const other = await openWorkerStore(profile, homeId, () => clock)
    try {
      const worker = first.enroll(fingerprint)
      expect(other.enroll(fingerprint)).toBe(worker)
      expect(other.workerForCertificate(fingerprint)).toBe(worker)
      const stranger = other.enroll(otherFingerprint)
      expect(first.next(stranger)).toBeUndefined()
      expect(first.workerForCertificate('missing')).toBeUndefined()
      expect(() => first.enqueue('missing')).toThrow('no outstanding')
      const attempt = first.enqueue(worker)
      expect(first.result(attempt)).toMatchObject({ state: 'queued', output: null })
      expect(() => other.enqueue(worker)).toThrow('no outstanding')
      const offer = first.next(worker)!
      expect(offer).toMatchObject({ attemptId: attempt, claimableForMs: 15000 })
      clock += 200
      expect(other.next(worker)).toEqual({ ...offer, claimableForMs: 14800 })
      expect(first.claim(stranger, attempt, offer.fence)).toBe(0)
      expect(first.claim(worker, attempt, 'wrong fence')).toBe(0)
      expect(first.complete(worker, result(attempt, offer.fence))).toBe(false)
      expect(other.claim(worker, attempt, offer.fence)).toBe(14800)
      expect(first.claim(worker, attempt, offer.fence)).toBe(0)
      expect(first.next(worker)).toEqual({ ...offer, claimableForMs: 0 })
      expect(first.complete(stranger, result(attempt, offer.fence))).toBe(false)
      expect(first.complete(worker, result(attempt, 'wrong fence'))).toBe(false)
      expect(other.complete(worker, result(attempt, offer.fence))).toBe(true)
      expect(first.complete(worker, result(attempt, offer.fence))).toBe(false)
      expect(first.next(worker)).toBeUndefined()
      expect(first.result(attempt)).toMatchObject({ output: 'Linux\n', state: 'succeeded' })
      expect(() => first.result('missing')).toThrow('No worker run')
    } finally {
      first.close()
      other.close()
    }
    const reopened = await openWorkerStore(profile, homeId)
    try {
      expect(reopened.workerForCertificate(fingerprint)).toMatch(/^wrk_/)
    } finally {
      reopened.close()
    }
    await expect(openWorkerStore(profile, otherHome)).rejects.toThrow('another home')
  })

  it('offers project commands only to capable workers and fences cancellation', async () => {
    const profile = temporary()
    const store = await openWorkerStore(profile, homeId)
    const operator = await openWorkerStore(profile, homeId)
    try {
      const worker = store.enroll(fingerprint)
      const command = { projectId: `proj_${'1'.repeat(32)}`, commandName: 'check' }
      expect(() => operator.cancel(`wpr_${'f'.repeat(32)}`)).toThrow('No project run')
      const queued = operator.enqueue(worker, command)
      expect(store.next(worker)).toBeUndefined()
      expect(() => store.enqueue(worker)).toThrow('no outstanding')
      expect(operator.cancel(queued).state).toBe('cancelled')
      expect(store.next(worker, true)).toBeUndefined()

      const attempt = operator.enqueue(worker, command)
      const offer = store.next(worker, true)!
      expect(offer.projectCommand).toMatchObject(command)
      expect(store.claim(worker, attempt, offer.fence, 2000)).toBeGreaterThan(0)
      expect(store.complete(worker, result(attempt, offer.fence, DiagnosticOutcome.CANCELLED))).toBe(false)
      expect(operator.cancel(attempt)).toMatchObject({ state: 'claimed', cancellationRequested: true })
      expect(() => operator.enqueue(worker, command)).toThrow('no outstanding')
      expect(store.cancellationRequested(worker, attempt, 'other')).toBe(false)
      expect(store.cancellationRequested(worker, attempt, offer.fence)).toBe(true)
      expect(store.renew(worker, attempt, offer.fence, 2000)).toBe(0)
      expect(store.complete(worker, result(attempt, offer.fence, DiagnosticOutcome.CANCELLED))).toBe(true)
      expect(store.result(attempt).state).toBe('cancelled')
      expect(store.next(worker, true)).toBeUndefined()
    } finally {
      operator.close()
      store.close()
    }
  })

  it('reconciles expired offers and closes outstanding records on revocation', async () => {
    const profile = temporary()
    let clock = 1000
    const store = await openWorkerStore(profile, homeId, () => clock)
    try {
      const worker = store.enroll(fingerprint)
      const attempt = store.enqueue(worker)
      const offer = store.next(worker)!
      clock += 15000
      expect(store.claim(worker, attempt, offer.fence)).toBe(0)
      expect(store.next(worker)?.claimableForMs).toBe(0)
      expect(store.complete(worker, result(attempt, offer.fence, DiagnosticOutcome.UNKNOWN))).toBe(true)
      expect(store.result(attempt).state).toBe('unknown')
      const revokedAttempt = store.enqueue(worker)
      const revokedOffer = store.next(worker)!
      expect(store.claim(worker, revokedAttempt, revokedOffer.fence)).toBe(15000)
      expect(() => store.revoke('missing')).toThrow('No worker')
      store.revoke(worker)
      expect(store.workerForCertificate(fingerprint)).toBeUndefined()
      expect(store.renew(worker, revokedAttempt, revokedOffer.fence, 2000)).toBe(0)
      expect(() => store.enroll(fingerprint)).toThrow('revoked')
      expect(store.complete(worker, result(revokedAttempt, revokedOffer.fence))).toBe(false)
      expect(store.result(revokedAttempt).state).toBe('unknown')
    } finally {
      store.close()
    }
  })

  it('renews only a live, claimed lease with the original worker and fence', async () => {
    let clock = 1000
    const profile = temporary()
    const store = await openWorkerStore(profile, homeId, () => clock)
    try {
      const worker = store.enroll(fingerprint)
      const stranger = store.enroll(otherFingerprint)
      const attempt = store.enqueue(worker)
      const offer = store.next(worker)!
      expect(store.renew(worker, attempt, offer.fence, 2000)).toBe(0)
      expect(store.claim(worker, attempt, offer.fence, 2000)).toBe(2000)
      clock += 1000
      expect(store.renew(stranger, attempt, offer.fence, 2000)).toBe(0)
      expect(store.renew(worker, attempt, 'wrong fence', 2000)).toBe(0)
      expect(store.renew(worker, attempt, offer.fence, 3000)).toBe(2000)
      clock = 3000
      expect(store.renew(worker, attempt, offer.fence, 300)).toBe(300)
      clock = 3300
      expect(store.renew(worker, attempt, offer.fence, 2000)).toBe(0)
      expect(store.next(worker)?.claimableForMs).toBe(0)
      expect(store.complete(worker, result(attempt, offer.fence, DiagnosticOutcome.UNKNOWN))).toBe(true)
      expect(store.renew(worker, attempt, offer.fence, 2000)).toBe(0)
    } finally {
      store.close()
    }
  })

  it('upgrades the existing ledger additively and keeps exact log bytes across restart', async () => {
    let clock = 1000
    const profile = temporary()
    const legacy = await openWorkerStore(profile, homeId, () => clock)
    const worker = legacy.enroll(fingerprint)
    const attempt = legacy.enqueue(worker)
    legacy.close()
    const sqlite = new DatabaseSync(join(profile, 'workers', 'ledger.sqlite'))
    sqlite.exec('DROP TABLE diagnostic_log')
    sqlite.close()

    const makeLog = (offset: number, output: Uint8Array, fence: string): DiagnosticLog => ({
      $typeName: 'althar.worker.v1.DiagnosticLog',
      attemptId: attempt,
      fence,
      offset,
      output,
    })
    const store = await openWorkerStore(profile, homeId, () => clock)
    try {
      expect(store.result(attempt).state).toBe('queued')
      expect(store.log(attempt, 0)).toMatchObject({ state: 'queued', offset: 0, nextOffset: 0, bytesBase64: '' })
      const stranger = store.enroll(otherFingerprint)
      const offer = store.next(worker)!
      const one = makeLog(0, Uint8Array.of(0xe2, 0), offer.fence)
      expect(store.appendLog(worker, one)).toBe(false)
      expect(store.claim(worker, attempt, offer.fence, 2000)).toBe(2000)
      expect(store.appendLog(stranger, one)).toBe(false)
      expect(store.appendLog(worker, { ...one, fence: 'wrong fence' })).toBe(false)
      expect(store.appendLog(worker, { ...one, offset: 1 })).toBe(false)
      expect(store.appendLog(worker, { ...one, offset: -1 })).toBe(false)
      expect(store.appendLog(worker, { ...one, offset: NaN })).toBe(false)
      expect(store.appendLog(worker, { ...one, offset: 1024 })).toBe(false)
      expect(store.appendLog(worker, { ...one, output: new Uint8Array(257) })).toBe(false)
      expect(store.appendLog(worker, { ...one, output: new Uint8Array() })).toBe(false)
      expect(store.appendLog(worker, one)).toBe(true)
      expect(store.appendLog(worker, one)).toBe(false)
      expect(store.appendLog(worker, makeLog(2, Uint8Array.of(0x80, 0xff), offer.fence))).toBe(true)
      const log = store.log(attempt, 1)
      expect(log).toMatchObject({ state: 'claimed', offset: 1, nextOffset: 4 })
      expect(Buffer.from(log.bytesBase64, 'base64')).toEqual(Buffer.of(0, 0x80, 0xff))
      expect(() => store.log(attempt, 5)).toThrow('outside')
      expect(() => store.log(attempt, -1)).toThrow('outside')
      expect(() => store.log(attempt, 0.5)).toThrow('outside')
      expect(() => store.log('missing', 0)).toThrow('No worker run')
      clock += 2000
      expect(store.appendLog(worker, makeLog(4, Uint8Array.of(1), offer.fence))).toBe(false)
      store.revoke(worker)
      expect(store.appendLog(worker, makeLog(4, Uint8Array.of(1), offer.fence))).toBe(false)
    } finally {
      store.close()
    }
    const reopened = await openWorkerStore(profile, homeId)
    try {
      const log = reopened.log(attempt, 0)
      expect(log).toMatchObject({ state: 'unknown', offset: 0, nextOffset: 4 })
      expect(Buffer.from(log.bytesBase64, 'base64')).toEqual(Buffer.of(0xe2, 0, 0x80, 0xff))
      expect(reopened.log(attempt, 4).bytesBase64).toBe('')
    } finally {
      reopened.close()
    }
  })

  it('refuses an invalid home or ledger path outside the private profile', async () => {
    const profile = temporary()
    await expect(openWorkerStore(profile, 'invalid')).rejects.toThrow('initialized home')
    const first = await openWorkerStore(profile, homeId)
    first.close()
    await chmod(join(profile, 'workers', 'ledger.sqlite'), 0o644)
    await expect(openWorkerStore(profile, homeId)).rejects.toThrow('private file')
    const other = temporary()
    await mkdir(join(other, 'workers'), { mode: 0o700 })
    await symlink(join(profile, 'workers', 'ledger.sqlite'), join(other, 'workers', 'ledger.sqlite'))
    await expect(openWorkerStore(other, homeId)).rejects.toThrow('private file')
  })
})
