import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { DiagnosticOutcome, validWorkerProtocolId, type DiagnosticResult } from '@althar/worker-protocol'
import { DIAGNOSTIC_LEASE_MS, DIAGNOSTIC_RENEWAL_MS, MAX_DIAGNOSTIC_OUTPUT } from '@althar/worker-protocol/grpc'

import { fileErrorCode, HostError } from './errors'
import { privateDirectory, writePrivate } from './privateFiles'

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`
const invalid = (message: string) => new HostError({ code: 'InvalidConfig', message })

const schema = `
  CREATE TABLE worker_home (key INTEGER PRIMARY KEY CHECK(key = 1), home_id TEXT NOT NULL) STRICT;
  CREATE TABLE worker_enrollment (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0, 1))
  ) STRICT;
  CREATE TABLE diagnostic (
    id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL REFERENCES worker_enrollment(id),
    fence TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('queued', 'offered', 'claimed', 'succeeded', 'failed', 'unknown')),
    lease_until INTEGER,
    output BLOB CHECK(output IS NULL OR length(output) <= ${MAX_DIAGNOSTIC_OUTPUT})
  ) STRICT;
  CREATE UNIQUE INDEX diagnostic_active ON diagnostic(worker_id) WHERE state IN ('queued', 'offered', 'claimed');
  PRAGMA user_version = 1;
`

type Active = { id: string; fence: string; state: 'queued' | 'offered' | 'claimed'; lease_until: number | null }

export const openWorkerStore = async (profile: string, homeId: string, now = Date.now) => {
  if (!validWorkerProtocolId(homeId, 'home_')) throw invalid('The worker store needs an initialized home')
  const folder = await privateDirectory(join(profile, 'workers'), true)
  const path = join(folder, 'ledger.sqlite')
  const inspect = async () => {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
      throw new HostError({ code: 'UnsafePermissions', message: 'The worker ledger must be a private file owned by the home user' })
  }
  try {
    await inspect()
  } catch (error) {
    if (fileErrorCode(error) !== 'ENOENT') throw error
    await writePrivate(path, '', false)
    await inspect()
  }
  const db = new DatabaseSync(path)
  try {
    // Leave contention to the caller's retry. A worker must never block the home event loop on another writer.
    db.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = EXTRA;')
    if (db.prepare('PRAGMA user_version').get()?.user_version === 0) {
      db.exec('BEGIN IMMEDIATE')
      if (db.prepare('PRAGMA user_version').get()?.user_version === 0) {
        db.exec(schema)
        db.prepare('INSERT INTO worker_home VALUES (1, ?)').run(homeId)
      }
      db.exec('COMMIT')
    }
    if (
      db.prepare('PRAGMA user_version').get()?.user_version !== 1 ||
      db.prepare('SELECT home_id FROM worker_home WHERE key = 1').get()?.home_id !== homeId
    ) {
      throw invalid('The worker ledger belongs to another home or uses an unsupported format')
    }

    const enrolled = db.prepare('SELECT id FROM worker_enrollment WHERE fingerprint = ? AND revoked = 0')
    const active = db.prepare(
      "SELECT id, fence, state, lease_until FROM diagnostic WHERE worker_id = ? AND state IN ('queued', 'offered', 'claimed')",
    )
    const offer = db.prepare(
      "UPDATE diagnostic SET state = 'offered', lease_until = ? WHERE worker_id = ? AND state = 'queued' RETURNING id, fence, state, lease_until",
    )
    const claim = db.prepare(
      "UPDATE diagnostic SET state = 'claimed', lease_until = min(lease_until, ?) WHERE id = ? AND worker_id = ? AND fence = ? AND state = 'offered' AND lease_until > ? AND EXISTS (SELECT 1 FROM worker_enrollment WHERE id = ? AND revoked = 0) RETURNING lease_until",
    )
    const renew = db.prepare(
      "UPDATE diagnostic SET lease_until = ? WHERE id = ? AND worker_id = ? AND fence = ? AND state = 'claimed' AND lease_until > ? AND EXISTS (SELECT 1 FROM worker_enrollment WHERE id = ? AND revoked = 0) RETURNING lease_until",
    )
    const complete = db.prepare(
      "UPDATE diagnostic SET state = ?, output = ? WHERE id = ? AND worker_id = ? AND fence = ? AND (state = 'claimed' OR (state = 'offered' AND ? = 'unknown')) AND EXISTS (SELECT 1 FROM worker_enrollment WHERE id = ? AND revoked = 0)",
    )
    return {
      close: () => db.close(),
      workerForCertificate: (fingerprint: string) => enrolled.get(fingerprint)?.id as string | undefined,
      enroll(fingerprint: string) {
        db.prepare('INSERT INTO worker_enrollment (id, fingerprint) VALUES (?, ?) ON CONFLICT(fingerprint) DO NOTHING').run(
          id('wrk'),
          fingerprint,
        )
        const workerId = enrolled.get(fingerprint)?.id
        if (typeof workerId !== 'string') throw invalid('This certificate was revoked. Enroll a replacement certificate')
        return workerId
      },
      revoke(workerId: string) {
        db.exec('BEGIN IMMEDIATE')
        try {
          const revoked = db.prepare('UPDATE worker_enrollment SET revoked = 1 WHERE id = ?').run(workerId)
          if (revoked.changes !== 1) throw invalid('No worker has that identity')
          db.prepare("UPDATE diagnostic SET state = 'unknown' WHERE worker_id = ? AND state IN ('queued', 'offered', 'claimed')").run(
            workerId,
          )
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      },
      enqueue(workerId: string) {
        const attemptId = id('watt')
        const row = db
          .prepare(
            "INSERT INTO diagnostic (id, worker_id, fence, state) SELECT ?, id, ?, 'queued' FROM worker_enrollment WHERE id = ? AND revoked = 0 AND NOT EXISTS (SELECT 1 FROM diagnostic WHERE worker_id = ? AND state IN ('queued', 'offered', 'claimed')) RETURNING id",
          )
          .get(attemptId, id('wfn'), workerId, workerId)
        if (row === undefined) throw invalid('Choose an enrolled worker with no outstanding diagnostic')
        return attemptId
      },
      result(attemptId: string) {
        const row = db.prepare('SELECT id, worker_id, state, output FROM diagnostic WHERE id = ?').get(attemptId) as
          | { id: string; worker_id: string; state: string; output: Uint8Array | null }
          | undefined
        if (row === undefined) throw invalid('No diagnostic has that attempt identity')
        return {
          attemptId: row.id,
          workerId: row.worker_id,
          state: row.state,
          output: row.output === null ? null : Buffer.from(row.output).toString('utf8'),
        }
      },
      next(workerId: string) {
        const at = now()
        const row = (offer.get(at + DIAGNOSTIC_LEASE_MS, workerId) ?? active.get(workerId)) as Active | undefined
        if (row === undefined) return
        return {
          attemptId: row.id,
          fence: row.fence,
          claimableForMs: row.state === 'offered' ? Math.max(0, Math.min(DIAGNOSTIC_LEASE_MS, (row.lease_until ?? at) - at)) : 0,
        }
      },
      claim(workerId: string, attemptId: string, fence: string, maximumMs = DIAGNOSTIC_LEASE_MS) {
        const at = now()
        const row = claim.get(at + maximumMs, attemptId, workerId, fence, at, workerId)
        return row === undefined ? 0 : Math.max(0, Math.min(DIAGNOSTIC_LEASE_MS, Number(row.lease_until) - now()))
      },
      renew(workerId: string, attemptId: string, fence: string, maximumMs: number) {
        const at = now()
        const row = renew.get(at + Math.min(DIAGNOSTIC_RENEWAL_MS, maximumMs), attemptId, workerId, fence, at, workerId)
        return row === undefined ? 0 : Math.max(0, Math.min(DIAGNOSTIC_RENEWAL_MS, Number(row.lease_until) - now()))
      },
      complete(workerId: string, result: DiagnosticResult) {
        const state =
          result.outcome === DiagnosticOutcome.UNKNOWN ? 'unknown' : result.outcome === DiagnosticOutcome.SUCCEEDED ? 'succeeded' : 'failed'
        return complete.run(state, result.output, result.attemptId, workerId, result.fence, state, workerId).changes === 1
      },
    }
  } catch (error) {
    db.close()
    throw error
  }
}
