import { chmod, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'

import { DiagnosticOutcome, type DiagnosticResult } from '@althar/worker-protocol'
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
      expect(() => first.result('missing')).toThrow('No diagnostic')
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
      expect(() => store.enroll(fingerprint)).toThrow('revoked')
      expect(store.complete(worker, result(revokedAttempt, revokedOffer.fence))).toBe(false)
      expect(store.result(revokedAttempt).state).toBe('unknown')
    } finally {
      store.close()
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
